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
  EnumOption,
  InspectorComponent,
  InspectorField,
  InspectorFieldType,
  InspectorFieldValue,
  SceneNode,
} from '@/types';
import type { SceneData, PrefabData, SubsystemStatus, EventBindingRow } from 'esengine';
import { Material, Sprite, Renderer } from 'esengine';
import { EngineHost } from './EngineHost';
import { isRequiredEmpty, componentByName, userSchema, coerceEnumInput, componentAuthorability, inspectorFields, modelAddableComponentEntries } from './schema';
import { ViewportController } from './ViewportController';
import { PerfMonitor, type PerfSnapshot, type FrameSample, type SessionCapture } from './PerfMonitor';
import type { SceneCommandsImpl, EditorTransaction } from './SceneCommands';
import type { SceneQueryImpl, EntityInfo } from './SceneQuery';
import type { SceneModelImpl } from './SceneModel';
import type { EditorHistoryImpl, HistoryMark } from './EditorHistory';
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
/**
 * The members a structural field can be addressed by, and where each one sits
 * in the value the inspector holds.
 *
 * Automation writes field PATHS ("Transform.position.x"), which read as CSS-ish
 * and are what an agent reaches for first — the MCP tool even documented that
 * exact example while rejecting it, because the inspector's field is `position`,
 * a whole vec3. Rather than make callers read back a vector, patch a component
 * and send the vector, a member path resolves to the field plus an index into it.
 */
const FIELD_MEMBERS: Partial<Record<InspectorFieldType, Record<string, number | string>>> = {
  vec2: { x: 0, y: 1 },
  vec3: { x: 0, y: 1, z: 2 },
  sides: { left: 0, top: 1, right: 2, bottom: 3 },
  dimension: { value: 'value', unit: 'unit' },
};

/** Split "position.x" into the field key and the member, when the field has one. */
export function splitFieldMember(
  key: string,
  fieldTypeOf: (k: string) => InspectorFieldType | undefined,
): { key: string; member: string; type: InspectorFieldType } | null {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  const base = key.slice(0, dot);
  const member = key.slice(dot + 1);
  const type = fieldTypeOf(base);
  if (!type) return null;
  return FIELD_MEMBERS[type]?.[member] !== undefined ? { key: base, member, type } : null;
}

/** Write `value` into `member` of a structural field's current value. */
export function patchFieldMember(
  type: InspectorFieldType,
  current: InspectorFieldValue,
  member: string,
  value: unknown,
): InspectorFieldValue {
  const at = FIELD_MEMBERS[type]?.[member];
  if (at === undefined) throw new Error(`"${type}" has no member "${member}"`);
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`member "${member}" expects a number, got ${JSON.stringify(value)}`);
  }
  if (typeof at === 'number') {
    const arr = Array.isArray(current) ? [...(current as number[])] : [];
    while (arr.length <= at) arr.push(0);
    arr[at] = n;
    return arr as InspectorFieldValue;
  }
  const obj = current !== null && typeof current === 'object' && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};
  obj[at] = n;
  return obj as InspectorFieldValue;
}

/**
 * What a field will accept, as the inspector already describes it — structurally
 * a subset of InspectorField, so the write door hands its field straight in.
 *
 * Taken whole rather than as loose parameters because the constraints kept being
 * enforced one at a time: the control clamped to a range the automation door
 * never read, and each new rule meant another argument that existing callers
 * silently didn't pass.
 */
export interface FieldConstraints {
  /** An enum's options — a NAME-valued set ("walk", "Dragon") says whether a
   *  string is a legal value or a typo; a numeric one lists the ordinals. */
  options?: readonly EnumOption[];
  /** `InspectorField.open` — options are suggestions and a value outside them is
   *  legal. From the enum source's declaration, which the control reads too. */
  open?: boolean;
  /** A numeric field's declared range (ES_PROPERTY min/max). */
  min?: number;
  max?: number;
}

