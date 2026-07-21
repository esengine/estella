// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EditorControlSurface.ts
 * @brief   The single canonical programmatic entry to a session — lifecycle,
 *          commands, queries, and observation — composed over the session's
 *          engine modules. One surface, three consumers: the React UI, the
 *          headless verification host, and (later) the editor MCP server, which
 *          is a transport adapter over this object rather than a parallel API.
 *
 * This adds no new truth — commands route through
 * the session's SceneCommands (the model write boundary), reads through its
 * SceneQuery / SceneModel (the model is the source of truth; the World is a
 * derived projection), and observation reads the live canvas/World (process-
 * level engine). Ids are stable source ids. The surface is an instance over a
 * session; `EditorControlSurface` is the app's default-session one.
 */
import type {
  EntityId,
  InspectorComponent,
  InspectorFieldType,
  InspectorFieldValue,
  NodeKind,
  SceneNode,
} from '@/types';
import type { SceneData, PrefabData, SubsystemStatus } from 'esengine';
import { Material, Sprite, Renderer } from 'esengine';
import { EngineHost } from './EngineHost';
import { isRequiredEmpty } from './schema';
import { ViewportController } from './ViewportController';
import { PerfMonitor, type PerfSnapshot, type FrameSample, type SessionCapture } from './PerfMonitor';
import type { SceneCommandsImpl, EditorTransaction } from './SceneCommands';
import type { SceneQueryImpl } from './SceneQuery';
import type { SceneModelImpl } from './SceneModel';
import type { EditorHistoryImpl } from './EditorHistory';
import type { ReconcilerImpl } from './Reconciler';
import type { SelectionStore } from '@/store/selectionStore';

/** A captured viewport frame: raw RGBA pixels (GL order: bottom-up rows). */
export interface ViewportCapture {
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** One scene-validation finding (see {@link EditorControlSurfaceImpl.getDiagnostics}). */
export interface SceneDiagnostic {
  entity: EntityId;
  entityName: string;
  component: string;
  field?: string;
  problem: 'required-empty' | 'asset-unresolved' | 'notice';
  detail: string;
}

/** Why a MODEL-healthy asset ref still yields no live asset (unknown to the
 *  registry / its load failed), or null when it's fine. Installed by
 *  ProjectStore — the surface itself is project-agnostic (headless hosts run
 *  without a registry, where every ref is presumed fine). */
type AssetRefProblemResolver = (ref: string) => string | null;
let assetRefProblem: AssetRefProblemResolver | null = null;
export function setAssetRefProblemResolver(fn: AssetRefProblemResolver | null): void {
  assetRefProblem = fn;
}

/**
 * Coerce an automation-supplied field value into the shape the declared
 * inspector type stores. Accepts the value both as real JSON (an array for a
 * vec) and as JSON TEXT (what MCP clients send for schema-loose params), plus
 * the `{x, y}` object spelling get_inspector-style reads suggest. Anything that
 * doesn't coerce cleanly throws — the automation door must never write garbage.
 */
export function coerceFieldValue(
  declared: InspectorFieldType,
  key: string,
  value: InspectorFieldValue,
): InspectorFieldValue {
  const fail = (expected: string): never => {
    throw new Error(`field "${key}" (${declared}) expects ${expected}, got ${JSON.stringify(value)}`);
  };
  const parseJsonText = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return fail('valid JSON');
    }
  };
  switch (declared) {
    case 'number':
    case 'enum':
    case 'flags':
    case 'entity': {
      // 'entity' is a source-id reference to another entity — a plain number.
      const n = Number(value);
      return Number.isFinite(n) ? n : fail('a number');
    }
    case 'angle': {
      const n = Number(value);
      return Number.isFinite(n) ? n : fail('degrees as a number');
    }
    case 'bool':
      // String forms arrive from text transports; "false"/"0" must not read truthy.
      return typeof value === 'string' ? !['false', '0', ''].includes(value.trim().toLowerCase()) : Boolean(value);
    case 'string':
    case 'select':
    case 'asset':
      return typeof value === 'string' ? value : String(value);
    case 'vec2':
    case 'vec3': {
      const n = declared === 'vec2' ? 2 : 3;
      let v: unknown = value;
      if (typeof v === 'string') v = parseJsonText(v);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        v = n === 2 ? [o.x, o.y] : [o.x, o.y, o.z];
      }
      if (!Array.isArray(v) || v.length < n || v.slice(0, n).some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
        return fail(`${n} numbers (e.g. ${n === 2 ? '[16, 16]' : '[0, 0, 0]'})`);
      }
      return (n === 2 ? [v[0], v[1]] : [v[0], v[1], v[2]]) as InspectorFieldValue;
    }
    case 'color': {
      let v: unknown = value;
      if (typeof v === 'string' && /^\s*[[{]/.test(v)) v = parseJsonText(v);
      if (typeof v === 'string') return v; // #rrggbb / #rrggbbaa hex — the control's native form
      if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if ([o.r, o.g, o.b].every((c) => typeof c === 'number')) {
          const hex = (c: unknown): string =>
            Math.round(Math.min(1, Math.max(0, c as number)) * 255).toString(16).padStart(2, '0');
          return `#${hex(o.r)}${hex(o.g)}${hex(o.b)}${hex(typeof o.a === 'number' ? o.a : 1)}`;
        }
      }
      return fail('a "#rrggbbaa" hex string or { r, g, b, a } with 0..1 channels');
    }
    case 'gradient':
    case 'curve':
    case 'dimension': {
      const v = typeof value === 'string' ? parseJsonText(value) : value;
      if (v === null || typeof v !== 'object') return fail('a structural object');
      return v as InspectorFieldValue;
    }
    default:
      return value;
  }
}

