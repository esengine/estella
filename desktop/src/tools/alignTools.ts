// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  alignTools.ts
 * @brief Multi-selection align + distribute — the Figma/UMG layout-precision tools
 *        the viewport was missing. Every move lands through the ONE unified position
 *        door, `SceneCommands.setEntityXY`, which routes a world point to a UINode
 *        inset (Absolute), a Transform position (world entity), or a no-op (a
 *        flex-flow node the layout owns) — so align is correct for every entity kind
 *        without special-casing here. One gesture = one undo step. Geometry is in the
 *        pure `alignMath` module.
 */
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { useSelection } from '@/store/selectionStore';
import { obbCorners } from '@/engine/viewportMath';
import { pruneDescendants, isFlowUINode, isOrphanUINode } from './transformTools';
import { alignTargets, distributeTargets, type AlignBox, type AlignOp, type DistributeAxis } from './alignMath';
import type { EntityId } from '@/types';

/** Positionable selection → each entity's world AABB. Excludes flex-flow / orphan
 *  UI nodes (setEntityXY can't move them) and descendants of a selected ancestor
 *  (already carried by their parent's move). */
function collectBoxes(): Array<{ sid: EntityId; box: AlignBox }> {
  const ids = pruneDescendants([...useSelection.getState().selectedIds]).filter(
    (sid) => !isFlowUINode(sid) && !isOrphanUINode(sid),
  );
  const out: Array<{ sid: EntityId; box: AlignBox }> = [];
  for (const sid of ids) {
    const rt = SceneModel.runtimeFor(sid);
    if (rt == null) continue;
    const obb = ViewportController.entityBounds(rt) ?? ViewportController.uiEntityWorldOBB(rt);
    if (!obb) continue;
    const corners = obbCorners(obb);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    out.push({
      sid,
      box: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), cx: obb.cx, cy: obb.cy },
    });
  }
  return out;
}

function apply(boxes: Array<{ sid: EntityId; box: AlignBox }>, targets: Array<{ cx: number; cy: number }>, label: string): void {
  SceneCommands.beginGesture(label);
  try {
    boxes.forEach((b, i) => SceneCommands.setEntityXY(b.sid, targets[i].cx, targets[i].cy));
  } finally {
    SceneCommands.endGesture();
  }
}

/** Align the current multi-selection. No-op below two positionable entities. */
export function alignSelection(op: AlignOp): void {
  const boxes = collectBoxes();
  if (boxes.length < 2) return;
  apply(boxes, alignTargets(boxes.map((b) => b.box), op), `Align ${op}`);
}

/** Distribute the current multi-selection. No-op below three positionable entities. */
export function distributeSelection(axis: DistributeAxis): void {
  const boxes = collectBoxes();
  if (boxes.length < 3) return;
  apply(boxes, distributeTargets(boxes.map((b) => b.box), axis), `Distribute ${axis}`);
}