export function coerceFieldValue(
  declared: InspectorFieldType,
  key: string,
  value: InspectorFieldValue,
  field?: FieldConstraints,
): InspectorFieldValue {
  const { options, open, min, max } = field ?? {};
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
    case 'enum': {
      // Whether a value the options don't list is a new layer/key or a typo is the
      // field's own answer, and coerceEnumInput is where every writer asks it —
      // this door used to answer it separately and disagree with the control.
      if (!options?.length) {
        // No options to check against (a source that isn't warm, a test): the
        // field is an ordinal, so all that is knowable is that it is a number.
        const n = Number(value);
        return Number.isFinite(n) ? n : fail('a number');
      }
      if (typeof value !== 'string' && typeof value !== 'number') return fail('a name or a number');
      const v = coerceEnumInput(value, options, open ?? false);
      if (v !== null) return v;
      return fail(
        open
          ? 'a whole number'
          : `one of: ${options.map((o) => (o.label === String(o.value) ? o.label : `${o.value} (${o.label})`)).join(', ')}`,
      );
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return fail('a number');
      // The declared range binds every writer. The control clamps a drag and a
      // keystroke to it; this door REFUSES instead of clamping, because a caller
      // that asked for 5 on a 0..1 field wants to hear so, not to find 1 stored.
      if (min != null && n < min) return fail(`at least ${min}`);
      if (max != null && n > max) return fail(`at most ${max}`);
      return n;
    }
    case 'flags': {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return fail('a whole number of bits');
      // A flag IS a bit, and the options are the bits that exist. The control can
      // only ever toggle those; this door used to take any number at all, so a
      // mask with bits nothing declares went straight into the component.
      const declaredBits = (options ?? []).reduce((m, o) => m | (Number(o.value) || 0), 0);
      if (declaredBits !== 0 && (n & ~declaredBits) !== 0) {
        return fail(`only the declared bits (mask ${declaredBits})`);
      }
      return n;
    }
    case 'entity': {
      // A source-id reference to another entity — a plain number.
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
    case 'vec3':
    case 'vec4': {
      const n = declared === 'vec2' ? 2 : declared === 'vec3' ? 3 : 4;
      let v: unknown = value;
      if (typeof v === 'string') v = parseJsonText(v);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        v = n === 2 ? [o.x, o.y] : n === 3 ? [o.x, o.y, o.z] : [o.x, o.y, o.z, o.w];
      }
      if (!Array.isArray(v) || v.length < n || v.slice(0, n).some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
        const example = n === 2 ? '[16, 16]' : n === 3 ? '[0, 0, 0]' : '[0, 0, 1, 1]';
        return fail(`${n} numbers (e.g. ${example})`);
      }
      return v.slice(0, n) as InspectorFieldValue;
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
    case 'sides': {
      // A four-edge box — accept [left, top, right, bottom] or { left, top, right, bottom }.
      let v: unknown = value;
      if (typeof v === 'string') v = parseJsonText(v);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        v = [o.left, o.top, o.right, o.bottom];
      }
      if (!Array.isArray(v) || v.length < 4 || v.slice(0, 4).some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
        return fail('4 numbers (e.g. [8, 8, 8, 8]) or { left, top, right, bottom }');
      }
      return v.slice(0, 4) as InspectorFieldValue;
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

  /**
   * Take an undo checkpoint — the "before" of an agent turn, so a whole turn
   * reverts in one gesture while each edit it made stays an ordinary undo step.
   *
   * Deliberately NOT in the tool catalog: the checkpoint belongs to whoever is
   * driving the turn (the agent kernel, and the UI that offers the revert), not
   * to the model running inside it. A model that could roll itself back could
   * also undo the user's own work and call it a correction.
   */
  mark(): HistoryMark {
    return this.s.history.mark();
  }
  /** Edits recorded since `mark` that are still undoable — 0 means the turn
   *  changed nothing, or its work is no longer the newest thing on the stack. */
  stepsSince(mark: HistoryMark): number {
    return this.s.history.stepsSince(mark);
  }
  /** Revert everything recorded since `mark`; returns how many steps were undone. */
  undoToMark(mark: HistoryMark): number {
    return this.s.history.undoToMark(mark);
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
    const field = comp.fields.find((f) => f.key === key);
    const declared: InspectorFieldType | undefined =
      field?.type ?? (comp.enable?.key === key ? 'bool' : undefined);
    if (!declared) {
      // "position.x" / "gap.y" / "padding.left": one member of a structural field.
      const nested = splitFieldMember(key, (k) => comp.fields.find((f) => f.key === k)?.type);
      if (nested) {
        const whole = comp.fields.find((f) => f.key === nested.key)!;
        this.s.commands.setField(
          entity, component, nested.key, nested.type,
          patchFieldMember(nested.type, whole.value, nested.member, value),
        );
        return;
      }
      const keys = [...comp.fields.map((f) => f.key), ...(comp.enable ? [comp.enable.key] : [])];
      throw new Error(`"${component}" has no field "${key}" (fields: ${keys.join(', ')})`);
    }
    this.s.commands.setField(entity, component, key, declared, coerceFieldValue(declared, key, value, field));
  }
  /**
   * Add a component (by schema name) to an entity — the Details "Add Component" door.
   *
   * A name with no schema is REFUSED rather than skipped: the add already needs the
   * schema for its default data, so an unknown name simply produced nothing, and a
   * caller that then wrote a field got "component X is not on entity" about a
   * component it believed it had just added.
   */
  addComponent(entity: EntityId, component: string): void {
    if (!componentByName(component) && !userSchema(component)) {
      // A project's OWN components come from its declaration script, which the
      // editor extracts schemas from — so a component that exists only as a file
      // nobody imports is one the editor has never heard of. Said here because
      // the caller has just written that file and is being refused by the door
      // that knows exactly what is missing.
      throw new Error(
        `no component schema named "${component}" — the editor cannot add it. A project's own `
        + 'components are picked up from its declaration script (src/components.ts by default, or '
        + '`scripts.register` in project.esproject): define it there with defineComponent, or import '
        + 'the file that does, and it becomes addable.',
      );
    }
    // The Add Component list hides these; the command that performs the add drops
    // them too. Said out loud here because a driver that is refused deserves the
    // reason — this door used to name EventBinding's own door only in the message
    // for an UNKNOWN component, which is the one case EventBinding never hits.
    const authorable = componentAuthorability(component);
    if (!authorable.ok) {
      throw new Error(
        authorable.reason === 'transient'
          ? `"${component}" is runtime-only state, not something a scene authors.`
          : `"${component}" is not authored as a component — it has its own door `
            + '(EventBinding: setEventBindings; UIController/UIGear: the Controllers panel; '
            + 'Parent/Children: setParent; Name: renameEntity).',
      );
    }
    this.s.commands.addComponent(entity, component);
  }
  /** An entity's authored event wires (EventBinding rows). */
  getEventBindings(entity: EntityId): EventBindingRow[] {
    return this.s.commands.eventBindings(entity);
  }
  /**
   * Replace an entity's authored event wires in one undo step — the data form of
   * "when this button is clicked, run that action". The Details Events section adds
   * them one at a time; an importer converting a whole panel's wiring wants the list.
   */
  setEventBindings(entity: EntityId, rows: readonly EventBindingRow[]): void {
    this.s.commands.setEventBindings(entity, rows);
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

  /** Run `fn` as one undo step, rolling structural edits back too if it throws. */
  atomic(label: string, fn: () => void): void {
    this.s.commands.atomic(label, fn);
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
  getEntity(id: EntityId): EntityInfo | null {
    return this.s.query.readEntity(id);
  }
  getInspector(entity: EntityId): InspectorComponent[] {
    return this.s.query.readInspector(entity);
  }
  /**
   * A component TYPE's fields — key, label, inspector type, enum options and the
   * default value — WITHOUT needing an entity that already carries one.
   *
   * The only way to learn a component's schema was to create an entity, add the
   * component and inspect it. A driver that skipped that guessed instead: three
   * round trips to find out ShapeRenderer's field is `shapeType` (not `shape`,
   * not `fill`) and that it takes 0/1/2 rather than "rectangle". The registry
   * knew all of that from the start.
   */
  describeComponent(
    component?: string | null,
  ): InspectorField[] | Array<{ name: string; label: string; category: string }> {
    // No name: the catalog itself. "What can I put on an entity" had no door at
    // all — a driver that did not already know a name guessed ("FSMComponent",
    // "StateMachine") and was refused by each in turn. The Add Component menu
    // has always had this list; it was reachable only by opening the menu.
    if (!component) {
      return modelAddableComponentEntries({ id: 0, name: '', parent: null, children: [], components: [] });
    }
    return inspectorFields(component, {});
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
    const tree = this.s.query.readSceneTree();
    visit(tree);

    // Scene-level: a scene with content and no camera renders NOTHING when the
    // game runs. The editor has an eye of its own, so the viewport looks right
    // and Play is black — the sharpest way the editor can lie to you, and one an
    // author (or an agent) has no way to attribute. Only worth saying when there
    // is something to look at: an empty scene is a scene being started.
    const hasContent = (nodes: SceneNode[]): boolean =>
      nodes.some((n) => n.kind !== 'camera' || (n.children?.length ? hasContent(n.children) : false));
    const hasCamera = (nodes: SceneNode[]): boolean =>
      nodes.some((n) => n.kind === 'camera' || (n.children?.length ? hasCamera(n.children) : false));
    if (tree.length > 0 && hasContent(tree) && !hasCamera(tree)) {
      issues.push({
        entity: -1, entityName: '', component: 'Camera', problem: 'notice',
        detail: 'this scene has no Camera — it draws in the editor (which has its own view) and '
          + 'renders NOTHING when the game runs. Add a Camera entity.',
      });
    }
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

  /**
   * Viewport pick at a client position (what a click would select), or null.
   *
   * Answers with the SOURCE id — the id every other door on this surface speaks
   * (select, getEntity, worldComp, the scene tree). The viewport picks in runtime
   * ids because that is what it hit-tests, but handing one out here gives a caller
   * an id it cannot pass to anything, which reads as "pick returned the wrong
   * entity" rather than "that was a different id space".
   */
  pick(clientX: number, clientY: number): EntityId | null {
    const rt = ViewportController.pickEntity(clientX, clientY);
    return (rt == null ? null : this.s.model.sourceFor(rt)) ?? null;
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
   * Resize the render canvas's DRAWING BUFFER (headless drivers): the engine
   * follows on the next stepped frame — GL tracks the canvas drawing buffer
   * implicitly, WebGPU reconfigures its swapchain through the same per-frame
   * size source. This is also the resolution `captureViewport` reads.
   *
   * Deliberately does NOT touch `canvas.style`: the canvas is laid out at
   * `width/height: 100%` of its container, and pinning a pixel CSS size here
   * permanently detaches it from that container — in the live editor the panel
   * then keeps growing while the canvas does not, and the frame is drawn
   * stretched into a stale box. A driver that wants the LIVE viewport to be a
   * given size must size its PANEL (`setPanelSize`) and let layout drive the
   * canvas; the drawing buffer follows via EngineHost's ResizeObserver.
   */
  resizeViewport(width: number, height: number): void {
    const canvas = EngineHost.canvas;
    if (!canvas) throw new Error('resizeViewport requires a render host (no canvas)');
    canvas.width = width;
    canvas.height = height;
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
