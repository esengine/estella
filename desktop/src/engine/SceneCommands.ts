// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneData, PrefabData, ProcessedEntity } from 'esengine';
import { TilemapAPI } from 'esengine';
import type { EntityId, InspectorFieldType, InspectorFieldValue } from '@/types';
import { EditorHistory, EditorHistoryImpl } from './EditorHistory';
import { SceneModel, SceneModelImpl } from './SceneModel';
import { expandInstance } from './PrefabInstance';
import {
  componentByName,
  componentDefaults,
  componentEnable,
  isRenderComponent,
  userSchema,
  angleZToQuat,
  hexToRgb,
  prettyLabel,
} from './schema';

type SceneEntity = SceneData['entities'][number];
type SceneComponent = SceneEntity['components'][number];
/** A reversible model mutation: `forward` (re)applies it, `reverse` undoes it. */
type UndoOp = { forward: () => void; reverse: () => void };

/** A single tile edit: set the tile at grid (x, y) to `tileId` (0 = erase). */
export interface TilePaint {
  x: number;
  y: number;
  tileId: number;
}

/**
 * A scoped edit transaction (the editor's FScopedTransaction). A burst of field
 * writes between open and `commit` collapses into one undo step; `abort` reverts
 * them live and records nothing. Hand it to a tool's drag so the stroke is one
 * undoable step with cancel support.
 */
export interface EditorTransaction {
  commit(): void;
  abort(): void;
}

// — Model-authoritative commands —
//
// Every mutation edits the SceneModel ONLY (the session's source of truth). The
// model emits a change event; the Reconciler projects it to the World. Nothing
// here touches the World — so the World is a pure derived projection that cannot
// desync. Undo records MODEL operations (lossless by construction: the model
// holds every component, incl. unknown ones + @uuid: refs + the parent link).
//
// All ids are stable **source ids** — the editor's id space (the viewport
// resolves a runtime pick to its source id before calling in). Commands are an
// instance bound to a session's model + history (EditorSession), so they can be
// isolated per session/test; `SceneCommands` is the app's default-session one.

const DEFAULT_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

const editKey = (sourceId: number, comp: string, key: string) => `${sourceId}|${comp}|${key}`;

// Value equality over the SceneData-format shapes a field can hold (number /
// bool / string / vec / quat / color object). JSON compare is exact for these.
const valueEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Convert an inspector control value to its SceneData-format model value,
 * merging into the current value where the control edits a slice (vec
 * components keep the untouched axis; color keeps alpha). 2D rotation is stored
 * as a quaternion; angle controls convert degrees↔quat.
 */
export function toModelValue(
  cur: Record<string, unknown>,
  type: InspectorFieldType,
  key: string,
  value: InspectorFieldValue,
): unknown {
  switch (type) {
    case 'number':
    case 'enum':
    case 'flags':
      return Number(value);
    case 'bool':
      return Boolean(value);
    case 'string':
      return String(value);
    case 'vec2': {
      const [x, y] = value as [number, number];
      return { ...(cur[key] as object), x, y };
    }
    case 'vec3': {
      const [x, y, z] = value as [number, number, number];
      return { ...(cur[key] as object), x, y, z };
    }
    case 'angle':
      return angleZToQuat(Number(value));
    case 'color': {
      const a = (cur[key] as { a?: number } | undefined)?.a ?? 1;
      return { ...(cur[key] as object), ...hexToRgb(String(value)), a };
    }
    default:
      return value;
  }
}

interface FieldEdit {
  sourceId: number;
  comp: string;
  key: string;
  before: unknown; // model (SceneData-format) value before the gesture
}

/** A hook on the field-edit door; returns true to suppress the scene write. */
export type EditHook = (
  sourceId: EntityId,
  compName: string,
  key: string,
  type: InspectorFieldType,
  value: InspectorFieldValue,
) => boolean;

export class SceneCommandsImpl {
  // — Field-edit gesture: coalesce a focus→blur / drag into a single undo step. —
  // Undo recording is INTERNAL: the only public write door is `setField` (and
  // `setEntityXY`, which routes through it), and it always records. Outside a
  // gesture, one `setField` = one undo step. Inside a gesture, writes coalesce —
  // the BEFORE model value is captured on first touch of each field, the AFTER
  // value read at `endGesture`, and the pair recorded as one model-op step.
  private gesture: { label: string; touched: Map<string, FieldEdit> } | null = null;