/** The session parts the surface needs (the EditorSession satisfies this). */
export interface SurfaceSession {
  model: SceneModelImpl;
  history: EditorHistoryImpl;
  commands: SceneCommandsImpl;
  query: SceneQueryImpl;
  reconciler: ReconcilerImpl;
  selection: SelectionStore;
}

export class EditorControlSurfaceImpl {
  constructor(private readonly s: SurfaceSession) {}

  // =========================================================================
  // Lifecycle — drive the engine deterministically and switch run mode.
  // The engine (wasm / canvas / World) is process-level — shared via EngineHost.
  // =========================================================================

  /**
   * Load a scene into the live World, resolving `@uuid:` asset refs via the
   * manifest. Returns the spawned entity count. The async-driving counterpart to
   * opening a scene in the UI; used by verification to set up a known scene.
   */
  async loadScene(sceneUrl: string, manifestUrl?: string): Promise<number> {
    return EngineHost.loadScene(sceneUrl, manifestUrl);
  }

  /**
   * Switch edit↔play. Play runs gameplay against the live World; on Stop this
   * rebuilds the World from the untouched edit model (this session's Reconciler)
   * so gameplay never dirties the edit scene. Returns true if a play→edit rebuild
   * happened. Selection survives it (stable source ids). The single run-mode
   * boundary: EngineHost handles the pure engine flip, the session the rebuild.
   */
  setRunMode(playing: boolean, paused = false): boolean {
    const wasStop = EngineHost.setRunMode(playing, paused);
    if (wasStop) this.s.reconciler.rebuildWorld();
    return wasStop;
  }

  /**
   * Advance the engine by exactly `frames` fixed-delta ticks — no rAF, no
   * wall-clock — so a subsequent capture is reproducible. Use after loadScene /
   * setRunMode and before captureViewport. Drives the engine directly, so it
   * belongs to a host that does NOT run app.run()'s loop (the headless host).
   */
  async step(frames = 1, dt = 1 / 60): Promise<void> {
    for (let i = 0; i < frames; i++) await EngineHost.tick(dt);
  }

  /** Project render config: bitmask of layers (0..31) that y-sort within the
   *  layer. Drivers (headless verify, future editor-MCP) set it in place of
   *  Project Settings, which owns it in the interactive editor. */
  setYSortLayers(mask: number): void {
    Renderer.setYSortLayers(mask >>> 0);
  }

