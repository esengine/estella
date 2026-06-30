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
 *        shared pivot, so multi-select transforms behave like UE's.
 */
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands, type EditorTransaction } from '@/engine/SceneCommands';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { EngineHost } from '@/engine/EngineHost';
import { snapTo } from '@/engine/viewportMath';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import type { ToolMode, EntityId } from '@/types';
import {
  type GizmoAxis,
  type GizmoMode,
  type Pt,
  hitTestGizmo,
  constrainLocalDelta,
  groupPivot,
  rotateAround,
  scaleAround,
} from './gizmo';
import { Marquee } from './marquee';
import type { EditorTool, PointerInput } from './EditorTool';

type Kind = 'move' | 'rotate' | 'scale';

/** Captured start transform of one drag target (in inspector units: degrees, scale factor). */
interface Target {
  sourceId: EntityId;
  start: { x: number; y: number; rotDeg: number; sx: number; sy: number; sz: number };
}

interface Drag {
  tx: EditorTransaction;
  kind: Kind;
  axis: GizmoAxis;
  pivotWorld: Pt;
  pivotClient: Pt; // canvas-relative
  downWorld: Pt;
  startAngle: number; // rotate: cursor screen-angle around the pivot
  startDist: number; // scale: cursor screen-distance from the pivot
  /** Local-frame angle (world radians) for axis-constrained move; 0 = world axes. */
  angleRad: number;
  targets: Target[];
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
  const pos = ViewportController.getEntityXY(rtId);
  if (!pos) return null;
  const rotDeg = (SceneQuery.getFieldValue(sourceId, 'Transform', 'rotation') as number) ?? 0;
  const sc = (SceneQuery.getFieldValue(sourceId, 'Transform', 'scale') as number[]) ?? [1, 1, 1];
  return { sourceId, start: { x: pos.x, y: pos.y, rotDeg, sx: sc[0] ?? 1, sy: sc[1] ?? 1, sz: sc[2] ?? 1 } };
}

function captureTargets(ids: readonly EntityId[]): Target[] {
  return ids.map(readTarget).filter((t): t is Target => t !== null);
}

/** Selection centroid = mean of the live world positions of `ids`. */
function pivotOf(ids: readonly EntityId[]): Pt | null {
  const pts: Pt[] = [];
  for (const sid of ids) {
    const rtId = SceneModel.runtimeFor(sid);
    if (rtId == null) continue;
    const pos = ViewportController.getEntityXY(rtId);
    if (pos) pts.push(pos);
  }
  return pts.length ? groupPivot(pts) : null;
}

/** The active (primary) entity of a selection — the one local space / pivot mode key off. */
function primaryOf(ids: readonly EntityId[]): EntityId | null {
  const primary = useSelection.getState().selectedId;
  return primary != null && ids.includes(primary) ? primary : (ids[0] ?? null);
}

/** The active entity's world rotation in radians (drives local-axis frame). */
function primaryRotationRad(ids: readonly EntityId[]): number {
  const id = primaryOf(ids);
  if (id == null) return 0;
  const deg = (SceneQuery.getFieldValue(id, 'Transform', 'rotation') as number) ?? 0;
  return (deg * Math.PI) / 180;
}

/**
 * The gizmo pivot for the current `pivotMode`: the active entity's own position
 * ('pivot'), else the selection centroid ('center'). Shared by the tool and the
 * viewport's gizmo placement so both agree.
 */
export function selectionPivot(ids: readonly EntityId[]): Pt | null {
  if (useEditorStore.getState().pivotMode === 'pivot') {
    const id = primaryOf(ids);
    const rt = id != null ? SceneModel.runtimeFor(id) : null;
    const pos = rt != null ? ViewportController.getEntityXY(rt) : null;
    if (pos) return pos;
  }
  return pivotOf(ids);
}

/** The gizmo's on-screen rotation (radians): the negated active rotation in local
 *  space (screen y is down), else 0. Shared with the viewport's gizmo render. */
export function gizmoScreenAngleRad(ids: readonly EntityId[]): number {
  return useEditorStore.getState().coordSpace === 'local' ? -primaryRotationRad(ids) : 0;
}

/**
 * Alt-drag: clone each id and return targets that drag from the *originals'* start
 * transforms (so the copies track the cursor exactly, the clone offset overwritten
 * on the first move). Selects the new copies. Each clone is its own undo step,
 * preceding the move gesture.
 */