  // Optional observer/interceptor on the field-edit door — the Sequencer's record
  // mode registers it to auto-key edits. Returning true
  // SUPPRESSES the scene write (reserved for future non-destructive record);
  // the recorder returns false (observe-only) so the edit still lands normally.
  // Kept generic: SceneCommands knows nothing about timelines.
  private editHook: EditHook | null = null;
  // An in-progress tilemap paint stroke: the chunk blob snapshotted at stroke start
  // ({@link beginTilePaint}), committed as one undo step at {@link endTilePaint}.
  private tilePaint: { sourceId: number; before: string } | null = null;

  constructor(
    private readonly model: SceneModelImpl,
    private readonly history: EditorHistoryImpl,
  ) {}

  /** Register (or clear) the field-edit hook. One slot; last writer wins. */
  setEditHook(fn: EditHook | null): void {
    this.editHook = fn;
  }

  /** The current model value of one field, or undefined. */
  private modelFieldValue(sourceId: number, comp: string, key: string): unknown {
    const c = this.model.entityBySource(sourceId)?.components.find((c) => c.type === comp);
    return c ? (c.data as Record<string, unknown>)[key] : undefined;
  }

  // True if walking up from `nodeSrc` reaches `ancestorSrc` — rejects re-parenting
  // an entity under its own descendant (a cycle). Reads the model hierarchy.
  private isModelAncestor(nodeSrc: number, ancestorSrc: number): boolean {
    let cur: number | null = nodeSrc;
    const seen = new Set<number>();
    while (cur != null) {
      if (cur === ancestorSrc) return true;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = this.model.entityBySource(cur)?.parent ?? null;
    }
    return false;
  }

  /**
   * Open a coalescing edit gesture. Every `setField` until {@link endGesture}
   * folds into one undo step. Idempotent-safe: a dangling gesture is committed
   * before a new one opens.
   */
  beginGesture(label: string): void {
    if (this.gesture) this.endGesture();
    this.gesture = { label, touched: new Map() };
  }