  undo(): void {
    this.s.history.undo();
  }
  redo(): void {
    this.s.history.redo();
  }
  canUndo(): boolean {
    return this.s.history.canUndo();
  }
  canRedo(): boolean {
    return this.s.history.canRedo();
  }

  // =========================================================================
  // Commands — mutations, all undoable, through the SceneCommands write door
  // =========================================================================

  addEntity(): EntityId | null {
    return this.s.commands.addEntity();
  }
  /**
   * Create entities from a template/prefab through the one create pipeline (E5) —
   * so headless/automation can spawn any ready-made entity, not just a blank one.
   * With `linkPrefabRef` the subtree is tagged as a prefab instance.
   */
  create(
    prefab: PrefabData,
    opts: { parent: EntityId | null; position?: { x: number; y: number }; linkPrefabRef?: string },
  ): EntityId | null {
    return this.s.commands.create(prefab, opts);
  }
  deleteEntity(id: EntityId): void {
    this.s.commands.deleteEntity(id);
  }
  duplicateEntity(id: EntityId): EntityId | null {
    return this.s.commands.duplicateEntity(id);
  }
  renameEntity(id: EntityId, name: string): void {
    this.s.commands.renameEntity(id, name);
  }
  /**
   * The automation field write (MCP / headless). Unlike the UI path — which
   * builds its values from the inspector controls it rendered — a remote caller
   * can name a component or key that doesn't exist and encode the value as raw
   * JSON text (MCP clients serialize schema-loose params as strings, so a
   * `[16, 16]` vec2 arrives as the STRING "[16, 16]"). Resolve the field's
   * DECLARED inspector type and coerce the value against it, and reject unknown
   * components/keys loudly — a string destructured as a vec writes silent
   * garbage into the model.
   */
  setField(
    entity: EntityId,
    component: string,
    key: string,
    _type: InspectorFieldType, // advisory — the declared inspector type wins
    value: InspectorFieldValue,
  ): void {
    const comps = this.s.query.readInspector(entity);
    const comp = comps.find((c) => c.name === component);
    if (!comp) {
      const has = comps.map((c) => c.name).join(', ');
      throw new Error(`component "${component}" is not on entity ${entity}${has ? ` (has: ${has})` : ''}`);
    }
    // The enable toggle is surfaced in the component header, not in `fields` —
    // but it is still a writable bool field to automation.
    const declared: InspectorFieldType | undefined =
      comp.fields.find((f) => f.key === key)?.type ?? (comp.enable?.key === key ? 'bool' : undefined);
    if (!declared) {
      const keys = [...comp.fields.map((f) => f.key), ...(comp.enable ? [comp.enable.key] : [])];
      throw new Error(`"${component}" has no field "${key}" (fields: ${keys.join(', ')})`);
    }
    this.s.commands.setField(entity, component, key, declared, coerceFieldValue(declared, key, value));
  }
  /** Add a component (by schema name) to an entity — the Details "Add Component" door. */
  addComponent(entity: EntityId, component: string): void {
    this.s.commands.addComponent(entity, component);
  }
  /** Remove a component from an entity. */
  removeComponent(entity: EntityId, component: string): void {
    this.s.commands.removeComponent(entity, component);
  }
  setEntityXY(id: EntityId, x: number, y: number): void {
    this.s.commands.setEntityXY(id, x, y);
  }
  /** Coalesce a burst of setField writes (a drag) into one undo step. */
  beginGesture(label: string): void {
    this.s.commands.beginGesture(label);
  }
  endGesture(): void {
    this.s.commands.endGesture();
  }
  /** Open a scoped edit transaction (commit as one undo step, or abort to roll
   *  back live). The handle form of begin/endGesture, with cancel support. */
  transaction(label: string): EditorTransaction {
    return this.s.commands.transaction(label);
  }
  /** Run `fn` inside a transaction: commit on return, abort + rethrow on throw. */
  transact(label: string, fn: () => void): void {
    this.s.commands.transact(label, fn);
  }

