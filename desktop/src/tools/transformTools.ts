// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  transformTools.ts
 * @brief The select / move / rotate / scale viewport tools — the imperative shell
 *        over the pure gizmo geometry (gizmo.ts). Each pointer-down resolves to one
 *        of three strokes, in priority order:
 *          1. a gizmo-handle drag → axis-constrained transform of the whole selection;
 *          2. an entity pick → select (Shift toggles) + a free transform of the group
 *             (Alt duplicates first);
 *          3. empty space → a marquee box-select.
 *        A stroke is one undo transaction; group rotate/scale orbit the selection's
 *        shared pivot, so a multi-selection transforms as one rigid group.
 */
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands, type EditorTransaction } from '@/engine/SceneCommands';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { SceneStore } from '@/engine/SceneStore';
import { EngineHost } from '@/engine/EngineHost';
import { snapTo } from '@/engine/viewportMath';
import { eulerToQuat, quatToEuler } from '@/engine/schema';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import type { ToolMode, EntityId } from '@/types';
import {
  type GizmoAxis,
  type Pt,
  GIZMO,
  hitTestGizmo,
  constrainDelta,
  dragPlane,
  planeNormal,
  faceOnPlane,
  HEAD_ON,
  type Vec3,
  type ViewAxes,
  groupPivot,
  rotateRings,
  ringAngleAt,
  hitTestRings,
  axisQuat,
  axisDragFraction,
  axisScreenDir,
  isPlaneAxis,
  quatMul,
  scaleFactors,
  type Quat,
  type RotateRing,
  scaleAround,
  turnAround,
} from './gizmo';
import { Marquee } from './marquee';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';
import type { EditorTool, PointerInput } from './EditorTool';

type Kind = 'move' | 'rotate' | 'scale';

/** Captured start transform of one drag target (in inspector units: degrees, scale factor). */
interface Target {
  sourceId: EntityId;
  start: {
    x: number; y: number; z: number;
    /** The whole pose, so a turn about ANY axis composes onto what was there. */
    rot: Quat;
    sx: number; sy: number; sz: number;
  };
}

interface Drag {
  tx: EditorTransaction;
  kind: Kind;
  axis: GizmoAxis;
  /** The point the gizmo stands on, in space — a selection spread through depth
   *  has a centroid that is not on any one plane. */
  pivotWorld: Vec3;
  pivotClient: Pt; // canvas-relative
  /** Where the world axes point on screen, so a scale drag can be measured along
   *  the arrow that was grabbed rather than as distance from the pivot. */
  axes: ViewAxes;
  /**
   * The world plane this drag is measured on: through the active target, with the
   * normal the grabbed handle implies. Screen motion becomes world motion only on
   * some plane, and along an axis that is not X or Y no z plane contains it.
   * Head-on with an X or Y handle this is the z plane the drag always used.
   */
  planePoint: Vec3;
  planeNormal: Vec3;
  downWorld: Vec3;
  /** Where the press landed, in window-client px — what the slop is measured from. */
  downClient: Pt;
  /** The same press in canvas px, which is the space the handles are laid out in —
   *  what a drag along one of them is measured from. */
  downCanvas: Pt;
  /** rotate: where the press landed — the ring's own parameter, or the screen
   *  angle around the pivot when no ring took the press. */
  startAngle: number;
  /** rotate: which ring was grabbed. Absent = the 2D screen-angle drag. */
  ring: RotateRing | null;
  startDist: number; // scale: cursor screen-distance from the pivot
  /** The entity's world rotation for a local-space drag; absent = world axes. */
  localRotation?: Quat;
  targets: Target[];
  /**
   * Whether this drag may write yet.
   *
   * Grabbing a handle is unambiguous, so a handle drag is armed at once. A drag
   * that started on an entity's BODY is not: the same press is how you select,
   * and applying from the first pixel meant a click that wobbled moved the thing
   * you were only trying to pick. It arms when the press clears the click slop —
   * the same threshold that already decides click-versus-drag.
   */
  armed: boolean;
}