  /** Close the current gesture, recording all coalesced field edits as one undo step. */
  endGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.touched.size === 0) return;
    const edits = [...g.touched.values()]
      .map((e) => ({ ...e, after: structuredClone(this.modelFieldValue(e.sourceId, e.comp, e.key)) }))
      .filter((e) => !valueEqual(e.before, e.after));
    if (edits.length === 0) return;
    this.history.record(
      g.label,
      () => edits.forEach((e) => this.model.setField(e.sourceId, e.comp, e.key, e.after)),
      () => edits.forEach((e) => this.model.setField(e.sourceId, e.comp, e.key, e.before)),
    );
  }

  /**
   * Cancel the current gesture: restore each touched field to its captured BEFORE
   * value (live — the viewport snaps back via the Reconciler) and discard it with
   * no undo step. Powers a tool drag's Esc-to-cancel.
   */
  abortGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    for (const e of g.touched.values()) this.model.setField(e.sourceId, e.comp, e.key, e.before);
  }

  /**
   * Open a scoped edit transaction over the coalescing gesture — the modern
   * handle form of {@link beginGesture}/{@link endGesture} with cancel support.
   * One transaction is active at a time (one stroke); the handle is idempotent.
   */
  transaction(label: string): EditorTransaction {
    this.beginGesture(label);
    let done = false;
    return {
      commit: () => { if (!done) { done = true; this.endGesture(); } },
      abort: () => { if (!done) { done = true; this.abortGesture(); } },
    };
  }

  /** Run `fn` inside a transaction: commit on return, abort + rethrow on throw. */
  transact(label: string, fn: () => void): void {
    const tx = this.transaction(label);
    try {
      fn();
      tx.commit();
    } catch (e) {
      tx.abort();
      throw e;
    }
  }

  /**
   * Write a single inspector field to the model (the Reconciler re-projects it
   * to the World). Always undoable: coalesced into an open gesture, else its own step.
   */
  setField(
    sourceId: EntityId,
    compName: string,
    key: string,
    type: InspectorFieldType,
    value: InspectorFieldValue,
  ): void {
    // The edit hook (Sequencer record) may observe — or, returning true, suppress.
    if (this.editHook && this.editHook(sourceId, compName, key, type, value)) return;
    const e = this.model.entityBySource(sourceId);
    if (!e) return;
    const cur = (e.components.find((c) => c.type === compName)?.data as Record<string, unknown>) ?? {};

    const k = editKey(sourceId, compName, key);
    const firstTouch = !this.gesture || !this.gesture.touched.has(k);
    const before = firstTouch ? structuredClone(cur[key]) : undefined;

    const after = toModelValue(cur, type, key, value);
    this.model.setField(sourceId, compName, key, after);

    if (this.gesture) {
      if (firstTouch) this.gesture.touched.set(k, { sourceId, comp: compName, key, before });
      return;
    }
    // No open gesture → this edit is its own undo step.
    if (valueEqual(before, after)) return;
    this.history.record(
      `Edit ${prettyLabel(key)}`,
      () => this.model.setField(sourceId, compName, key, after),
      () => this.model.setField(sourceId, compName, key, before),
    );
  }

  /** Move an entity to a world position (keeps Z). Undoable like any field edit. */
  setEntityXY(sourceId: EntityId, x: number, y: number): void {
    const pos = this.modelFieldValue(sourceId, 'Transform', 'position') as { z?: number } | undefined;
    if (pos === undefined && !this.model.entityBySource(sourceId)) return;
    this.setField(sourceId, 'Transform', 'position', 'vec3', [x, y, pos?.z ?? 0]);
  }

  // — Undoable entity lifecycle (model ops; the Reconciler re-spawns/-despawns) —

  /** Spawn a new empty entity (with a Transform). Returns its source id. */
  addEntity(): EntityId | null {
    if (!this.model.current) return null;
    const sourceId = this.model.addEntity('Entity', [
      { type: 'Transform', data: structuredClone(DEFAULT_TRANSFORM) } as SceneComponent,
    ]);
    let record: SceneEntity | undefined;
    this.history.record(
      'Add Entity',
      () => {
        if (record) this.model.restoreEntity(record);
      },
      () => {
        record = this.model.removeEntityBySource(sourceId);
      },
    );
    return sourceId;
  }

  /**
   * Delete an entity AND its descendants (the World despawns children with their
   * parent, so the model removes the whole subtree to stay consistent). Undo
   * re-creates the subtree losslessly, parent-before-child. Records are kept
   * parent-first so restore re-links each child to its (already-restored) parent.
   */
  deleteEntity(sourceId: EntityId): void {
    const entity = this.model.entityBySource(sourceId);
    if (!entity) return;
    const name = entity.name || 'Entity';
    const remove = (): SceneEntity[] =>
      this.model
        .collectSubtree(sourceId)
        .map((id) => this.model.removeEntityBySource(id))
        .filter((r): r is SceneEntity => r !== undefined);

    let records = remove();
    if (records.length === 0) return;
    this.history.record(
      `Delete ${name}`,
      () => {
        records = remove(); // redo
      },
      () => {
        for (const r of records) this.model.restoreEntity(r); // parent-first
      },
    );
  }

  /** Duplicate an entity (offset slightly, as a sibling). Returns the new source id. */
  duplicateEntity(sourceId: EntityId): EntityId | null {
    const src = this.model.entityBySource(sourceId);
    if (!src) return null;
    // Clone the SOURCE record (preserves unknown components/fields + @uuid: refs
    // the World projection can't carry), with the standard paste offset.
    const components = structuredClone(src.components) as SceneComponent[];
    const pos = (components.find((c) => c.type === 'Transform')?.data as
      | { position?: { x: number; y: number } }
      | undefined)?.position;
    if (pos) {
      pos.x += 24;
      pos.y -= 24;
    }
    const newSourceId = this.model.addEntity(src.name, components, src.parent ?? null);
    let record: SceneEntity | undefined;
    this.history.record(
      `Duplicate ${src.name || 'Entity'}`,
      () => {
        if (record) this.model.restoreEntity(record);
      },
      () => {
        record = this.model.removeEntityBySource(newSourceId);
      },
    );
    return newSourceId;
  }

  /**
   * Instantiate a prefab into the scene under `parent`:
   * expand the asset into the model as ordinary entities (the Reconciler spawns
   * them), tagged with their prefab origin so save can collapse the subtree back
   * to a delta. The caller (ProjectStore / UI) loads the PrefabData asset; this
   * stays synchronous + undoable. Returns the instance root's source id.
   */
  instantiatePrefab(
    prefab: PrefabData,
    ref: string,
    parent: EntityId | null,
    position?: { x: number; y: number },
  ): EntityId | null {
    if (!this.model.current) return null;
    const { entities, rootId } = expandInstance(
      prefab,
      { prefab: ref, overrides: [], added: [], removed: [] },
      () => this.model.allocateSourceId(),
    );
    const root = entities.find((e) => e.id === rootId);
    if (!root) return null;
    root.parent = parent; // attach under the scene parent

    // Place the instance at the drop point — a Transform.position edit that
    // diffAgainstSource captures as a property override on save (so the prefab
    // asset stays at its authored origin; the instance carries the placement).
    if (position) {
      const tf = root.components.find((c) => c.type === 'Transform');
      if (tf) {
        const p = ((tf.data as Record<string, unknown>).position ??= { x: 0, y: 0, z: 0 }) as { x: number; y: number; z: number };
        p.x = position.x;
        p.y = position.y;
      }
    }

    // ProcessedEntity → SceneEntity (drop prefab fields); deep-clone components so
    // later edits to the instance don't leak into the redo record.
    const toScene = (e: ProcessedEntity): SceneEntity =>
      ({
        id: e.id,
        name: e.name,
        parent: e.parent,
        children: e.children,
        components: structuredClone(e.components),
        visible: e.visible,
      }) as unknown as SceneEntity;

    const apply = (): void => {
      this.model.insertSubtree(entities.map(toScene));
      for (const e of entities) {
        this.model.setPrefabTag(e.id, {
          instanceRoot: rootId,
          prefabId: e.prefabEntityId,
          prefab: e.id === rootId ? ref : undefined,
        });
      }
    };
    apply();
    this.history.record(`Instantiate ${prefab.name || 'Prefab'}`, apply, () => {
      for (const id of this.model.collectSubtree(rootId)) this.model.removeEntityBySource(id);
    });
    return rootId;
  }

  /** Rename an entity (undoable). */
  renameEntity(sourceId: EntityId, name: string): void {
    const before = this.model.entityBySource(sourceId)?.name;
    if (before === undefined || before === name) return;
    this.model.setName(sourceId, name);
    this.history.record(
      `Rename ${name || 'Entity'}`,
      () => this.model.setName(sourceId, name),
      () => this.model.setName(sourceId, before),
    );
  }

  /**
   * Re-parent an entity (drag-reparent). Undoable. Rejects self-parenting and
   * cycles (parenting under its own descendant); `parent: null` un-parents.
   */
  setParent(sourceId: EntityId, parent: EntityId | null): void {
    if (!this.model.entityBySource(sourceId)) return;
    if (parent != null && (parent === sourceId || this.isModelAncestor(parent, sourceId))) return;
    const before = this.model.entityBySource(sourceId)?.parent ?? null;
    if (before === parent) return;
    this.model.setParent(sourceId, parent);
    this.history.record(
      'Reparent',
      () => this.model.setParent(sourceId, parent),
      () => this.model.setParent(sourceId, before),
    );
  }

  /** Add a component (with its registered/schema defaults) to an entity. Undoable. */
  // Apply an add to the model and return its undo op, or null if it's a no-op
  // (entity gone / component already present). Shared by the single + batch paths.
  private addComponentOp(sourceId: EntityId, compName: string): UndoOp | null {
    const entity = this.model.entityBySource(sourceId);
    if (!entity || entity.components.some((c) => c.type === compName)) return null;
    const def = componentByName(compName);
    // Builtins default from the engine registry; user/script components from the
    // schemas.json shape; an unknown-but-named component starts empty.
    const data = def
      ? structuredClone(componentDefaults(def))
      : structuredClone(userSchema(compName)?.default ?? {});
    this.model.setComponent(sourceId, compName, data);
    return {
      forward: () => this.model.setComponent(sourceId, compName, structuredClone(data)),
      reverse: () => this.model.removeComponent(sourceId, compName),
    };
  }

  private removeComponentOp(sourceId: EntityId, compName: string): UndoOp | null {
    if (compName === 'Transform' || compName === 'Name') return null; // protected
    const comp = this.model.entityBySource(sourceId)?.components.find((c) => c.type === compName);
    if (!comp) return null;
    const data = structuredClone(comp.data);
    this.model.removeComponent(sourceId, compName);
    return {
      forward: () => this.model.removeComponent(sourceId, compName),
      reverse: () => this.model.setComponent(sourceId, compName, structuredClone(data)),
    };
  }

  addComponent(sourceId: EntityId, compName: string): void {
    const op = this.addComponentOp(sourceId, compName);
    if (op) this.history.record(`Add ${prettyLabel(compName)}`, op.forward, op.reverse);
  }

  /** Remove a component from an entity (Transform / Name are protected). Undoable. */
  removeComponent(sourceId: EntityId, compName: string): void {
    const op = this.removeComponentOp(sourceId, compName);
    if (op) this.history.record(`Remove ${prettyLabel(compName)}`, op.forward, op.reverse);
  }

  /** Add a component to many entities (multi-select) as ONE undo step. */
  addComponentMany(sourceIds: readonly EntityId[], compName: string): void {
    const ops = sourceIds.map((id) => this.addComponentOp(id, compName)).filter((o): o is UndoOp => !!o);
    this.history.batch(`Add ${prettyLabel(compName)}`, ops);
  }

  /** Remove a component from many entities (multi-select) as ONE undo step. */
  removeComponentMany(sourceIds: readonly EntityId[], compName: string): void {
    const ops = sourceIds.map((id) => this.removeComponentOp(id, compName)).filter((o): o is UndoOp => !!o);
    this.history.batch(`Remove ${prettyLabel(compName)}`, ops);
  }

  /**
   * Toggle an entity's editor visibility by flipping the `enabled` field of each
   * of its components that has one (coalesced into one undo step). Lossless +
   * persisted; SceneQuery reflects it as the row's visibility.
   */
  setEntityVisible(sourceId: EntityId, visible: boolean): void {
    const entity = this.model.entityBySource(sourceId);
    if (!entity) return;
    this.beginGesture(visible ? 'Show' : 'Hide');
    // Toggle only RENDER components' enable flag (each via its own key — Sprite
    // uses `enabled`, TilemapLayer `visible`), so hiding never disables physics.
    for (const comp of entity.components) {
      if (!isRenderComponent(comp.type)) continue;
      const en = componentEnable(comp.type, comp.data as Record<string, unknown>);
      if (en) this.setField(sourceId, comp.type, en.key, 'bool', visible);
    }
    this.endGesture();
  }

  /**
   * Paint tiles into a TilemapLayer entity — model-authoritative.
   *
   * Tile data is a C++-side chunk store the scene carries as the TilemapLayer's
   * out-of-band `chunks` blob. We apply the edits live to the C++ tilemap (so the
   * viewport updates immediately) and then commit the fresh blob into the model — the
   * editor's source of truth, so a save (model serialize) and a play→stop rebuild
   * (loadSceneData → codec re-imports the blob) both reproduce exactly what was painted.
   * One undo step; its closures RE-RESOLVE the runtime entity (it changes across a
   * play→stop rebuild) and re-import the snapshotted before/after blob.
   */
  paintTiles(sourceId: EntityId, edits: TilePaint[]): void {
    if (edits.length === 0) return;
    const rt = this.model.runtimeFor(sourceId);
    if (rt === undefined) return;
    const before = TilemapAPI.exportChunks(rt);
    for (const e of edits) TilemapAPI.setTile(rt, e.x, e.y, e.tileId);
    this.commitTilePaint_(sourceId, before);
  }

  /**
   * Begin a live paint stroke (a viewport brush/erase drag). Snapshots the chunk
   * blob now; paint live with {@link paintTileLive}; commit one undo step with
   * {@link endTilePaint}. Mirrors the field-edit gesture (begin/…/end) so a drag is
   * one undo step while staying live in the viewport.
   */
  beginTilePaint(sourceId: EntityId): void {
    const rt = this.model.runtimeFor(sourceId);
    this.tilePaint = rt === undefined ? null : { sourceId, before: TilemapAPI.exportChunks(rt) };
  }

  /** Paint one tile live (no model write / no undo) during an open stroke. */
  paintTileLive(sourceId: EntityId, x: number, y: number, tileId: number): void {
    const rt = this.model.runtimeFor(sourceId);
    if (rt !== undefined) TilemapAPI.setTile(rt, x, y, tileId);
  }

  /** Commit the open paint stroke as one undo step (no-op if nothing changed). */
  endTilePaint(): void {
    const s = this.tilePaint;
    this.tilePaint = null;
    if (s) this.commitTilePaint_(s.sourceId, s.before);
  }

  // Shared commit: snapshot the post-edit blob, write it to the model (the truth
  // for save + rebuild), and record one undo step whose closures re-resolve the
  // runtime entity (it changes across a play→stop rebuild) and re-import the blob.
  private commitTilePaint_(sourceId: EntityId, before: string): void {
    const rt = this.model.runtimeFor(sourceId);
    if (rt === undefined) return;
    const after = TilemapAPI.exportChunks(rt);
    if (after === before) return; // painted the same ids that were already there

    this.model.setField(sourceId, 'TilemapLayer', 'chunks', after);

    const restore = (blob: string) => {
      const r = this.model.runtimeFor(sourceId);
      if (r !== undefined) TilemapAPI.importChunks(r, blob);
      this.model.setField(sourceId, 'TilemapLayer', 'chunks', blob);
    };
    this.history.record('Paint Tiles', () => restore(after), () => restore(before));
  }
}

/** The app's default-session commands. Other sessions construct their own SceneCommandsImpl(model, history). */
export const SceneCommands = new SceneCommandsImpl(SceneModel, EditorHistory);