function altDuplicateTargets(ids: readonly EntityId[]): { targets: Target[]; pivot: Pt | null } {
  const targets: Target[] = [];
  const pts: Pt[] = [];
  for (const sid of ids) {
    const t = readTarget(sid);
    if (!t) continue;
    const copy = SceneCommands.duplicateEntity(sid);
    if (copy == null) continue;
    targets.push({ sourceId: copy, start: t.start });
    pts.push({ x: t.start.x, y: t.start.y });
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
  pivotWorld: Pt,
  pivotClient: Pt,
  p: PointerInput,
  cur: Pt,
  angleRad = 0,
): Drag {
  const label = kind === 'rotate' ? 'Rotate' : kind === 'scale' ? 'Scale' : 'Move';
  const downWorld = ViewportController.canvasToWorld(p.clientX, p.clientY) ?? { x: 0, y: 0 };
  return {
    tx: SceneCommands.transaction(label),
    kind,
    axis,
    pivotWorld,
    pivotClient,
    downWorld,
    startAngle: Math.atan2(cur.y - pivotClient.y, cur.x - pivotClient.x),
    startDist: Math.max(1, Math.hypot(cur.x - pivotClient.x, cur.y - pivotClient.y)),
    angleRad,
    targets,
  };
}

function applyMove(d: Drag, curWorld: Pt): void {
  let dx = curWorld.x - d.downWorld.x;
  let dy = curWorld.y - d.downWorld.y;
  // angleRad is 0 for world axes (→ identical to constrainWorldDelta) and the
  // entity's rotation for local axes, so the drag slides along the object's own X/Y.
  [dx, dy] = constrainLocalDelta(d.axis, dx, dy, d.angleRad);
  const ed = useEditorStore.getState();
  if (ed.snapping && d.targets.length) {
    // Snap the primary's resulting position to the grid, apply that delta to all,
    // so the group keeps its relative layout (UE-style group grid snap).
    const p0 = d.targets[0].start;
    if (d.axis !== 'y') dx = snapTo(p0.x + dx, ed.snapStep) - p0.x;
    if (d.axis !== 'x') dy = snapTo(p0.y + dy, ed.snapStep) - p0.y;
  }
  for (const t of d.targets) SceneCommands.setEntityXY(t.sourceId, t.start.x + dx, t.start.y + dy);
}

function applyRotate(d: Drag, cur: Pt): void {
  const ang = Math.atan2(cur.y - d.pivotClient.y, cur.x - d.pivotClient.x);
  // Screen y is down, so a clockwise screen drag is a negative world rotation.
  let worldDeltaDeg = (-(ang - d.startAngle) * 180) / Math.PI;
  const ed = useEditorStore.getState();
  if (ed.snapping) worldDeltaDeg = snapTo(worldDeltaDeg, ed.snapAngle);
  const rad = (worldDeltaDeg * Math.PI) / 180;
  for (const t of d.targets) {
    const np = rotateAround({ x: t.start.x, y: t.start.y }, d.pivotWorld, rad);
    SceneCommands.setEntityXY(t.sourceId, np.x, np.y);
    SceneCommands.setField(t.sourceId, 'Transform', 'rotation', 'angle', t.start.rotDeg + worldDeltaDeg);
  }
}

function applyScale(d: Drag, cur: Pt): void {
  const f = Math.hypot(cur.x - d.pivotClient.x, cur.y - d.pivotClient.y) / d.startDist;
  const ed = useEditorStore.getState();
  let fx = d.axis === 'y' ? 1 : f;
  let fy = d.axis === 'x' ? 1 : f;
  if (ed.snapping) {
    if (d.axis !== 'y') fx = Math.max(0.01, snapTo(fx, ed.snapScale));
    if (d.axis !== 'x') fy = Math.max(0.01, snapTo(fy, ed.snapScale));
  }
  for (const t of d.targets) {
    const np = scaleAround({ x: t.start.x, y: t.start.y }, d.pivotWorld, fx, fy);
    SceneCommands.setEntityXY(t.sourceId, np.x, np.y);
    SceneCommands.setField(t.sourceId, 'Transform', 'scale', 'vec3', [t.start.sx * fx, t.start.sy * fy, t.start.sz]);
  }
}

function makeTransformTool(mode: ToolMode): EditorTool {
  let drag: Drag | null = null;
  let marquee: MarqueeState | null = null;
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
        const pc = pivotWorld ? ViewportController.worldToClient(pivotWorld.x, pivotWorld.y) : null;
        if (pivotWorld && pc) {
          const localAngle = ed.coordSpace === 'local' ? primaryRotationRad(ids) : 0;
          const handle = hitTestGizmo(mode as GizmoMode, pc, cur, -localAngle);
          if (handle) {
            drag = beginDrag(kind, handle.axis, captureTargets(ids), pivotWorld, pc, p, cur, localAngle);
            ed.setActiveGizmoAxis(handle.axis); // light up the grabbed handle
            ctx.capture(p.pointerId);
            return true;
          }
        }
      }

      // 2) Pick an entity → select + free transform (Shift toggles, Alt duplicates).
      const rtId = ViewportController.pickEntity(p.clientX, p.clientY);
      const hitSource = rtId != null ? SceneModel.sourceFor(rtId) ?? null : null;
      if (hitSource != null) {
        if (p.shift) {
          sel.toggleSelect(hitSource); // selection edit only; no drag
          return false;
        }
        const inSel = sel.selectedIds.has(hitSource);
        if (!inSel) sel.select(hitSource);
        const ids = inSel ? [...sel.selectedIds] : [hitSource];

        let targets: Target[];
        let pivotWorld: Pt | null;
        if (p.alt) {
          const dup = altDuplicateTargets(ids);
          targets = dup.targets;
          pivotWorld = dup.pivot;
        } else {
          targets = captureTargets(ids);
          pivotWorld = selectionPivot(ids);
        }
        if (!targets.length || !pivotWorld) return false;
        const pc = ViewportController.worldToClient(pivotWorld.x, pivotWorld.y) ?? cur;
        drag = beginDrag(kind, 'xy', targets, pivotWorld, pc, p, cur);
        ctx.capture(p.pointerId);
        return true;
      }

      // 3) Empty space → marquee box-select (Shift = additive).
      marquee = { downX: p.clientX, downY: p.clientY, additive: p.shift, base: new Set(sel.selectedIds) };
      ctx.capture(p.pointerId);
      return true;
    },

    onPointerMove(p) {
      if (drag) {
        const origin = canvasOrigin();
        const cur: Pt = origin
          ? { x: p.clientX - origin.left, y: p.clientY - origin.top }
          : { x: p.clientX, y: p.clientY };
        if (drag.kind === 'move') {
          const w = ViewportController.canvasToWorld(p.clientX, p.clientY);
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
      if (drag) {
        drag.tx.commit();
        drag = null;
        useEditorStore.getState().setActiveGizmoAxis(null);
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
        drag = null;
        useEditorStore.getState().setActiveGizmoAxis(null);
      }
      Marquee.set(null);
      marquee = null;
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