interface MarqueeState {
  downX: number;
  downY: number;
  additive: boolean;
  base: Set<EntityId>;
}

// Canvas top-left in window-client coords; the overlay places gizmos / outlines in
// this canvas-relative space, so hit-testing must convert the pointer into it too.
function canvasOrigin(): { left: number; top: number } | null {
  const c = EngineHost.canvas;
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top };
}

/** Read an entity's current start transform (world position + inspector rotation/scale). */
function readTarget(sourceId: EntityId): Target | null {
  const rtId = SceneModel.runtimeFor(sourceId);
  if (rtId == null) return null;
  const pos = ViewportController.getEntityWorldPos(rtId);
  if (!pos) return null;
  // The rotation field reads as three degrees; a drag composes onto the pose they
  // describe, which is why the whole quaternion is captured and not just its Z.
  const rot = (SceneQuery.getFieldValue(sourceId, 'Transform', 'rotation') as number[]) ?? [0, 0, 0];
  const sc = (SceneQuery.getFieldValue(sourceId, 'Transform', 'scale') as number[]) ?? [1, 1, 1];
  // All three from the composed transform: a drag is measured and written in world
  // space, and a depth taken from the LOCAL field instead put the two halves of one
  // position in two different frames.
  return {
    sourceId,
    start: {
      x: pos.x, y: pos.y, z: pos.z, rot: eulerToQuat(rot),
      sx: sc[0] ?? 1, sy: sc[1] ?? 1, sz: sc[2] ?? 1,
    },
  };
}

/**
 * Drop ids whose ancestor is also selected: transforming the ancestor already
 * carries its subtree, so transforming the descendant too would apply the
 * gesture twice (once directly, once through the parent).
 */