  // =========================================================================
  // Hierarchy & organization — the World Outliner's model operations, exposed
  // so the headless host + editor MCP drive the same undoable commands the UI
  // does. View state (expansion / sort / search) stays in the OutlinerController.
  // =========================================================================

  /** Re-parent an entity (transform hierarchy); `null` un-parents to the root. */
  setParent(id: EntityId, parent: EntityId | null): void {
    this.s.commands.setParent(id, parent);
  }
  /** Drag-reorder an entity before/after a sibling target (one undo step). */
  reorderEntity(id: EntityId, target: EntityId, before: boolean): void {
    this.s.commands.reorderEntity(id, target, before);
  }

  /** Create an explicit (initially empty) outliner folder. */
  createFolder(path: string): void {
    this.s.commands.createFolder(path);
  }
  /** Rename/move a folder (re-roots its descendants + entities). */
  renameFolder(oldPath: string, newPath: string): void {
    this.s.commands.renameFolder(oldPath, newPath);
  }
  /** Delete a folder, moving its contents up to the parent. */
  deleteFolder(path: string): void {
    this.s.commands.deleteFolder(path);
  }
  /** Place a folder at a manual sort position among its siblings (drag-between). */
  placeFolder(path: string, key: number): void {
    this.s.commands.placeFolder(path, key);
  }
  /** Move entities into a folder (`null` = scene root); un-parents them. */
  moveToFolder(ids: readonly EntityId[], path: string | null): void {
    this.s.commands.moveToFolder(ids, path);
  }
  /** An entity's folder path (`""` = scene root). */
  getEntityFolder(id: EntityId): string {
    return this.s.model.folderOf(id);
  }
  /** The scene's explicit folder list (incl. empties). */
  getSceneFolders(): string[] {
    return this.s.model.sceneFolders();
  }

  /** Set an entity's editor visibility (an editor-only flag, not gameplay enable). */
  setEntityHidden(id: EntityId, hidden: boolean): void {
    this.s.commands.setEntityVisible(id, !hidden);
  }
  isEntityHidden(id: EntityId): boolean {
    return this.s.model.isHidden(id);
  }
  /** Lock/unlock an entity (blocks viewport picking/transform). */
  setEntityLocked(id: EntityId, locked: boolean): void {
    this.s.commands.setEntityLocked(id, locked);
  }
  isEntityLocked(id: EntityId): boolean {
    return this.s.model.isLocked(id);
  }

  // =========================================================================
  // Queries — read-only reflection of the session's scene model (the truth)
  // =========================================================================

  worldVersion(): number {
    return this.s.query.worldVersion();
  }
  getSceneTree(): SceneNode[] {
    return this.s.query.readSceneTree();
  }
  getEntity(id: EntityId): { name: string; kind: NodeKind; components: string[] } | null {
    return this.s.query.readEntity(id);
  }
  getInspector(entity: EntityId): InspectorComponent[] {
    return this.s.query.readInspector(entity);
  }
  getFieldValue(entity: EntityId, component: string, key: string): InspectorFieldValue | null {
    return this.s.query.getFieldValue(entity, component, key);
  }
  /**
   * Scene-wide validation sweep — the SAME truths the Details panel renders
   * (required fields left empty, component inert-state notices), aggregated so
   * automation can gate on them instead of reading red asterisks off pixels.
   * `problem: 'required-empty'` is error-grade (a Sprite with no texture draws
   * a white box); `problem: 'notice'` is informational.
   */
  getDiagnostics(): SceneDiagnostic[] {
    const issues: SceneDiagnostic[] = [];
    const visit = (nodes: SceneNode[]): void => {
      for (const node of nodes) {
        for (const comp of this.s.query.readInspector(node.id)) {
          for (const f of comp.fields) {
            if (f.required && isRequiredEmpty(f.value)) {
              issues.push({
                entity: node.id, entityName: node.name, component: comp.name, field: f.key,
                problem: 'required-empty',
                detail: `${comp.name}.${f.key} is required but empty`,
              });
            } else if (f.type === 'asset' && typeof f.value === 'string' && f.value !== '') {
              // The model value LOOKS healthy — only the registry/loader knows
              // whether it names a real, loadable asset (a dead ref draws the
              // same white box an empty one does, in silence).
              const why = assetRefProblem?.(f.value);
              if (why) {
                issues.push({
                  entity: node.id, entityName: node.name, component: comp.name, field: f.key,
                  problem: 'asset-unresolved',
                  detail: `${comp.name}.${f.key}: ${why}`,
                });
              }
            }
          }
          if (comp.notice) {
            issues.push({
              entity: node.id, entityName: node.name, component: comp.name,
              problem: 'notice', detail: comp.notice,
            });
          }
        }
        if (node.children?.length) visit(node.children);
      }
    };
    visit(this.s.query.readSceneTree());
    return issues;
  }
  /** The lossless JSON-first scene truth (deep clone), or null if none loaded. */
  serializeScene(): SceneData | null {
    return this.s.model.serialize();
  }

