// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneData, PrefabData, ControllerState, UIControllerData, GearBinding, GearTween, UIGearData, SyncPrefabResolver } from 'esengine';
import { TilemapAPI, TilemapLiveSync, UIPositionType, DimensionUnit, AnchorAxis, writeFieldPath, type AnchorPreset } from 'esengine';
import type { EntityId, InspectorFieldType, InspectorFieldValue } from '@/types';
import { EditorHistory, EditorHistoryImpl } from './EditorHistory';
import { SceneModel, SceneModelImpl, type PrefabInstanceTag } from './SceneModel';
import { SceneStore } from './SceneStore';
import { usePrefabConflicts } from '@/store/prefabConflicts';
import { ViewportController } from './ViewportController';
import { expandInstance } from './PrefabInstance';
import { setEntityClipboard, getEntityClipboard, remapClipboardEntities } from './entityClipboard';
import {
  componentByName,
  componentDefaults,
  userSchema,
  angleZToQuat,
  hexToRgba,
  prettyLabel,
  clampFieldValue,
} from './schema';
import { normalizeFolder, folderParent, isFolderUnder, rebaseFolder } from '@/outliner/folders';
import { convertColliderData, COLLIDER_SHAPE_COMP, COMP_COLLIDER_SHAPE, type ColliderShapeKind } from './colliderConvert';

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
  // `vec2list` carries a Vec2[] — outside the Inspector's scalar vocabulary, so the write
  // channel accepts it here without widening the Inspector's InspectorFieldValue.
  value: InspectorFieldValue | Array<{ x: number; y: number }>,
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
      // Only finite axes are written; a NaN slot means "keep this entity's own
      // value" so a single-axis edit fanned across a multi-selection never
      // clobbers the untouched axes of the non-primary entities.
      const [x, y] = value as [number, number];
      const base = cur[key] as { x: number; y: number };
      return {
        ...base,
        ...(Number.isFinite(x) ? { x } : {}),
        ...(Number.isFinite(y) ? { y } : {}),
      };
    }
    case 'vec3': {
      const [x, y, z] = value as [number, number, number];
      const base = cur[key] as { x: number; y: number; z: number };
      return {
        ...base,
        ...(Number.isFinite(x) ? { x } : {}),
        ...(Number.isFinite(y) ? { y } : {}),
        ...(Number.isFinite(z) ? { z } : {}),
      };
    }
    case 'vec4': {
      // Merge onto the base (order-preserving, so a vec4 stays x-first and never
      // reads back as a quaternion). NaN axes are left untouched, as for vec2/vec3.
      const [x, y, z, w] = value as [number, number, number, number];
      const base = cur[key] as { x: number; y: number; z: number; w: number };
      return {
        ...base,
        ...(Number.isFinite(x) ? { x } : {}),
        ...(Number.isFinite(y) ? { y } : {}),
        ...(Number.isFinite(z) ? { z } : {}),
        ...(Number.isFinite(w) ? { w } : {}),
      };
    }
    case 'vec2list':
      // A whole Vec2[] replacement (polygon vertices / chain points) — normalized to
      // plain {x,y} so a dragged vertex writes clean data; coalesced to one undo step.
      return (value as Array<{ x: number; y: number }>).map((p) => ({ x: p.x, y: p.y }));
    case 'angle':
      return angleZToQuat(Number(value));
    case 'color':
      // The hex carries alpha (#rrggbbaa), so it fully describes RGBA.
      return { ...(cur[key] as object), ...hexToRgba(String(value)) };
    case 'gradient':
    case 'curve':
    case 'dimension':
      return value; // a structural object ({ stops/keys: [...] }, { value, unit }) — stored as-is
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

  // Observers/interceptors on the field-edit door — the Sequencer's record mode
  // auto-keys edits, the FX preview restarts emitters on timing edits. Any hook
  // returning true SUPPRESSES the scene write (reserved for future
  // non-destructive record); observers return false so the edit lands normally.
  // Kept generic: SceneCommands knows nothing about the consumers.
  private readonly editHooks = new Set<EditHook>();
  // An in-progress tilemap paint stroke: the chunk blob snapshotted at stroke start
  // ({@link beginTilePaint}), committed as one undo step at {@link endTilePaint}.
  private tilePaint: { sourceId: number; before: string } | null = null;

  constructor(
    private readonly model: SceneModelImpl,
    private readonly history: EditorHistoryImpl,
  ) {}

  /** Resolves a prefab ref → PrefabData SYNChronously for variant / nested
   *  expansion when instantiating (ProjectStore installs a warm-cache reader).
   *  Default no-op = flat prefabs only, matching the pre-plumbing behaviour. */
  private prefabResolver: SyncPrefabResolver = () => null;

  /** Install the synchronous prefab resolver used by {@link create} so an
   *  instantiated variant / nested prefab resolves its base like the load path. */
  setPrefabResolver(fn: SyncPrefabResolver): void {
    this.prefabResolver = fn;
  }

  /** Register a field-edit hook; returns the unsubscribe. */
  addEditHook(fn: EditHook): () => void {
    this.editHooks.add(fn);
    return () => this.editHooks.delete(fn);
  }

  /** The current model value of one field, or undefined. */
  private modelFieldValue(sourceId: number, comp: string, key: string): unknown {
    const c = this.model.entityBySource(sourceId)?.components.find((c) => c.type === comp);
    return c ? (c.data as Record<string, unknown>)[key] : undefined;
  }

  /** Whether re-parenting every id in `ids` under `target` is valid — false when
   *  `target` is one of them or a descendant of one (which {@link reparentEntities}
   *  silently drops). The Outliner drag-over calls this to REJECT an invalid drop
   *  (no move cursor, no drop indicator) instead of signalling a phantom success. */
  canReparent(ids: readonly EntityId[], target: EntityId | null): boolean {
    if (target == null) return true;
    return !ids.some((id) => id === target || this.isModelAncestor(target, id));
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
    // Edit hooks may observe — or, any returning true, suppress. Evaluated
    // eagerly (no short-circuit) so every observer sees every edit.
    let suppressed = false;
    for (const hook of this.editHooks) {
        if (hook(sourceId, compName, key, type, value)) suppressed = true;
    }
    if (suppressed) return;

    // Flipping a UINode to Absolute bakes its current layout box into concrete px
    // insets (below) so it holds its on-screen spot and gains a real, draggable
    // position — an all-auto absolute node otherwise collapses to the static
    // top-left corner (frequently under the viewport chrome, so it can't be grabbed).
    const bakeAbsolute =
      compName === 'UINode' && key === 'position' &&
      Number(value) === UIPositionType.Absolute &&
      Number(this.modelFieldValue(sourceId, 'UINode', 'position')) !== UIPositionType.Absolute;
    // Capture the seeded insets from the node's box BEFORE the flip — the flip marks
    // the layout dirty, zeroing the computed size until the next pass, and the pre-flip
    // box is exactly the on-screen position we want the node to keep.
    const seed = bakeAbsolute ? this.absoluteInsetSeed_(sourceId) : null;
    const applySeed = (): void => {
      if (seed?.insetLeft !== undefined) this.writeField_(sourceId, 'UINode', 'insetLeft', 'dimension', { value: seed.insetLeft, unit: DimensionUnit.Px });
      if (seed?.insetTop !== undefined) this.writeField_(sourceId, 'UINode', 'insetTop', 'dimension', { value: seed.insetTop, unit: DimensionUnit.Px });
      // Freeze the flex-resolved size too, so a stretched/auto-sized node keeps its
      // dimensions when it leaves flow (an absolute node with only a top-left inset
      // would otherwise collapse to its content size).
      if (seed?.width !== undefined) this.writeField_(sourceId, 'UINode', 'width', 'dimension', { value: seed.width, unit: DimensionUnit.Px });
      if (seed?.height !== undefined) this.writeField_(sourceId, 'UINode', 'height', 'dimension', { value: seed.height, unit: DimensionUnit.Px });
    };
    if (bakeAbsolute && !this.gesture) {
      // One undo step for the flip + the seeded insets.
      this.beginGesture('Make UI Absolute');
      this.writeField_(sourceId, compName, key, type, value);
      applySeed();
      this.endGesture();
      return;
    }
    this.writeField_(sourceId, compName, key, type, value);
    if (bakeAbsolute) applySeed(); // coalesced into the caller's gesture
  }

  /**
   * Write a whole Vec2[] field (polygon vertices / chain points) — the viewport vertex-
   * drag door. Same model + undo/gesture bookkeeping as {@link setField}, but the value
   * is a Vec2[] (outside the Inspector's scalar-field vocabulary, so it has its own door).
   */
  setVertexArray(sourceId: EntityId, compName: string, key: string, verts: Array<{ x: number; y: number }>): void {
    this.writeField_(sourceId, compName, key, 'vec2list', verts);
  }

  /** The unconditional single-field write (model + undo/gesture bookkeeping). */
  private writeField_(
    sourceId: EntityId,
    compName: string,
    key: string,
    type: InspectorFieldType,
    value: InspectorFieldValue | Array<{ x: number; y: number }>,
  ): void {
    const e = this.model.entityBySource(sourceId);
    if (!e) return;
    const cur = (e.components.find((c) => c.type === compName)?.data as Record<string, unknown>) ?? {};

    const k = editKey(sourceId, compName, key);
    const firstTouch = !this.gesture || !this.gesture.touched.has(k);
    const before = firstTouch ? structuredClone(cur[key]) : undefined;

    const after = clampFieldValue(compName, key, toModelValue(cur, type, key, value));
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

  /**
   * The concrete px inset + size that reproduce a UINode's CURRENT resolved box —
   * captured while the node is still in its old (pre-flip) layout so the box is live.
   * Pins the top-left inset and freezes an auto (flex/content-driven) width/height, so
   * flipping to Absolute keeps the node exactly where and how big it was. Only an axis
   * / dimension still at its auto default is seeded; one the user already set is left
   * untouched (undefined). Empty without live boxes.
   */
  private absoluteInsetSeed_(sourceId: EntityId): { insetLeft?: number; insetTop?: number; width?: number; height?: number } {
    const rt = this.model.runtimeFor(sourceId);
    const parentSrc = this.model.entityBySource(sourceId)?.parent;
    const parentRt = parentSrc != null ? this.model.runtimeFor(parentSrc) : undefined;
    const node = rt !== undefined ? ViewportController.uiEntityWorldOBB(rt) : null;
    const parent = parentRt !== undefined ? ViewportController.uiEntityWorldOBB(parentRt) : null;
    if (!node || !parent) return {};
    // A field absent from the model sits at its DEFAULT, which for inset/width/height
    // is `auto` — so a missing value must read as auto, not "not auto". (A fresh flow
    // node stores almost nothing, so without this the bake seeded nothing and the node
    // collapsed to the top-left corner.)
    const unitOf = (key: string): number =>
      (this.modelFieldValue(sourceId, 'UINode', key) as { unit: number } | undefined)?.unit ?? DimensionUnit.Auto;
    const autoAxis = (nearKey: string, farKey: string): boolean =>
      unitOf(nearKey) === DimensionUnit.Auto && unitOf(farKey) === DimensionUnit.Auto;
    const isAutoDim = (key: string): boolean => unitOf(key) === DimensionUnit.Auto;
    // An absolute node's margin still offsets it on top of its inset, so the inset
    // that reproduces the current position is (edge gap − own margin). Only px
    // margins subtract cleanly; percent/auto margins are rare here and left as 0.
    const marginPx = (key: string): number => {
      const m = this.modelFieldValue(sourceId, 'UINode', key) as { value: number; unit: number } | undefined;
      return m?.unit === DimensionUnit.Px ? m.value : 0;
    };
    const out: { insetLeft?: number; insetTop?: number; width?: number; height?: number } = {};
    if (autoAxis('insetLeft', 'insetRight')) out.insetLeft = Math.round((node.cx - node.hw) - (parent.cx - parent.hw) - marginPx('marginLeft'));
    // Layout space is y-down: the top inset is the gap from the parent's top edge.
    if (autoAxis('insetTop', 'insetBottom')) out.insetTop = Math.round((parent.cy + parent.hh) - (node.cy + node.hh) - marginPx('marginTop'));
    // The OBB half-extents are the flex-resolved size (world px == layout px at the UI
    // camera's unit scale); freeze it only where the size was auto (flex/content-driven).
    if (isAutoDim('width')) out.width = Math.round(node.hw * 2);
    if (isAutoDim('height')) out.height = Math.round(node.hh * 2);
    return out;
  }

  /**
   * Move an entity to a world position (keeps local Z). Undoable like any field
   * edit. `Transform.position` is parent-local, so a parented entity's world
   * target is re-expressed in its parent's live world frame before the write —
   * viewport tools speak world space; the model invariant stays local.
   */
  setEntityXY(sourceId: EntityId, x: number, y: number): void {
    if (this.setUINodeXY_(sourceId, x, y)) return;
    const entity = this.model.entityBySource(sourceId);
    const pos = this.modelFieldValue(sourceId, 'Transform', 'position') as { z?: number } | undefined;
    if (pos === undefined && !entity) return;
    const parentRt = entity?.parent != null ? this.model.runtimeFor(entity.parent) : undefined;
    const local = ViewportController.worldToParentLocalXY(parentRt, x, y);
    this.setField(sourceId, 'Transform', 'position', 'vec3', [local.x, local.y, pos?.z ?? 0]);
  }

  /**
   * A UINode's on-screen position is LAYOUT-owned: Yoga writes the resolved
   * placement into `Transform.position` on every relayout, so a Transform write
   * only holds until the next UI edit, then snaps back. Viewport moves edit the
   * layout INPUTS instead:
   * - Absolute nodes: the world delta lands in the inset dimensions — px insets
   *   shift by the delta, percent insets by delta/parent-size, and a fully
   *   `auto` axis gets pinned (near edge, px) at its current offset. Opposing
   *   non-auto insets (a stretch axis) shift together, preserving the span.
   * - Relative (flow) nodes: position is the flow's outcome — the move is dropped
   *   here (the move tool excludes them up front and hints to switch to Absolute).
   * Returns true when the entity is a UINode (handled), false to fall through
   * to the Transform path.
   */
  private setUINodeXY_(sourceId: EntityId, x: number, y: number): boolean {
    const posKind = this.modelFieldValue(sourceId, 'UINode', 'position');
    if (posKind === undefined) return false;
    if (Number(posKind) !== UIPositionType.Absolute) return true;

    const rt = this.model.runtimeFor(sourceId);
    const parentSrc = this.model.entityBySource(sourceId)?.parent;
    const parentRt = parentSrc != null ? this.model.runtimeFor(parentSrc) : undefined;
    const node = rt !== undefined ? ViewportController.uiEntityWorldOBB(rt) : null;
    const parent = parentRt !== undefined ? ViewportController.uiEntityWorldOBB(parentRt) : null;
    if (!node || !parent) return true; // no live layout boxes → nothing safe to edit

    const dx = x - node.cx;
    const dy = y - node.cy;
    // Layout space is y-down: moving up (world +y) means a smaller top inset.
    this.shiftInsetAxis_(sourceId, 'insetLeft', 'insetRight', 'marginLeft', 'marginRight', dx, 2 * parent.hw,
      (node.cx - node.hw) - (parent.cx - parent.hw));
    this.shiftInsetAxis_(sourceId, 'insetTop', 'insetBottom', 'marginTop', 'marginBottom', -dy, 2 * parent.hh,
      (parent.cy + parent.hh) - (node.cy + node.hh));
    return true;
  }

  /**
   * Shifts one inset axis by `delta` px toward the `near` edge: every non-auto
   * side moves in its own unit (px directly, percent scaled by the parent
   * size); a fully-auto axis pins `near` at its current offset plus the delta.
   * Offsets measure against the parent's border box — a padded parent's static
   * offset is absorbed into the pin, not reproduced.
   */
  private shiftInsetAxis_(
    sourceId: EntityId, nearKey: string, farKey: string,
    marginNearKey: string, marginFarKey: string,
    delta: number, parentSize: number, currentNearPx: number,
  ): void {
    if (delta === 0) return;
    const write = (key: string, dim: { value: number; unit: number }): void =>
      this.setField(sourceId, 'UINode', key, 'dimension', dim);
    // An `auto` margin re-centers the node on this axis (that's how a Center anchor
    // holds it) and would fight the inset we pin below — the node wouldn't move. Nail
    // any auto margin on this axis to 0 first so the inset alone drives the position.
    for (const mk of [marginNearKey, marginFarKey]) {
      const m = this.modelFieldValue(sourceId, 'UINode', mk) as { unit: number } | undefined;
      if (m?.unit === DimensionUnit.Auto) write(mk, { value: 0, unit: DimensionUnit.Px });
    }
    const near = this.modelFieldValue(sourceId, 'UINode', nearKey) as { value: number; unit: number } | undefined;
    const far = this.modelFieldValue(sourceId, 'UINode', farKey) as { value: number; unit: number } | undefined;
    if (!near || !far) return;
    let shifted = false;
    if (near.unit === DimensionUnit.Px) {
      write(nearKey, { ...near, value: near.value + delta });
      shifted = true;
    } else if (near.unit === DimensionUnit.Percent && parentSize > 0) {
      write(nearKey, { ...near, value: near.value + (delta / parentSize) * 100 });
      shifted = true;
    }
    if (far.unit === DimensionUnit.Px) {
      write(farKey, { ...far, value: far.value - delta });
      shifted = true;
    } else if (far.unit === DimensionUnit.Percent && parentSize > 0) {
      write(farKey, { ...far, value: far.value - (delta / parentSize) * 100 });
      shifted = true;
    }
    if (!shifted) write(nearKey, { value: currentNearPx + delta, unit: DimensionUnit.Px });
  }

  /**
   * Apply an anchor preset (Start / Center / End / Stretch, PER AXIS — an absent
   * axis is left untouched) to each UINode as one undo step. A preset is a VIEW
   * over the box fields, not stored state; the node's current resolved box is
   * baked into the pinned insets so changing an anchor never moves the widget on
   * screen (Center excepted — auto-margin centring has no offset to express), and
   * leaving Stretch freezes the resolved size so the box doesn't collapse to its
   * content. {@link detectAnchorAxes} reads the result back.
   */
  setUINodeAnchor(sourceIds: EntityId[], preset: Partial<AnchorPreset>): void {
    this.beginGesture('Anchor');
    for (const id of sourceIds) {
      // Live boxes for the offset bake, read BEFORE any writes (world px == layout
      // px in the UI world). Null without a live layout → preset zero offsets.
      const rt = this.model.runtimeFor(id);
      const parentSrc = this.model.entityBySource(id)?.parent;
      const parentRt = parentSrc != null ? this.model.runtimeFor(parentSrc) : undefined;
      const node = rt !== undefined ? ViewportController.uiEntityWorldOBB(rt) : null;
      const parent = parentRt !== undefined ? ViewportController.uiEntityWorldOBB(parentRt) : null;
      this.setField(id, 'UINode', 'position', 'enum', UIPositionType.Absolute);
      for (const axis of ['h', 'v'] as const) {
        const mode = preset[axis];
        if (mode === undefined) continue;
        // Edge gaps in layout space (y-down): near = left/top, far = right/bottom.
        const gaps = node && parent
          ? axis === 'h'
            ? { near: (node.cx - node.hw) - (parent.cx - parent.hw), far: (parent.cx + parent.hw) - (node.cx + node.hw), size: node.hw * 2 }
            : { near: (parent.cy + parent.hh) - (node.cy + node.hh), far: (node.cy - node.hh) - (parent.cy - parent.hh), size: node.hh * 2 }
          : null;
        this.applyAnchorAxis_(id, axis, mode, gaps);
      }
    }
    this.endGesture();
  }

  /** One axis of {@link setUINodeAnchor}: writes the inset/margin (+ size) fields
   *  that express `mode`, pinning at the baked `gaps` when available. */
  private applyAnchorAxis_(
    sourceId: EntityId, axis: 'h' | 'v', mode: AnchorAxis,
    gaps: { near: number; far: number; size: number } | null,
  ): void {
    const keys = axis === 'h'
      ? { near: 'insetLeft', far: 'insetRight', mNear: 'marginLeft', mFar: 'marginRight', size: 'width' }
      : { near: 'insetTop', far: 'insetBottom', mNear: 'marginTop', mFar: 'marginBottom', size: 'height' };
    const px = (v: number) => ({ value: Math.round(v), unit: DimensionUnit.Px });
    const autoDim = () => ({ value: 0, unit: DimensionUnit.Auto });
    const write = (key: string, dim: { value: number; unit: number }): void =>
      this.setField(sourceId, 'UINode', key, 'dimension', dim);
    switch (mode) {
      case AnchorAxis.Start:
        write(keys.near, px(gaps?.near ?? 0));
        write(keys.far, autoDim());
        break;
      case AnchorAxis.End:
        write(keys.near, autoDim());
        write(keys.far, px(gaps?.far ?? 0));
        break;
      case AnchorAxis.Center:
        write(keys.near, autoDim());
        write(keys.far, autoDim());
        break;
      case AnchorAxis.Stretch:
        write(keys.near, px(gaps?.near ?? 0));
        write(keys.far, px(gaps?.far ?? 0));
        write(keys.size, autoDim());
        break;
    }
    // Center centres via auto margins; every other mode pins with 0 so the inset
    // alone drives the position.
    const m = mode === AnchorAxis.Center ? autoDim() : px(0);
    write(keys.mNear, m);
    write(keys.mFar, m);
    // Leaving Stretch: freeze an auto (inset-driven) size at its resolved value.
    if (mode !== AnchorAxis.Stretch && gaps) {
      const cur = this.modelFieldValue(sourceId, 'UINode', keys.size) as { unit: number } | undefined;
      if ((cur?.unit ?? DimensionUnit.Auto) === DimensionUnit.Auto) write(keys.size, px(gaps.size));
    }
  }

  // — Undoable entity lifecycle (model ops; the Reconciler re-spawns/-despawns) —

  /** Spawn a new empty entity (with a Transform). Returns its source id. */
  addEntity(parent: EntityId | null = null): EntityId | null {
    if (!this.model.current) return null;
    const sourceId = this.model.addEntity('Entity', [
      { type: 'Transform', data: structuredClone(DEFAULT_TRANSFORM) } as SceneComponent,
    ], parent);
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

  /** Delete a whole selection as ONE undo step (one gesture, however many roots). */
  deleteEntities(ids: readonly EntityId[]): void {
    if (ids.length === 0) return;
    if (ids.length === 1) return this.deleteEntity(ids[0]);
    this.history.group(`Delete ${ids.length} Entities`, () => {
      for (const id of ids) this.deleteEntity(id);
    });
  }

  /** Duplicate a whole selection as ONE undo step. Returns the new source ids. */
  duplicateEntities(ids: readonly EntityId[]): EntityId[] {
    if (ids.length === 0) return [];
    if (ids.length === 1) {
      const d = this.duplicateEntity(ids[0]);
      return d != null ? [d] : [];
    }
    const out: EntityId[] = [];
    this.history.group(`Duplicate ${ids.length} Entities`, () => {
      for (const id of ids) {
        const d = this.duplicateEntity(id);
        if (d != null) out.push(d);
      }
    });
    return out;
  }

  /** Re-parent a whole drag selection as ONE undo step (per-id rules of {@link setParent}). */
  reparentEntities(ids: readonly EntityId[], parent: EntityId | null): void {
    const movable = ids.filter((id) => id !== parent);
    if (movable.length === 0) return;
    if (movable.length === 1) return this.setParent(movable[0], parent);
    this.history.group(`Reparent ${movable.length} Entities`, () => {
      for (const id of movable) this.setParent(id, parent);
    });
  }

  /** Duplicate an entity WITH its subtree (offset slightly, as a sibling). Returns the new root source id. */
  duplicateEntity(sourceId: EntityId): EntityId | null {
    const src = this.model.entityBySource(sourceId);
    if (!src) return null;
    // Duplicate the whole subtree, re-keyed to fresh ids — the same deep path as
    // copy+paste (remap preserves unknown components/fields + @uuid: refs and
    // rewrites intra-subtree entity refs). A shallow clone silently drops children.
    const payload: SceneEntity[] = [];
    for (const sid of this.model.collectSubtree(sourceId)) {
      const e = this.model.entityBySource(sid);
      if (e) payload.push(e);
    }
    const { entities, rootIds } = remapClipboardEntities(
      payload,
      () => this.model.allocateSourceId(),
      src.parent ?? null,
      { x: 24, y: -24 },
    );
    const apply = (): void => this.model.insertSubtree(entities);
    apply();
    this.history.record(
      `Duplicate ${src.name || 'Entity'}`,
      apply,
      () => { for (const e of entities) this.model.removeEntityBySource((e as { id: EntityId }).id); },
    );
    return rootIds[0] ?? null;
  }

  /**
   * Copy the given entities (each WITH its subtree) to the entity clipboard. The
   * subtrees are deduped (a selected descendant of another selection isn't copied
   * twice). No model change, no undo step. Returns the entity count copied.
   */
  copyEntities(ids: readonly EntityId[]): number {
    const seen = new Set<EntityId>();
    const payload: SceneEntity[] = [];
    for (const id of ids) {
      for (const sid of this.model.collectSubtree(id)) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        const e = this.model.entityBySource(sid);
        if (e) payload.push(e);
      }
    }
    setEntityClipboard(payload);
    return payload.length;
  }

  /** Copy the entities, then delete them (the delete is one undo step). */
  cutEntities(ids: readonly EntityId[]): number {
    const n = this.copyEntities(ids);
    if (n > 0) this.deleteEntities(ids);
    return n;
  }

  /**
   * Paste the clipboard subtrees under `targetParent` (null = scene root), re-keyed
   * to fresh ids with a paste offset. One undo step. Returns the new root ids.
   */
  pasteEntities(targetParent: EntityId | null = null): EntityId[] {
    const payload = getEntityClipboard();
    if (!payload || payload.length === 0) return [];
    const { entities, rootIds } = remapClipboardEntities(
      payload,
      () => this.model.allocateSourceId(),
      targetParent,
      { x: 24, y: -24 },
    );
    const apply = (): void => this.model.insertSubtree(entities);
    apply();
    this.history.record(
      rootIds.length > 1 ? `Paste ${rootIds.length} Entities` : 'Paste Entity',
      apply,
      () => { for (const e of entities) this.model.removeEntityBySource((e as { id: EntityId }).id); },
    );
    return rootIds;
  }

  /**
   * The single birth path for template/prefab-expanded entities. Without
   * `linkPrefabRef` the entities are plain and user-owned (the "Create → …"
   * catalog flow, à la Unity); with it, every entity is tagged with its prefab
   * origin so save can collapse the subtree back to a delta (instance = a
   * document delta, see REARCH_PREFABS). `position` overrides the root's authored
   * placement (the drop point). Undoable; returns the root's source id.
   */
  create(
    prefab: PrefabData,
    opts: { parent: EntityId | null; position?: { x: number; y: number }; linkPrefabRef?: string },
  ): EntityId | null {
    if (!this.model.current) return null;
    const ref = opts.linkPrefabRef ?? '';
    const { entities, rootId } = expandInstance(
      prefab,
      { prefab: ref, overrides: [], added: [], removed: [] },
      () => this.model.allocateSourceId(),
      this.prefabResolver,
    );
    const root = entities.find((e) => e.id === rootId);
    if (!root) return null;
    root.parent = opts.parent;

    // Place the instance at the drop point — a Transform.position edit that
    // diffAgainstSource captures as a property override on save (so the prefab
    // asset stays at its authored origin; the instance carries the placement).
    if (opts.position) {
      const tf = root.components.find((c) => c.type === 'Transform');
      if (tf) {
        const p = ((tf.data as Record<string, unknown>).position ??= { x: 0, y: 0, z: 0 }) as { x: number; y: number; z: number };
        p.x = opts.position.x;
        p.y = opts.position.y;
      }
    }

    // ProcessedEntity → SceneEntity (drop prefab fields); deep-clone components so
    // later edits to the instance don't leak into the redo record.
    const scene = entities.map((e): SceneEntity =>
      ({
        id: e.id, name: e.name, parent: e.parent, children: e.children,
        components: structuredClone(e.components), visible: e.visible,
      }) as unknown as SceneEntity,
    );

    // A prefab link tags the subtree with its origin; a plain template does not.
    const linked = opts.linkPrefabRef != null;
    const apply = (): void => {
      this.model.insertSubtree(scene);
      if (linked) {
        for (const e of entities) {
          this.model.setPrefabTag(e.id, {
            instanceRoot: rootId,
            prefabId: e.prefabEntityId,
            prefab: e.id === rootId ? ref : undefined,
          });
        }
      }
    };
    apply();
    this.history.record(
      linked ? `Instantiate ${prefab.name || 'Prefab'}` : `Create ${prefab.name || 'Entity'}`,
      apply,
      () => { for (const id of this.model.collectSubtree(rootId)) this.model.removeEntityBySource(id); },
    );
    return rootId;
  }

  /**
   * Instantiate a prefab asset into the scene under `parent` (thin adapter over
   * {@link create} that links the subtree to its prefab origin). The caller loads
   * the PrefabData; stays synchronous + undoable. Returns the instance root's id.
   */
  instantiatePrefab(
    prefab: PrefabData,
    ref: string,
    parent: EntityId | null,
    position?: { x: number; y: number },
  ): EntityId | null {
    return this.create(prefab, { parent, position, linkPrefabRef: ref });
  }

  /** Plain, user-owned entities from a template prefab — {@link create} with no prefab link. */
  createFromTemplate(prefab: PrefabData, parent: EntityId | null): EntityId | null {
    return this.create(prefab, { parent });
  }

  /**
   * Unpack a prefab instance — detach the whole instance subtree from its prefab
   * so its entities become ordinary, user-owned ones: they no longer collapse to
   * an instance entry on save and lose their prefab affordances. Works on any
   * entity of the instance (resolves to the root). Undoable — undo re-links every
   * entity. Tag changes don't emit a model event (bulk load must not re-render
   * per tag), so the closures poke the structure revision explicitly.
   */
  unpackPrefabInstance(sourceId: EntityId): void {
    const instanceRoot = this.model.prefabTag(sourceId)?.instanceRoot ?? sourceId;
    if (!this.model.prefabTag(instanceRoot)) return; // not a prefab instance
    const saved: Array<[EntityId, PrefabInstanceTag]> = [];
    for (const id of this.model.collectSubtree(instanceRoot)) {
      const tag = this.model.prefabTag(id);
      if (tag) saved.push([id as EntityId, tag]);
    }
    if (saved.length === 0) return;
    // A load-time stale-override diagnostic keyed by this instance root is moot once
    // the subtree is no longer an instance; clear it (and its count) on unpack, and
    // restore it on undo so the badge tracks the tree state accurately.
    const conflicts = usePrefabConflicts.getState().byInstance.get(instanceRoot);
    const unlink = (): void => {
      for (const [id] of saved) this.model.setPrefabTag(id, undefined);
      usePrefabConflicts.getState().clearInstance(instanceRoot);
      SceneStore.pokeStructure();
    };
    const relink = (): void => {
      for (const [id, tag] of saved) this.model.setPrefabTag(id, tag);
      if (conflicts) usePrefabConflicts.getState().setInstance(instanceRoot, conflicts);
      SceneStore.pokeStructure();
    };
    unlink();
    this.history.record('Unpack Prefab', unlink, relink);
  }

  /** The scene's Canvas entity (UI layout root), or null — the default parent for new UI. */
  findCanvas(): EntityId | null {
    const e = this.model.current?.entities.find((x) => x.components.some((c) => c.type === 'Canvas'));
    return e ? (e.id as EntityId) : null;
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

  // — Outliner folders (organizational paths; orthogonal to the transform parent) —
  // Folders group ROOT entities. They live as an editor-only per-entity `folder`
  // path + a scene-level explicit-folder list (so empties persist); all undoable.

  /** Create an explicit (initially empty) folder. Undoable; no-op if it exists. */
  createFolder(path: string): void {
    const norm = normalizeFolder(path);
    if (!norm) return;
    const before = this.model.sceneFolders();
    if (before.includes(norm)) return;
    const after = [...before, norm];
    this.model.setSceneFolders(after);
    this.history.record('New Folder', () => this.model.setSceneFolders(after), () => this.model.setSceneFolders(before));
  }

  /**
   * Rename/move a folder: re-root the folder (and its descendants) + every entity
   * under it from `oldPath` to `newPath`, as one undo step. No-op if unchanged.
   */
  renameFolder(oldPath: string, newPath: string): void {
    const o = normalizeFolder(oldPath);
    const n = normalizeFolder(newPath);
    if (!o || !n || o === n) return;

    const beforeFolders = this.model.sceneFolders();
    const afterFolders = [...new Set(beforeFolders.map((f) => rebaseFolder(f, o, n) ?? f))];
    const edits = (this.model.current?.entities ?? [])
      .map((e) => ({ id: e.id, before: this.model.folderOf(e.id) }))
      .map((e) => ({ ...e, after: rebaseFolder(e.before, o, n) }))
      .filter((e): e is { id: number; before: string; after: string } => e.after != null && e.after !== e.before);

    const apply = (): void => {
      this.model.setSceneFolders(afterFolders);
      for (const e of edits) this.model.setFolder(e.id, e.after);
    };
    const revert = (): void => {
      this.model.setSceneFolders(beforeFolders);
      for (const e of edits) this.model.setFolder(e.id, e.before);
    };
    apply();
    this.history.record('Rename Folder', apply, revert);
  }

  /**
   * Delete a folder, moving its contents (entities + descendant folders) up to its
   * parent — entities are never destroyed. One undo step.
   */
  deleteFolder(path: string): void {
    const p = normalizeFolder(path);
    if (!p) return;
    const parent = folderParent(p);
    const beforeFolders = this.model.sceneFolders();
    const afterFolders = [
      ...new Set(beforeFolders.filter((f) => f !== p).map((f) => (isFolderUnder(f, p) ? (rebaseFolder(f, p, parent) ?? parent) : f))),
    ];
    const edits = (this.model.current?.entities ?? [])
      .map((e) => ({ id: e.id, before: this.model.folderOf(e.id) }))
      .filter((e) => isFolderUnder(e.before, p))
      .map((e) => ({ ...e, after: rebaseFolder(e.before, p, parent) ?? parent }));

    const apply = (): void => {
      this.model.setSceneFolders(afterFolders);
      for (const e of edits) this.model.setFolder(e.id, e.after);
    };
    const revert = (): void => {
      this.model.setSceneFolders(beforeFolders);
      for (const e of edits) this.model.setFolder(e.id, e.before);
    };
    apply();
    this.history.record('Delete Folder', apply, revert);
  }

  /**
   * Move entities into a folder (`path: null` = scene root). Folders organize
   * roots, so this also un-parents each entity (it becomes a root in the folder).
   * One undo step; no-op for entities already there.
   */
  moveToFolder(sourceIds: readonly EntityId[], path: string | null): void {
    const norm = path ? normalizeFolder(path) : '';
    const records = sourceIds
      .map((id) => {
        const e = this.model.entityBySource(id);
        return e ? { id, beforeParent: e.parent ?? null, beforeFolder: this.model.folderOf(id) } : null;
      })
      .filter((r): r is { id: number; beforeParent: number | null; beforeFolder: string } => !!r)
      .filter((r) => r.beforeParent !== null || r.beforeFolder !== norm);
    if (records.length === 0) return;

    const apply = (): void => {
      for (const r of records) {
        this.model.setParent(r.id, null);
        this.model.setFolder(r.id, norm);
      }
    };
    const revert = (): void => {
      for (const r of records) {
        this.model.setFolder(r.id, r.beforeFolder);
        this.model.setParent(r.id, r.beforeParent);
      }
    };
    apply();
    this.history.record(records.length > 1 ? `Move ${records.length} to Folder` : 'Move to Folder', apply, revert);
  }

  /**
   * Place a folder at a manual sort position among its siblings (drag-between).
   * `key` is a number on the sibling-order scale — entities use their scene index,
   * so dragging a folder before/after a row passes that row's `sortKey` ∓ 0.5,
   * interleaving the folder among the entities. One undo step.
   */
  placeFolder(path: string, key: number): void {
    const norm = normalizeFolder(path);
    if (!norm) return;
    const before = this.model.folderOrderOf(norm);
    if (before === key) return;
    this.model.setFolderOrder(norm, key);
    this.history.record(
      'Move Folder',
      () => this.model.setFolderOrder(norm, key),
      () => this.model.setFolderOrder(norm, before),
    );
  }

  /**
   * Drag-reorder: move an entity to sit immediately before/after a sibling target.
   * Aligns the dragged entity's parent + folder to the target's first (so it
   * becomes a true sibling), then reorders scene order. One undo step; rejects
   * dropping onto its own descendant (cycle) and no-op drops.
   */
  reorderEntity(sourceId: EntityId, targetId: EntityId, before: boolean): void {
    if (sourceId === targetId) return;
    const src = this.model.entityBySource(sourceId);
    const tgt = this.model.entityBySource(targetId);
    if (!src || !tgt) return;
    if (this.isModelAncestor(targetId, sourceId)) return; // target is under source → cycle

    const targetParent = tgt.parent ?? null;
    const targetFolder = targetParent === null ? this.model.folderOf(targetId) : '';
    const beforeOrder = this.model.entityOrder();
    const beforeParent = src.parent ?? null;
    const beforeFolder = this.model.folderOf(sourceId);

    const apply = (): void => {
      if ((this.model.entityBySource(sourceId)?.parent ?? null) !== targetParent) this.model.setParent(sourceId, targetParent);
      if (targetParent === null) this.model.setFolder(sourceId, targetFolder);
      this.model.moveEntityAdjacent(sourceId, targetId, before);
    };
    apply();

    const afterOrder = this.model.entityOrder();
    const orderSame = beforeOrder.length === afterOrder.length && beforeOrder.every((id, i) => id === afterOrder[i]);
    const folderSame = targetParent !== null || beforeFolder === targetFolder;
    if (orderSame && beforeParent === targetParent && folderSame) return; // dropped in place

    this.history.record('Reorder', apply, () => {
      this.model.setEntityOrder(beforeOrder);
      this.model.setFolder(sourceId, beforeFolder);
      this.model.setParent(sourceId, beforeParent);
    });
  }

  /** Drag-reorder a whole selection as ONE undo step (per-id rules of {@link reorderEntity}). */
  reorderEntities(ids: readonly EntityId[], targetId: EntityId, before: boolean): void {
    const movable = ids.filter((id) => id !== targetId);
    if (movable.length === 0) return;
    if (movable.length === 1) return this.reorderEntity(movable[0], targetId, before);
    this.history.group(`Reorder ${movable.length} Entities`, () => {
      for (const id of movable) this.reorderEntity(id, targetId, before);
    });
  }

  // The default data for a component: builtins from the engine registry; user/script
  // components from the schemas.json shape; an unknown-but-named component is empty.
  private defaultDataFor(compName: string): Record<string, unknown> {
    const def = componentByName(compName);
    return def
      ? structuredClone(componentDefaults(def))
      : structuredClone(userSchema(compName)?.default ?? {});
  }

  /** Add a component (with its registered/schema defaults) to an entity. Undoable. */
  // Apply an add to the model and return its undo op, or null if it's a no-op
  // (entity gone / component already present). Shared by the single + batch paths.
  /** Components auto-added alongside another. A Video renders through a
   *  renderable, so adding one ensures a Sprite unless the entity already has a
   *  renderable (a UI Video keeps its UIVisual, not a redundant Sprite). */
  private requiredComponents(sourceId: EntityId, compName: string): readonly string[] {
    if (compName !== 'Video') return [];
    const comps = this.model.entityBySource(sourceId)?.components ?? [];
    const hasRenderable = comps.some((c) => c.type === 'Sprite' || c.type === 'UIVisual' || c.type === 'Mesh2D');
    return hasRenderable ? [] : ['Sprite'];
  }

  /** The add op for `compName` plus ops for any components it requires. Each op is
   *  null when that component already exists, so dependencies never duplicate. */
  private addComponentOpsWithDeps(sourceId: EntityId, compName: string): UndoOp[] {
    return [
      ...this.requiredComponents(sourceId, compName).map((dep) => this.addComponentOp(sourceId, dep)),
      this.addComponentOp(sourceId, compName),
    ].filter((o): o is UndoOp => !!o);
  }

  private addComponentOp(sourceId: EntityId, compName: string): UndoOp | null {
    const entity = this.model.entityBySource(sourceId);
    if (!entity || entity.components.some((c) => c.type === compName)) return null;
    const data = this.defaultDataFor(compName);
    this.model.setComponent(sourceId, compName, data);
    return {
      forward: () => this.model.setComponent(sourceId, compName, structuredClone(data)),
      reverse: () => this.model.removeComponent(sourceId, compName),
    };
  }

  // Replace an existing component's data wholesale (paste-values / reset). Null if
  // the entity doesn't have the component (paste/reset only touch what's present).
  private replaceComponentOp(sourceId: EntityId, compName: string, newData: Record<string, unknown>): UndoOp | null {
    const cur = this.model.entityBySource(sourceId)?.components.find((c) => c.type === compName);
    if (!cur) return null;
    const before = structuredClone(cur.data);
    this.model.setComponent(sourceId, compName, structuredClone(newData));
    return {
      forward: () => this.model.setComponent(sourceId, compName, structuredClone(newData)),
      reverse: () => this.model.setComponent(sourceId, compName, structuredClone(before)),
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
    const ops = this.addComponentOpsWithDeps(sourceId, compName);
    if (ops.length) this.history.batch(`Add ${prettyLabel(compName)}`, ops);
  }

  /**
   * Give an entity a UI layout box: add a px-sized UINode and reparent it under `parent`
   * (a Canvas / UI root) so the UI layout resolves a box. This is the one-click path from
   * a boxless Text — whose align/verticalAlign only anchor to the origin — to box-aligned
   * UI text. One undo step; a no-op if the entity already has a UINode.
   */
  attachUINodeBox(sourceId: EntityId, parent: EntityId, width: number, height: number): void {
    const entity = this.model.entityBySource(sourceId);
    if (!entity || entity.components.some((c) => c.type === 'UINode')) return;
    const before = entity.parent ?? null;
    const data = { ...this.defaultDataFor('UINode'), width: { value: width, unit: 0 }, height: { value: height, unit: 0 } };
    this.model.setComponent(sourceId, 'UINode', structuredClone(data));
    this.model.setParent(sourceId, parent);
    this.history.batch('Add Layout Box', [
      {
        forward: () => this.model.setComponent(sourceId, 'UINode', structuredClone(data)),
        reverse: () => this.model.removeComponent(sourceId, 'UINode'),
      },
      {
        forward: () => this.model.setParent(sourceId, parent),
        reverse: () => this.model.setParent(sourceId, before),
      },
    ]);
  }

  /** Remove a component from an entity (Transform / Name are protected). Undoable. */
  removeComponent(sourceId: EntityId, compName: string): void {
    const op = this.removeComponentOp(sourceId, compName);
    if (op) this.history.record(`Remove ${prettyLabel(compName)}`, op.forward, op.reverse);
  }

  /** Add a component to many entities (multi-select) as ONE undo step. */
  addComponentMany(sourceIds: readonly EntityId[], compName: string): void {
    const ops = sourceIds.flatMap((id) => this.addComponentOpsWithDeps(id, compName));
    this.history.batch(`Add ${prettyLabel(compName)}`, ops);
  }

  /** Remove a component from many entities (multi-select) as ONE undo step. */
  removeComponentMany(sourceIds: readonly EntityId[], compName: string): void {
    const ops = sourceIds.map((id) => this.removeComponentOp(id, compName)).filter((o): o is UndoOp => !!o);
    this.history.batch(`Remove ${prettyLabel(compName)}`, ops);
  }

  /**
   * Convert an entity's collider to another authorable shape (box / circle / polygon),
   * preserving material / sensor / filter / enable and re-deriving the geometry so the
   * shape stays where it was drawn (see {@link convertColliderData}). One undo step.
   */
  convertCollider(sourceId: EntityId, toShape: ColliderShapeKind): void {
    const op = this.convertColliderOp_(sourceId, toShape);
    if (op) this.history.record('Convert Collider', op.forward, op.reverse);
  }

  /** Convert the collider on many entities (multi-select) as ONE undo step. */
  convertColliderMany(sourceIds: readonly EntityId[], toShape: ColliderShapeKind): void {
    const ops = sourceIds.map((id) => this.convertColliderOp_(id, toShape)).filter((o): o is UndoOp => !!o);
    if (ops.length) this.history.batch('Convert Collider', ops);
  }

  /** Eagerly swap the entity's current convertible collider (box/circle/polygon) for
   *  `toShape`, returning the undo op. Null when it has none / is already that shape. */
  private convertColliderOp_(sourceId: EntityId, toShape: ColliderShapeKind): UndoOp | null {
    const cur = this.model.entityBySource(sourceId)?.components.find((c) => COMP_COLLIDER_SHAPE[c.type]);
    if (!cur) return null;
    const toComp = COLLIDER_SHAPE_COMP[toShape];
    if (cur.type === toComp) return null;
    const fromComp = cur.type;
    const oldData = structuredClone(cur.data) as Record<string, unknown>;
    const newData = convertColliderData(fromComp, toComp, oldData, this.defaultDataFor(toComp));
    this.model.removeComponent(sourceId, fromComp);
    this.model.setComponent(sourceId, toComp, structuredClone(newData));
    return {
      forward: () => { this.model.removeComponent(sourceId, fromComp); this.model.setComponent(sourceId, toComp, structuredClone(newData)); },
      reverse: () => { this.model.removeComponent(sourceId, toComp); this.model.setComponent(sourceId, fromComp, structuredClone(oldData)); },
    };
  }

  /**
   * Paste a copied component's values onto every selected entity that has that
   * component (the Details "Paste Values"). Wholesale data replacement, one undo
   * step; entities without the component are skipped.
   */
  pasteComponentValuesMany(sourceIds: readonly EntityId[], compName: string, data: Record<string, unknown>): void {
    const ops = sourceIds.map((id) => this.replaceComponentOp(id, compName, data)).filter((o): o is UndoOp => !!o);
    this.history.batch(`Paste ${prettyLabel(compName)} Values`, ops);
  }

  /**
   * Reset a component to its registered defaults on every selected entity that has
   * it (the Details "Reset to Defaults"). One undo step.
   */
  resetComponentMany(sourceIds: readonly EntityId[], compName: string): void {
    const defaults = this.defaultDataFor(compName);
    const ops = sourceIds.map((id) => this.replaceComponentOp(id, compName, defaults)).filter((o): o is UndoOp => !!o);
    this.history.batch(`Reset ${prettyLabel(compName)}`, ops);
  }

  /**
   * Toggle an entity's editor visibility — a dedicated editor-only flag the
   * reconciler folds into the render projection. Distinct from a component's
   * gameplay `enabled`: hiding never edits component data, so the running game
   * (which loads the raw model) is unaffected. Undoable.
   */
  setEntityVisible(sourceId: EntityId, visible: boolean): void {
    if (!this.model.entityBySource(sourceId)) return;
    const before = this.model.isHidden(sourceId);
    const after = !visible;
    if (before === after) return;
    this.model.setHidden(sourceId, after);
    this.history.record(
      visible ? 'Show' : 'Hide',
      () => this.model.setHidden(sourceId, after),
      () => this.model.setHidden(sourceId, before),
    );
  }

  /** Lock/unlock an entity — editor-only; blocks viewport picking/transform. Undoable. */
  setEntityLocked(sourceId: EntityId, locked: boolean): void {
    if (!this.model.entityBySource(sourceId)) return;
    const before = this.model.isLocked(sourceId);
    if (before === locked) return;
    this.model.setLocked(sourceId, locked);
    this.history.record(
      locked ? 'Lock' : 'Unlock',
      () => this.model.setLocked(sourceId, locked),
      () => this.model.setLocked(sourceId, before),
    );
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

  /**
   * Discard the open paint stroke (Esc / pointercancel). The live edits only touched
   * the C++ tilemap ({@link paintTileLive} never writes the model), so re-import the
   * pre-stroke blob to revert the viewport — no model write, no undo step.
   */
  cancelTilePaint(): void {
    const s = this.tilePaint;
    this.tilePaint = null;
    if (!s) return;
    const rt = this.model.runtimeFor(s.sourceId);
    if (rt !== undefined) TilemapAPI.importChunks(rt, s.before);
  }

  /**
   * Set the `.estileset` ref list a TilemapLayer paints/renders from (its multi-tileset
   * `tilesetAssets`). Like the chunks blob, this is out-of-band data, so — mirroring the
   * paint commit — we write BOTH the model (for save / undo / play-rebuild) AND push the
   * list to the running tilemap plugin live via {@link TilemapLiveSync}. The reconciler
   * can't carry an out-of-band field, so without the live push the viewport would keep
   * rendering the old tilesets until a reload. One undo step; empty list clears the refs.
   */
  setLayerTilesets(sourceId: EntityId, refs: string[]): void {
    const e = this.model.entityBySource(sourceId);
    if (!e) return;
    const data = (e.components.find((c) => c.type === 'TilemapLayer')?.data ?? {}) as Record<string, unknown>;
    const cur = Array.isArray(data.tilesetAssets)
      ? (data.tilesetAssets as unknown[]).filter((r): r is string => typeof r === 'string' && r !== '')
      : (typeof data.tilesetAsset === 'string' && data.tilesetAsset ? [data.tilesetAsset] : []);
    const next = refs.filter((r) => typeof r === 'string' && r !== '');
    if (valueEqual(cur, next)) return;

    const apply = (list: string[]) => {
      // Model: out-of-band (carried like the chunks blob). Keep the singular `tilesetAsset`
      // in sync as the back-compat first tileset; an empty list deletes both keys.
      this.model.setField(sourceId, 'TilemapLayer', 'tilesetAssets', list.length > 0 ? list.slice() : undefined);
      this.model.setField(sourceId, 'TilemapLayer', 'tilesetAsset', list[0]);
      // Runtime: the reconciler drops out-of-band fields, so push straight to the plugin.
      const rt = this.model.runtimeFor(sourceId);
      if (rt !== undefined) TilemapLiveSync.setLayerTilesets(rt, list);
    };
    apply(next);
    this.history.record('Set Tilesets', () => apply(next), () => apply(cur));
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

  // ─── UI Controllers + Gears ────────────────────────────────────────────────
  // A UIController is a named enum of "pages" scoped to a UI root; a UIGear binds a
  // component field to per-page values. Both are plain array fields — model.setField
  // creates the component if absent, so these mirror setLayerTilesets (read → transform
  // → write + one undo step). Controller/page renames and page removal CASCADE into
  // the gear bindings that resolve to the edited controller (nearest-ancestor rule,
  // so a shadowing same-name controller lower in the tree keeps its gears), all in
  // one undo step. Removing a whole controller deliberately does NOT cascade: an
  // orphaned gear goes inert (getControllerPage → null) and re-resolves if the
  // controller is re-declared on an ancestor — the "move it up the tree" workflow.

  private controllersOf(id: EntityId): ControllerState[] {
    const d = this.model.entityBySource(id)?.components.find((c) => c.type === 'UIController')?.data as UIControllerData | undefined;
    return d?.controllers ? structuredClone(d.controllers) : [];
  }

  private writeControllers(id: EntityId, label: string, next: ControllerState[]): void {
    const cur = this.controllersOf(id);
    if (valueEqual(cur, next)) return;
    const apply = (list: ControllerState[]) => this.model.setField(id, 'UIController', 'controllers', structuredClone(list));
    apply(next);
    this.history.record(label, () => apply(next), () => apply(cur));
  }

  addController(id: EntityId, name: string, pages: string[] = ['default']): void {
    const cur = this.controllersOf(id);
    if (!name || cur.some((c) => c.name === name)) return;
    const p = pages.length ? pages : ['default'];
    this.writeControllers(id, 'Add Controller', [...cur, { name, pages: [...p], current: p[0] }]);
  }

  removeController(id: EntityId, name: string): void {
    const cur = this.controllersOf(id);
    if (!cur.some((c) => c.name === name)) return;
    this.writeControllers(id, 'Remove Controller', cur.filter((c) => c.name !== name));
  }

  setControllerPage(id: EntityId, name: string, page: string): void {
    const cur = this.controllersOf(id);
    const ctrl = cur.find((c) => c.name === name);
    if (!ctrl || ctrl.current === page || !ctrl.pages.includes(page)) return;
    const next = cur.map((c) => (c.name === name ? { ...c, current: page } : c));

    // Project the page's authored gear values into the MODEL, not just the world:
    // the model is the document — Details and the saved scene must show the
    // selected page's values, while the runtime gear-apply system mirrors them
    // (with tween) in the world. Raw model.setField: bypassing the command door
    // keeps an armed ControllerRecorder from re-capturing its own projection.
    const edits: Array<{ id: EntityId; comp: string; key: string; before: unknown; after: unknown }> = [];
    for (const gid of this.subtreeWithGears(id)) {
      if (!this.resolvesTo(gid, id, name)) continue;
      for (const b of this.gearBindingsOf(gid)) {
        if (b.controller !== name) continue;
        const target = b.pages[page];
        if (target === undefined) continue;
        const data = this.model.entityBySource(gid)?.components.find((c) => c.type === b.component)?.data as
          Record<string, unknown> | undefined;
        if (!data) continue;
        const key = b.property.split('.')[0]!;
        const scratch = structuredClone(data);
        if (!writeFieldPath(scratch, b.property, target)) continue;
        if (valueEqual(scratch[key], data[key])) continue;
        edits.push({
          id: gid, comp: b.component, key,
          before: structuredClone(data[key]), after: structuredClone(scratch[key]),
        });
      }
    }

    const apply = (ctrls: ControllerState[], pick: 'before' | 'after') => {
      this.model.setField(id, 'UIController', 'controllers', structuredClone(ctrls));
      for (const e of edits) this.model.setField(e.id, e.comp, e.key, structuredClone(pick === 'after' ? e.after : e.before));
    };
    apply(next, 'after');
    this.history.record('Set Page', () => apply(next, 'after'), () => apply(cur, 'before'));
  }

  addControllerPage(id: EntityId, name: string, page: string): void {
    if (!page) return;
    const cur = this.controllersOf(id);
    this.writeControllers(id, 'Add Page', cur.map((c) =>
      c.name === name && !c.pages.includes(page) ? { ...c, pages: [...c.pages, page] } : c));
  }

  removeControllerPage(id: EntityId, name: string, page: string): void {
    const cur = this.controllersOf(id);
    const ctrl = cur.find((c) => c.name === name);
    if (!ctrl || !ctrl.pages.includes(page) || ctrl.pages.length <= 1) return;
    const next = cur.map((c) => {
      if (c.name !== name) return c;
      const pages = c.pages.filter((p) => p !== page);
      return { ...c, pages, current: c.current === page ? (pages[0] ?? '') : c.current };
    });
    // Strip the page's authored values from resolving gears so re-adding a page
    // with the same name later starts clean instead of reviving stale values.
    this.recordControllerCascade('Remove Page', id, next, name, (b) => {
      if (b.controller !== name || !(page in b.pages)) return b;
      const pages = { ...b.pages };
      delete pages[page];
      return { ...b, pages };
    });
  }

  renameController(id: EntityId, from: string, to: string): void {
    const name = to.trim();
    const cur = this.controllersOf(id);
    if (!name || name === from) return;
    if (!cur.some((c) => c.name === from) || cur.some((c) => c.name === name)) return;
    const next = cur.map((c) => (c.name === from ? { ...c, name } : c));
    this.recordControllerCascade('Rename Controller', id, next, from,
      (b) => (b.controller === from ? { ...b, controller: name } : b));
  }

  renameControllerPage(id: EntityId, ctrlName: string, from: string, to: string): void {
    const page = to.trim();
    const cur = this.controllersOf(id);
    const ctrl = cur.find((c) => c.name === ctrlName);
    if (!page || page === from || !ctrl || !ctrl.pages.includes(from) || ctrl.pages.includes(page)) return;
    const next = cur.map((c) => (c.name !== ctrlName ? c : {
      ...c,
      pages: c.pages.map((p) => (p === from ? page : p)),
      current: c.current === from ? page : c.current,
    }));
    this.recordControllerCascade('Rename Page', id, next, ctrlName, (b) => {
      if (b.controller !== ctrlName || !(from in b.pages)) return b;
      const pages = { ...b.pages };
      pages[page] = pages[from]!;
      delete pages[from];
      return { ...b, pages };
    });
  }

  /** Entity ids in `rootId`'s subtree (inclusive) that carry a UIGear. */
  private subtreeWithGears(rootId: EntityId): EntityId[] {
    const out: EntityId[] = [];
    const stack: EntityId[] = [rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const e = this.model.entityBySource(id);
      if (!e) continue;
      if (e.components.some((c) => c.type === 'UIGear')) out.push(id);
      for (const child of e.children) stack.push(child as EntityId);
    }
    return out;
  }

  /** Whether the nearest declaration of controller `name` from `entityId` is `ownerId`. */
  private resolvesTo(entityId: EntityId, ownerId: EntityId, name: string): boolean {
    let cur: EntityId | null = entityId;
    while (cur != null) {
      if (this.controllersOf(cur).some((c) => c.name === name)) return cur === ownerId;
      cur = (this.model.entityBySource(cur)?.parent as EntityId | null) ?? null;
    }
    return false;
  }

  /**
   * Write `nextControllers` on the owner AND rewrite every resolving gear binding
   * in its subtree through `editBinding`, as ONE undo step — the shared engine
   * behind rename/remove-page cascades.
   */
  private recordControllerCascade(
    label: string,
    ownerId: EntityId,
    nextControllers: ControllerState[],
    name: string,
    editBinding: (b: GearBinding) => GearBinding,
  ): void {
    const beforeCtrls = this.controllersOf(ownerId);
    const gearEdits: Array<{ id: EntityId; before: GearBinding[]; after: GearBinding[] }> = [];
    for (const gid of this.subtreeWithGears(ownerId)) {
      if (!this.resolvesTo(gid, ownerId, name)) continue;
      const before = this.gearBindingsOf(gid);
      const after = before.map(editBinding);
      if (!valueEqual(before, after)) gearEdits.push({ id: gid, before, after });
    }
    if (valueEqual(beforeCtrls, nextControllers) && gearEdits.length === 0) return;
    const apply = (ctrls: ControllerState[], pick: 'before' | 'after') => {
      this.model.setField(ownerId, 'UIController', 'controllers', structuredClone(ctrls));
      for (const g of gearEdits) this.model.setField(g.id, 'UIGear', 'bindings', structuredClone(g[pick]));
    };
    apply(nextControllers, 'after');
    this.history.record(label, () => apply(nextControllers, 'after'), () => apply(beforeCtrls, 'before'));
  }

  moveControllerPage(id: EntityId, name: string, from: number, to: number): void {
    const cur = this.controllersOf(id);
    this.writeControllers(id, 'Reorder Page', cur.map((c) => {
      if (c.name !== name || from < 0 || to < 0 || from >= c.pages.length || to >= c.pages.length) return c;
      const pages = c.pages.slice();
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      return { ...c, pages };
    }));
  }

  private gearBindingsOf(id: EntityId): GearBinding[] {
    const d = this.model.entityBySource(id)?.components.find((c) => c.type === 'UIGear')?.data as UIGearData | undefined;
    return d?.bindings ? structuredClone(d.bindings) : [];
  }

  private writeGearBindings(id: EntityId, label: string, next: GearBinding[]): void {
    const cur = this.gearBindingsOf(id);
    if (valueEqual(cur, next)) return;
    const apply = (list: GearBinding[]) => this.model.setField(id, 'UIGear', 'bindings', structuredClone(list));
    apply(next);
    this.history.record(label, () => apply(next), () => apply(cur));
  }

  /** Live gear-bindings write with NO history — the ControllerRecorder owns undo for a burst. */
  setGearBindingsLive(id: EntityId, next: GearBinding[]): void {
    this.model.setField(id, 'UIGear', 'bindings', structuredClone(next));
  }

  /** Add (or replace, by controller+component+property) one gear binding. Undoable. */
  addGearBinding(id: EntityId, binding: GearBinding): void {
    const cur = this.gearBindingsOf(id);
    const idx = cur.findIndex((b) =>
      b.controller === binding.controller && b.component === binding.component && b.property === binding.property);
    const next = idx >= 0 ? cur.map((b, i) => (i === idx ? binding : b)) : [...cur, binding];
    this.writeGearBindings(id, 'Add Gear', next);
  }

  removeGearBinding(id: EntityId, controller: string, component: string, property: string): void {
    const cur = this.gearBindingsOf(id);
    this.writeGearBindings(id, 'Remove Gear',
      cur.filter((b) => !(b.controller === controller && b.component === component && b.property === property)));
  }

  /** Set (or clear, with undefined) one gear binding's page-change transition. Undoable. */
  setGearTween(id: EntityId, controller: string, component: string, property: string, tween?: GearTween): void {
    const cur = this.gearBindingsOf(id);
    const next = cur.map((b) => {
      if (b.controller !== controller || b.component !== component || b.property !== property) return b;
      if (!tween) {
        const { tween: _removed, ...rest } = b;
        return rest as GearBinding;
      }
      return { ...b, tween: { ...tween } };
    });
    this.writeGearBindings(id, 'Set Gear Transition', next);
  }
}

/** The app's default-session commands. Other sessions construct their own SceneCommandsImpl(model, history). */
export const SceneCommands = new SceneCommandsImpl(SceneModel, EditorHistory);