export function pruneDescendants(ids: readonly EntityId[]): EntityId[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    for (let p = SceneModel.entityBySource(id)?.parent; p != null; p = SceneModel.entityBySource(p)?.parent) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

/** Flow-layout (Relative) UINodes: the flex flow owns their position, so a move
 *  gesture has nothing to write (Absolute nodes move via inset edits instead —
 *  see SceneCommands.setEntityWorldPos). Rotation/scale are NOT layout-owned, so this
 *  only gates `move`. */
export function isFlowUINode(sourceId: EntityId): boolean {
  const pos = SceneQuery.getFieldValue(sourceId, 'UINode', 'position');
  return pos != null && Number(pos) === 0;
}

/** A UINode with no Canvas ancestor (the UI layout root) — it has no layout box, so
 *  it can't be positioned at all until it's placed under a Canvas. */
export function isOrphanUINode(sourceId: EntityId): boolean {
  const e = SceneModel.entityBySource(sourceId);
  if (!e || !e.components.some((c) => c.type === 'UINode')) return false;
  for (let p = e.parent; p != null; p = SceneModel.entityBySource(p)?.parent ?? null) {
    if (SceneModel.entityBySource(p)?.components.some((c) => c.type === 'Canvas')) return false;
  }
  return true;
}

let flowHintAt = 0;
let canvasHintAt = 0;
let lockHintAt = 0;

/**
 * The subset of a selection the viewport may transform: locked (and environment)
 * entities are dropped.
 *
 * This is the whole of what a lock does to a gesture, and it sits here because
 * both halves of the gizmo read it — the tool, to decide what a drag writes, and
 * the viewport, to place (or hide) the gizmo. Picking already refuses a locked
 * entity, but the outliner selects one happily, and until this existed the gizmo
 * that appeared for it dragged like any other: the lock stopped the click and
 * nothing else. A locked entity can still be selected and inspected (that is how
 * you unlock it) — it just has no handles, so the viewport reads the space it
 * occupies as empty.
 */
export function transformableIds(ids: readonly EntityId[]): EntityId[] {
  return ids.filter((id) => SceneModel.isEditable(id));
}

function captureTargets(ids: readonly EntityId[], kind: Kind = 'move'): Target[] {
  const pruned = pruneDescendants(ids);
  let kept = transformableIds(pruned);
  // Say so once per burst when a lock is what swallowed part of the gesture —
  // otherwise dragging a mixed selection looks like the editor lost some of it.
  if (kept.length < pruned.length && Date.now() - lockHintAt > 4000) {
    lockHintAt = Date.now();
    Toasts.push(t('vp.lockedHint'), 'info');
  }
  if (kind === 'move') {
    // A UI element with no Canvas has no layout box — it can't be positioned at all.
    // Exclude it and point to the fix (the inspector's "Place under a Canvas").
    if (kept.some(isOrphanUINode)) {
      kept = kept.filter((id) => !isOrphanUINode(id));
      if (Date.now() - canvasHintAt > 4000) {
        canvasHintAt = Date.now();
        Toasts.push(t('vp.orphanUiHint'), 'info');
      }
    }
    // A flow (Relative) node's position is owned by the layout — moving it does
    // nothing until the user explicitly switches it to Absolute (the inspector's
    // Position field / an anchor preset). Exclude it and hint how, once per burst.
    const flow = kept.filter(isFlowUINode);
    if (flow.length > 0) {
      kept = kept.filter((id) => !isFlowUINode(id));
      if (Date.now() - flowHintAt > 4000) {
        flowHintAt = Date.now();
        Toasts.push(t('vp.flowUiHint'), 'info');
      }
    }
  }
  return kept.map(readTarget).filter((t): t is Target => t !== null);
}

/** Selection centroid = mean of the live world positions of `ids`. */
function pivotOf(ids: readonly EntityId[]): Vec3 | null {
  const pts: Vec3[] = [];
  for (const sid of ids) {
    const rtId = SceneModel.runtimeFor(sid);
    if (rtId == null) continue;
    const pos = ViewportController.getEntityWorldPos(rtId);
    if (pos) pts.push(pos);
  }
  return pts.length ? groupPivot(pts) : null;
}

/** The active (primary) entity of a selection — the one local space / pivot mode key off. */
function primaryOf(ids: readonly EntityId[]): EntityId | null {
  const primary = useSelection.getState().selectedId;
  return primary != null && ids.includes(primary) ? primary : (ids[0] ?? null);
}

/** The active entity's world rotation in radians (drives the local-axis frame —
 *  the on-screen orientation is the parent-composed rotation, not the local one). */
/** The primary's world rotation — what a local-space handle turns the axes by. */
function primaryRotationQuat(ids: readonly EntityId[]): Quat | undefined {
  const id = primaryOf(ids);
  const rt = id != null ? SceneModel.runtimeFor(id) : null;
  return rt != null ? ViewportController.getEntityWorldQuat(rt) : undefined;
}

/**
 * The gizmo pivot for the current `pivotMode`: the active entity's own position
 * ('pivot'), else the selection centroid ('center'). Shared by the tool and the
 * viewport's gizmo placement so both agree — including on there being no gizmo at
 * all when nothing in the selection may be transformed (an all-locked selection
 * returns null, which reads as "no handles" at both ends).
 */
export function selectionPivot(ids: readonly EntityId[]): Vec3 | null {
  const editable = transformableIds(ids);
  if (editable.length === 0) return null;
  if (useEditorStore.getState().pivotMode === 'pivot') {
    const id = primaryOf(editable);
    const rt = id != null ? SceneModel.runtimeFor(id) : null;
    const pos = rt != null ? ViewportController.getEntityWorldPos(rt) : null;
    if (pos) return pos;
  }
  return pivotOf(editable);
}

/** The frame the gizmo's handles stand in: the active entity's world rotation in
 *  local space, else undefined for the world axes. Shared with the viewport's
 *  render, so the handles it draws are the handles this aims through. */
export function gizmoFrame(ids: readonly EntityId[]): Quat | undefined {
  return useEditorStore.getState().coordSpace === 'local'
    ? primaryRotationQuat(transformableIds(ids))
    : undefined;
}

/**
 * Alt-drag: clone each id and return targets that drag from the *originals'* start
 * transforms (so the copies track the cursor exactly, the clone offset overwritten
 * on the first move). Selects the new copies. Each clone is its own undo step,
 * preceding the move gesture. Locked members are left out, like every other
 * viewport write — an Alt-drag over a mixed selection clones what it can move.
 */
function altDuplicateTargets(ids: readonly EntityId[]): { targets: Target[]; pivot: Vec3 | null } {
  const targets: Target[] = [];
  const pts: Vec3[] = [];
  for (const sid of transformableIds(pruneDescendants(ids))) {
    const t = readTarget(sid);
    if (!t) continue;
    const copy = SceneCommands.duplicateEntity(sid);
    if (copy == null) continue;
    targets.push({ sourceId: copy, start: t.start });
    pts.push({ x: t.start.x, y: t.start.y, z: t.start.z });
  }
  if (targets.length) {
    const ids2 = targets.map((t) => t.sourceId);
    useSelection.getState().selectMany(ids2, ids2[ids2.length - 1]);
  }
  return { targets, pivot: pts.length ? groupPivot(pts) : null };
}

function beginDrag(
  kind: Kind,
  axis: GizmoAxis,
  targets: Target[],
  pivotWorld: Vec3,
  pivotClient: Pt,
  p: PointerInput,
  cur: Pt,
  axes: ViewAxes,
  localRotation: Quat | undefined = undefined,
  armed = true,
  ring: RotateRing | null = null,
): Drag {
  const label = kind === 'rotate' ? 'Rotate' : kind === 'scale' ? 'Scale' : 'Move';
  // Through the pivot — the point the handle being grabbed is drawn at. Taking the
  // plane through some other point leaves the world under the cursor sliding past
  // the arrow the cursor is on.
  const planePoint = pivotWorld;
  const normal = planeNormal(dragPlane(axis, axes));
  const downWorld = ViewportController.canvasToWorldOnPlane(
    p.clientX, p.clientY, planePoint, normal) ?? { x: 0, y: 0, z: planePoint.z };
  // Freeze React panel re-renders (Details/Outliner) for the drag — the model
  // mutates every frame while the viewport stays live via the Reconciler. Resumed
  // on commit (onPointerUp) or abort (cancel), flushing one final bump.
  SceneStore.suspend();
  return {
    tx: SceneCommands.transaction(label),
    kind,
    axis,
    pivotWorld,
    pivotClient,
    axes,
    planePoint,
    planeNormal: normal,
    downWorld,
    downClient: { x: p.clientX, y: p.clientY },
    downCanvas: { x: cur.x, y: cur.y },
    ring,
    // A grabbed ring measures in its own parameter; without one this is the
    // screen angle around the pivot, which is what the 2D drag always used.
    startAngle: ring
      ? (ringAngleAt(ring, { x: cur.x - pivotClient.x, y: cur.y - pivotClient.y }, GIZMO.ringRadius) ?? 0)
      : Math.atan2(cur.y - pivotClient.y, cur.x - pivotClient.x),
    // The grab point's screen distance from the pivot. Scale is now delta-based off
    // this (not a ratio), so it needs no floor and can't blow up when you grab near
    // the pivot (the center box / an entity's body).
    startDist: Math.hypot(cur.x - pivotClient.x, cur.y - pivotClient.y),
    localRotation,
    targets,
    armed,
  };
}

function applyMove(d: Drag, curWorld: Vec3): void {
  // The delta was measured ON the handle's plane, so constraining it is a
  // projection onto the axis — for a plane handle there is nothing left to do.
  const delta = constrainDelta(d.axis, {
    x: curWorld.x - d.downWorld.x,
    y: curWorld.y - d.downWorld.y,
    z: curWorld.z - d.downWorld.z,
  }, d.localRotation);
  let { x: dx, y: dy, z: dz } = delta;
  const ed = useEditorStore.getState();
  if (ed.snapping && d.targets.length) {
    // Snap the primary's resulting position to the grid, apply that delta to all,
    // so the group keeps its relative layout. An axis the handle does not move
    // has a zero delta, and snapping it would drag the whole group onto the grid.
    const p0 = d.targets[0].start;
    if (dx !== 0) dx = snapTo(p0.x + dx, ed.snapStep) - p0.x;
    if (dy !== 0) dy = snapTo(p0.y + dy, ed.snapStep) - p0.y;
    if (dz !== 0) dz = snapTo(p0.z + dz, ed.snapStep) - p0.z;
  }
  // Through the one door a viewport move goes through: it routes a UINode to its
  // layout, and re-expresses a parented entity's world target in its parent's frame.
  for (const t of d.targets) {
    SceneCommands.setEntityWorldPos(t.sourceId, t.start.x + dx, t.start.y + dy, t.start.z + dz);
  }
}

/** The group turn a rotate drag applies: every member's arm about the shared pivot,
 *  and the same turn composed onto each member's own pose. */
function applyTurn(d: Drag, turn: Quat): void {
  for (const t of d.targets) {
    const p = turnAround({ x: t.start.x, y: t.start.y, z: t.start.z }, d.pivotWorld, turn);
    SceneCommands.setEntityWorldPos(t.sourceId, p.x, p.y, p.z);
    SceneCommands.setField(t.sourceId, 'Transform', 'rotation', 'euler',
      quatToEuler(quatMul(turn, t.start.rot)));
  }
}

function applyRotate(d: Drag, cur: Pt): void {
  const offset = { x: cur.x - d.pivotClient.x, y: cur.y - d.pivotClient.y };
  // The ring's OWN parameter, not the screen angle: the two agree only where the
  // ring faces the eye, and everywhere else the projection is an ellipse.
  const now = d.ring ? ringAngleAt(d.ring, offset, GIZMO.ringRadius) : null;
  let deltaRad = d.ring
    ? (now === null ? 0 : wrapPi(now - d.startAngle))
    // Screen y is down, so a clockwise screen drag is a negative world rotation.
    : -(Math.atan2(offset.y, offset.x) - d.startAngle);

  const ed = useEditorStore.getState();
  if (ed.snapping) {
    // Snap the primary's RESULTING absolute angle to the grid, then apply that delta
    // to all (like move-snap) — so a 7°-rotated object lands on 15/30/45, not 22/37.
    const r0 = axisAngleOf(d.targets[0].start.rot, d.ring?.axis ?? 'z');
    const deg = snapTo(r0 + (deltaRad * 180) / Math.PI, ed.snapAngle) - r0;
    deltaRad = (deg * Math.PI) / 180;
  }
  // The whole arm from the pivot turns: about X or Y a group rotation carries its
  // members through depth, and a member at a depth of its own swings on a longer
  // arm than its x/y alone describe.
  applyTurn(d, axisQuat(d.ring?.axis ?? 'z', deltaRad));
}

/** An angle folded into (-pi, pi] — a drag past the seam is a small turn, not a full one. */
function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/** How far a pose already turns about one axis, in degrees — what snapping rounds. */
function axisAngleOf(q: Quat, axis: 'x' | 'y' | 'z'): number {
  return quatToEuler(q)[axis === 'x' ? 0 : axis === 'y' ? 1 : 2];
}

function applyScale(d: Drag, cur: Pt): void {
  const delta = { x: cur.x - d.downCanvas.x, y: cur.y - d.downCanvas.y };
  // f is exactly 1 at the grab point, so a grab near the pivot cannot run away.
  // An axis handle reads the drag ALONG its own arrow; a plane (or centre) handle
  // has no single direction, so it keeps the radial reading.
  const f = 1 + (isPlaneAxis(d.axis)
    ? (Math.hypot(cur.x - d.pivotClient.x, cur.y - d.pivotClient.y) - d.startDist) / GIZMO.axisLen
    : axisDragFraction(axisScreenDir(d.axes, d.axis, d.localRotation), delta));
  const ed = useEditorStore.getState();
  let factor = scaleFactors(d.axis, f);
  if (ed.snapping) {
    // Snap the primary's RESULTING absolute scale to the grid, then back out the
    // factor (like move-snap) — so a scaled object lands on 0.1 increments.
    const s0 = d.targets[0].start;
    const snapAxis = (k: number, start: number): number =>
      (k !== 1 && start ? snapTo(start * k, ed.snapScale) / start : k);
    factor = {
      x: snapAxis(factor.x, s0.sx), y: snapAxis(factor.y, s0.sy), z: snapAxis(factor.z, s0.sz),
    };
  }
  // Floor the factor so a drag through the pivot can't collapse or mirror the object.
  factor = { x: Math.max(0.01, factor.x), y: Math.max(0.01, factor.y), z: Math.max(0.01, factor.z) };
  for (const t of d.targets) {
    const np = scaleAround({ x: t.start.x, y: t.start.y, z: t.start.z }, d.pivotWorld, factor);
    SceneCommands.setEntityWorldPos(t.sourceId, np.x, np.y, np.z);
    SceneCommands.setField(t.sourceId, 'Transform', 'scale', 'vec3',
      [t.start.sx * factor.x, t.start.sy * factor.y, t.start.sz * factor.z]);
  }
}

/** Repeated clicks within this pixel radius count as the same spot; a press that
 *  travels farther is a drag, not a click. */
const CLICK_SLOP = 4;

export interface CycleState {
  x: number;
  y: number;
  key: string;
  idx: number;
}

const stackKey = (stack: readonly EntityId[]) => stack.join(',');

/** True when a click at (x,y) continues the click-through walk stored in `c`. */
export function sameCycleSpot(c: CycleState | null, key: string, x: number, y: number): boolean {
  return c != null && c.key === key && Math.abs(c.x - x) <= CLICK_SLOP && Math.abs(c.y - y) <= CLICK_SLOP;
}

/** Next click-through pick: the topmost, or the next one down when the same spot on
 *  the same stack is re-clicked (wrapping). Null when there's nothing to cycle. */
export function stepCycle(stack: readonly EntityId[], c: CycleState | null, x: number, y: number): { pick: EntityId; cycle: CycleState } | null {
  if (stack.length < 2) return null;
  const key = stackKey(stack);
  const idx = sameCycleSpot(c, key, x, y) ? (c!.idx + 1) % stack.length : 0;
  return { pick: stack[idx], cycle: { x, y, key, idx } };
}

function makeTransformTool(mode: ToolMode): EditorTool {
  let drag: Drag | null = null;
  let marquee: MarqueeState | null = null;
  let pendingClick: { downX: number; downY: number; stack: EntityId[] } | null = null;
  let cycle: CycleState | null = null;
  // Ids to Alt-duplicate on the FIRST real drag movement — deferred from pointer-down
  // so a bare Alt-click never leaves a copy stacked on the original.
  let altPending: readonly EntityId[] | null = null;
  // The select tool shares the move drag (click selects, drag moves) but shows no
  // transform gizmo; move/rotate/scale do. kind === the tool's transform.
  const kind: Kind = mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'move';

  return {
    id: `transform.${mode}`,

    onPointerDown(p, ctx) {
      const origin = canvasOrigin();
      if (!origin) return false;
      const cur: Pt = { x: p.clientX - origin.left, y: p.clientY - origin.top };
      const sel = useSelection.getState();
      const ed = useEditorStore.getState();

      // 1) Gizmo handle → axis-constrained transform of the current selection.
      if (mode !== 'select' && ed.showGizmos && sel.selectedIds.size > 0) {
        const ids = [...sel.selectedIds];
        const pivotWorld = selectionPivot(ids);
        const pc = pivotWorld
          ? ViewportController.worldToClient(pivotWorld.x, pivotWorld.y, pivotWorld.z)
          : null;
        if (pivotWorld && pc) {
          // Aimed through the SAME basis the handles are drawn from, so the arrow
          // you grab is the axis that moves. Head-on, world Z projects to nothing —
          // which is what leaves a 2D gizmo its two arrows and single ring.
          const axes = ViewportController.viewAxes() ?? HEAD_ON;
          const localRotation = ed.coordSpace === 'local' ? primaryRotationQuat(ids) : undefined;
          const ring = mode === 'rotate' ? hitTestRings(rotateRings(axes), pc, cur) : null;
          const handle = mode === 'rotate'
            ? (ring && { id: `rotate.${ring.axis}`, mode, axis: ring.axis as GizmoAxis })
            : hitTestGizmo(mode as 'move' | 'scale', axes, pc, cur, localRotation);
          if (handle) {
            drag = beginDrag(kind, handle.axis, captureTargets(ids, kind), pivotWorld, pc, p, cur, axes, localRotation, true, ring);
            ed.setActiveGizmoAxis(handle.axis); // light up the grabbed handle
            // Alt-duplicate rides the handle too, now that the body no longer
            // transforms — otherwise Alt+drag would have nowhere to happen in the
            // transform tools. Deferred to the first real move, as it always was.
            altPending = p.alt ? ids : null;
            ctx.capture(p.pointerId);
            return true;
          }
        }
      }

      // 2) Pick an entity → select + free transform (Shift toggles, Alt duplicates).
      const stack = ViewportController.pickEntitiesAt(p.clientX, p.clientY)
        .map((rt) => SceneModel.sourceFor(rt))
        .filter((s): s is EntityId => s != null);
      const hitSource = stack[0] ?? null;
      if (hitSource != null) {
        if (p.shift) {
          sel.toggleSelect(hitSource);
          cycle = null;
          return false;
        }
        // Fresh click selects the topmost; mid-cycle keeps the current pick so
        // pointer-up can advance it (and a drag still grabs the selected object).
        const cycling = sameCycleSpot(cycle, stack.join(','), p.clientX, p.clientY);
        if (!cycling && !sel.selectedIds.has(hitSource)) sel.select(hitSource);
        pendingClick = { downX: p.clientX, downY: p.clientY, stack };
        const ids = [...useSelection.getState().selectedIds];

        // A transform tool's gizmo is the drag surface; the body is only for
        // picking. Dragging the body used to transform freely on both axes at
        // once, which made every click a potential nudge — press to select,
        // travel a pixel, and the thing you were aiming at had moved (or, in the
        // rotate/scale tools, spun or resized). The handles say which axis you
        // meant; the body says nothing, so it no longer answers.
        //
        // The select tool keeps it: it shows no gizmo, so a body drag is the only
        // move it has, and it arms only past the click slop.
        if (mode !== 'select') {
          ctx.capture(p.pointerId);
          return true;
        }

        // Drag the originals for now; an Alt-drag defers its clone to the first real
        // move (onPointerMove), so a bare Alt-click leaves nothing behind.
        const targets = captureTargets(ids);
        const pivotWorld = selectionPivot(ids);
        altPending = p.alt ? ids : null;
        if (!targets.length || !pivotWorld) return false;
        const pc = ViewportController.worldToClient(pivotWorld.x, pivotWorld.y, pivotWorld.z) ?? cur;
        // Dragging the body itself slides it on the plane facing the eye, which
        // head-on is the XY plane this always used.
        const bodyAxes = ViewportController.viewAxes() ?? HEAD_ON;
        drag = beginDrag(kind, faceOnPlane(bodyAxes), targets, pivotWorld, pc, p, cur, bodyAxes, undefined, false);
        ctx.capture(p.pointerId);
        return true;
      }

      // 3) Empty space → marquee box-select (Shift = additive).
      cycle = null;
      marquee = { downX: p.clientX, downY: p.clientY, additive: p.shift, base: new Set(sel.selectedIds) };
      ctx.capture(p.pointerId);
      return true;
    },

    onPointerMove(p) {
      const past = (from: Pt): boolean =>
        Math.abs(p.clientX - from.x) > CLICK_SLOP || Math.abs(p.clientY - from.y) > CLICK_SLOP;

      // A press that travels past the slop is a drag, not a click — disarm the
      // click-through cycle so releasing won't advance the selection.
      if (pendingClick && past({ x: pendingClick.downX, y: pendingClick.downY })) {
        pendingClick = null;
        cycle = null;
      }
      // Measured from the DRAG's own press, not the pick's: a handle grab sets no
      // pendingClick (it must not cycle the selection), and Alt-duplicate has to
      // work when you drag an axis.
      if (drag && past(drag.downClient)) {
        // A deferred Alt-drag clones NOW and retargets onto the fresh copies, so a
        // bare Alt-click leaves nothing behind.
        if (altPending) {
          const dup = altDuplicateTargets(altPending);
          if (dup.targets.length) drag.targets = dup.targets;
          altPending = null;
        }
        // And the intent is a drag, so a body drag may write from here.
        drag.armed = true;
      }
      if (drag?.armed) {
        const origin = canvasOrigin();
        const cur: Pt = origin
          ? { x: p.clientX - origin.left, y: p.clientY - origin.top }
          : { x: p.clientX, y: p.clientY };
        if (drag.kind === 'move') {
          const w = ViewportController.canvasToWorldOnPlane(
            p.clientX, p.clientY, drag.planePoint, drag.planeNormal);
          if (w) applyMove(drag, w);
        } else if (drag.kind === 'rotate') {
          applyRotate(drag, cur);
        } else {
          applyScale(drag, cur);
        }
        return;
      }
      if (marquee) {
        const origin = canvasOrigin();
        const x0 = Math.min(marquee.downX, p.clientX) - (origin?.left ?? 0);
        const y0 = Math.min(marquee.downY, p.clientY) - (origin?.top ?? 0);
        const w = Math.abs(p.clientX - marquee.downX);
        const h = Math.abs(p.clientY - marquee.downY);
        Marquee.set({ x: x0, y: y0, w, h });
      }
    },

    onPointerUp(p, ctx) {
      ctx.release(p.pointerId);
      altPending = null; // a bare Alt-click never cloned — nothing to keep
      if (drag) {
        drag.tx.commit();
        SceneStore.resume();
        drag = null;
        useEditorStore.getState().setActiveGizmoAxis(null);
      }
      // A bare click (no drag) on overlapping entities walks to the next one down.
      // Outside the `drag` branch: a press on a body in a transform tool no longer
      // starts one, and click-through has to keep working without it.
      if (pendingClick) {
        const stepped = stepCycle(pendingClick.stack, cycle, p.clientX, p.clientY);
        pendingClick = null;
        if (stepped) {
          useSelection.getState().select(stepped.pick);
          cycle = stepped.cycle;
        } else {
          cycle = null;
        }
        return;
      }
      if (marquee) {
        const moved = Math.abs(p.clientX - marquee.downX) > 3 || Math.abs(p.clientY - marquee.downY) > 3;
        const origin = canvasOrigin();
        Marquee.set(null);
        const m = marquee;
        marquee = null;
        if (moved) {
          const rect = {
            x: Math.min(m.downX, p.clientX) - (origin?.left ?? 0),
            y: Math.min(m.downY, p.clientY) - (origin?.top ?? 0),
            w: Math.abs(p.clientX - m.downX),
            h: Math.abs(p.clientY - m.downY),
          };
          const hits = ViewportController.pickInRect(rect)
            .map((rt) => SceneModel.sourceFor(rt))
            .filter((s): s is EntityId => s != null);
          const set = m.additive ? new Set([...m.base, ...hits]) : new Set(hits);
          const arr = [...set];
          if (arr.length) useSelection.getState().selectMany(arr, arr[arr.length - 1]);
          else if (!m.additive) useSelection.getState().select(null);
        } else if (!m.additive) {
          useSelection.getState().select(null); // a bare click on empty space clears
        }
      }
    },

    cancel() {
      if (drag) {
        drag.tx.abort();
        SceneStore.resume();
        drag = null;
        useEditorStore.getState().setActiveGizmoAxis(null);
      }
      Marquee.set(null);
      marquee = null;
      pendingClick = null;
      cycle = null;
      altPending = null;
    },
  };
}

/** Transform tools keyed by editor ToolMode (select/move/rotate/scale). */
export const TRANSFORM_TOOLS: Record<string, EditorTool> = {
  select: makeTransformTool('select'),
  move: makeTransformTool('move'),
  rotate: makeTransformTool('rotate'),
  scale: makeTransformTool('scale'),
};
