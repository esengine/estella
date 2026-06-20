/**
 * @file    EditorControlSurface.ts
 * @brief   The single canonical programmatic entry to the editor — lifecycle,
 *          commands, queries, and observation — composed over the existing
 *          engine modules. One surface, three consumers: the React UI, the
 *          headless verification host, and (later) the editor MCP server, which
 *          is a transport adapter over this object rather than a parallel API.
 *
 * Design and phasing: docs/REARCH_EDITOR_AUTOMATION.md. This adds no new truth —
 * commands route through SceneCommands (the model write boundary), reads through
 * SceneQuery / SceneModel (the model is the source of truth; the World is a
 * derived projection), and observation reads the live canvas/World. Ids are
 * stable source ids (REARCH_EDITOR_MODEL.md).
 */
import type {
  EntityId,
  InspectorComponent,
  InspectorFieldType,
  InspectorFieldValue,
  NodeKind,
  SceneNode,
} from '@/types';
import type { SceneData } from 'esengine';
import { EngineHost } from './EngineHost';
import { SceneCommands } from './SceneCommands';
import { SceneQuery } from './SceneQuery';
import { SceneModel } from './SceneModel';
import { EditorHistory } from './EditorHistory';

/** A captured viewport frame: raw RGBA pixels (GL order: bottom-up rows). */
export interface ViewportCapture {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export const EditorControlSurface = {
  // =========================================================================
  // Lifecycle — drive the engine deterministically and switch run mode
  // =========================================================================

  /**
   * Load a scene into the live World, resolving `@uuid:` asset refs via the
   * manifest. Returns the spawned entity count. The async-driving counterpart to
   * opening a scene in the UI; used by verification to set up a known scene.
   */
  async loadScene(sceneUrl: string, manifestUrl?: string): Promise<number> {
    return EngineHost.loadScene(sceneUrl, manifestUrl);
  },

  /**
   * Switch edit↔play. Play snapshots the scene; Stop restores it (gameplay never
   * dirties the edit scene). Returns true if a play→edit restore happened (entity
   * ids changed — drop any cached selection).
   */
  setRunMode(playing: boolean, paused = false): boolean {
    return EngineHost.setRunMode(playing, paused);
  },

  /**
   * Advance the engine by exactly `frames` fixed-delta ticks — no rAF, no
   * wall-clock — so a subsequent capture is reproducible. Use after loadScene /
   * setRunMode and before captureViewport. Drives the engine directly, so it
   * belongs to a host that does NOT run app.run()'s loop (the headless host).
   */
  async step(frames = 1, dt = 1 / 60): Promise<void> {
    for (let i = 0; i < frames; i++) await EngineHost.tick(dt);
  },

  undo(): void {
    EditorHistory.undo();
  },
  redo(): void {
    EditorHistory.redo();
  },
  canUndo(): boolean {
    return EditorHistory.canUndo();
  },
  canRedo(): boolean {
    return EditorHistory.canRedo();
  },

  // =========================================================================
  // Commands — mutations, all undoable, through the SceneCommands write door
  // =========================================================================

  addEntity(): EntityId | null {
    return SceneCommands.addEntity();
  },
  deleteEntity(id: EntityId): void {
    SceneCommands.deleteEntity(id);
  },
  duplicateEntity(id: EntityId): EntityId | null {
    return SceneCommands.duplicateEntity(id);
  },
  renameEntity(id: EntityId, name: string): void {
    SceneCommands.renameEntity(id, name);
  },
  setField(
    entity: EntityId,
    component: string,
    key: string,
    type: InspectorFieldType,
    value: InspectorFieldValue,
  ): void {
    SceneCommands.setField(entity, component, key, type, value);
  },
  setEntityXY(id: EntityId, x: number, y: number): void {
    SceneCommands.setEntityXY(id, x, y);
  },
  /** Coalesce a burst of setField writes (a drag) into one undo step. */
  beginGesture(label: string): void {
    SceneCommands.beginGesture(label);
  },
  endGesture(): void {
    SceneCommands.endGesture();
  },

  // =========================================================================
  // Queries — read-only reflection of the scene model (the source of truth)
  // =========================================================================

  worldVersion(): number {
    return SceneQuery.worldVersion();
  },
  getSceneTree(): SceneNode[] {
    return SceneQuery.readSceneTree();
  },
  getEntity(id: EntityId): { name: string; kind: NodeKind; components: string[] } | null {
    return SceneQuery.readEntity(id);
  },
  getInspector(entity: EntityId): InspectorComponent[] {
    return SceneQuery.readInspector(entity);
  },
  getFieldValue(entity: EntityId, component: string, key: string): InspectorFieldValue | null {
    return SceneQuery.getFieldValue(entity, component, key);
  },
  /** The lossless JSON-first scene truth (deep clone), or null if none loaded. */
  serializeScene(): SceneData | null {
    return SceneModel.serialize();
  },

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
  captureViewport(): ViewportCapture {
    const canvas = EngineHost.canvas;
    if (!canvas) {
      throw new Error(
        'captureViewport requires a render host (no canvas) — run under the live viewport or the headless editor window',
      );
    }
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) throw new Error('captureViewport: no WebGL2 context on the viewport canvas');
    const width = canvas.width;
    const height = canvas.height;
    const rgba = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return { rgba, width, height };
  },

  /** Live counts for quick assertions (entity count is headless-friendly). */
  getStats(): { entities: number } {
    return { entities: EngineHost.world?.getAllEntities().length ?? 0 };
  },
};

export type EditorControlSurfaceT = typeof EditorControlSurface;