  // =========================================================================
  // Selection — the active entity(s). Stable source ids, self-healing on
  // removal (the store drops a despawned id). The canonical select primitive
  // for the headless host + MCP ("select, then inspect / modify").
  // =========================================================================

  /** The primary selected entity (drives Details + gizmo), or null. */
  getSelection(): EntityId | null {
    return this.s.selection.getState().selectedId;
  }
  /** The full multi-selection, primary last is not guaranteed; use getSelection() for the active one. */
  getSelectionIds(): EntityId[] {
    return [...this.s.selection.getState().selectedIds];
  }
  /** Replace the selection with one entity, or clear it with null. */
  select(id: EntityId | null): void {
    this.s.selection.getState().select(id);
  }
  /** Replace the selection with a set + a primary (box / shift-select). */
  selectMany(ids: EntityId[], primary: EntityId): void {
    this.s.selection.getState().selectMany(ids, primary);
  }
  /** Subscribe to selection changes. Returns an unsubscribe. */
  subscribeSelection(fn: () => void): () => void {
    return this.s.selection.subscribe(fn);
  }

  /** Viewport pick at a client position (what a click would select), or null. */
  pick(clientX: number, clientY: number): EntityId | null {
    return ViewportController.pickEntity(clientX, clientY);
  }

  /** Screen rect (CSS px rel. canvas) of an entity's selection bounds, or null. */
  entityScreenRect(id: EntityId): { x: number; y: number; w: number; h: number } | null {
    return ViewportController.getEntityScreenRect(id);
  }

  // =========================================================================
  // Observation — runtime evidence for verification (the headless-gap closer)
  // =========================================================================

  /**
   * Read the rendered viewport back as raw RGBA pixels. Requires a render host
   * with a live WebGL2 canvas (the live editor viewport, or the headless editor
   * window) — throws in a context without one (e.g. the pure-node test harness).
   * Capture right after a step(): the drawing buffer is valid until the next
   * frame, and with no rAF loop the headless host's buffer persists.
   */
  /**
   * Resize the render canvas (headless drivers): the engine follows on the
   * next stepped frame — GL tracks the canvas drawing buffer implicitly,
   * WebGPU reconfigures its swapchain through the same per-frame size source.
   */
  resizeViewport(width: number, height: number): void {
    const canvas = EngineHost.canvas;
    if (!canvas) throw new Error('resizeViewport requires a render host (no canvas)');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  /**
   * Enable/disable the editor reference grid (headless verification + MCP).
   * Enabling also seeds + activates the editor view — the edit-mode camera the
   * grid draws through — since the headless host boots with it inactive.
   */
  setGrid(enabled: boolean, spacing?: number): void {
    if (enabled) EngineHost.syncEditorViewToScene();
    EngineHost.setGrid(enabled, spacing);
  }

  captureViewport(): ViewportCapture {
    const canvas = EngineHost.canvas;
    if (!canvas) {
      throw new Error(
        'captureViewport requires a render host (no canvas) — run under the live viewport or the headless editor window',
      );
    }
    const width = canvas.width;
    const height = canvas.height;
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl) {
      const rgba = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return { rgba, width, height };
    }
    // Non-GL canvas (the WebGPU backend): read the presented frame back
    // through a 2D-canvas copy — the compositor path works for any context
    // type. getImageData rows are top-down; flip to the bottom-up order the
    // GL readback established (the capture consumers all assume it).
    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const ctx2d = copy.getContext('2d');
    if (!ctx2d) throw new Error('captureViewport: no 2d context for the readback copy');
    ctx2d.drawImage(canvas, 0, 0);
    const img = ctx2d.getImageData(0, 0, width, height);
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      rgba.set(img.data.subarray(src, src + width * 4), y * width * 4);
    }
    return { rgba, width, height };
  }

  /**
   * Render a material to an offscreen @p w×@p h target (a "material ball" preview), found by the
   * handle a scene sprite carries — so a loaded scene's material can be previewed without
   * re-loading it. Reuses the real render path; the pixel readback rides the engine's async
   * seam (immediate on GL, a later event-loop turn on WebGPU), so the result is awaited.
   * Null if no sprite material is in the scene.
   */
  async renderSceneMaterialPreview(w: number, h: number): Promise<ViewportCapture | null> {
    const world = EngineHost.world;
    if (!world) return null;
    for (const e of world.getAllEntities()) {
      if (!world.has(e, Sprite)) continue;
      const mat = (world.get(e, Sprite) as { material: number }).material;
      if (!mat) continue;
      const img = await Material.renderPreview(mat, w, h);
      if (img) return { rgba: new Uint8Array(img.data), width: img.width, height: img.height };
    }
    return null;
  }

  /** Live counts for quick assertions (entity count + last frame's merged draw calls). */
  getStats(): { entities: number; drawCalls: number } {
    return {
      entities: EngineHost.world?.entityCount() ?? 0,
      drawCalls: EngineHost.module?.renderer_getDrawCalls?.() ?? 0,
    };
  }

  /** The current profiler snapshot: frame timing, stat-unit segments, per-system
   *  timings, counters, memory, and GPU — the full per-frame telemetry. */
  getFrameStats(): PerfSnapshot {
    return PerfMonitor.getSnapshot();
  }
  /** Subscribe to profiler snapshot changes. Returns an unsubscribe. */
  subscribeFrameStats(fn: () => void): () => void {
    return PerfMonitor.subscribe(fn);
  }
  /** A captured frame's full breakdown by id (phases, cpp/gpu scopes, long tasks),
   *  or null if it scrolled out of the ring. */
  getFrameSample(id: number): FrameSample | null {
    return PerfMonitor.getSample(id);
  }
  /** Start/stop recording a session; exportProfileSession() returns the captured
   *  frames (or the live ring) for offline analysis. */
  startProfileRecording(): void {
    PerfMonitor.startRecording();
  }
  stopProfileRecording(): void {
    PerfMonitor.stopRecording();
  }
  exportProfileSession(): SessionCapture {
    return PerfMonitor.exportSession();
  }

  /**
   * The lifecycle + liveness of every engine subsystem (physics, audio, …) in
   * this realm's engine — the "what's loaded and actually running" surface.
   * Each entry carries phase (registered/initializing/ready/error) and derived
   * activity (stepping/idle/inactive). The MCP server later marshals this same
   * read over IPC; the editor UI reads it directly.
   */
  getSubsystems(): SubsystemStatus[] {
    return EngineHost.getSubsystemsSnapshot();
  }

  /** Subscribe to subsystem status changes (phase transitions + sampled liveness). */
  subscribeSubsystems(fn: () => void): () => void {
    return EngineHost.subscribeSubsystems(fn);
  }
}

// The app's default-session surface is `EditorSession.default.surface`, exported
// as `EditorControlSurface` from EditorSession.ts — one default surface, owned by
// the session (no parallel singleton here).
export type EditorControlSurfaceT = EditorControlSurfaceImpl;
