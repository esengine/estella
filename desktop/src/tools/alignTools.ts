// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  alignTools.ts
 * @brief Multi-selection align + distribute — the Figma/UMG layout-precision tools
 *        the viewport was missing. Every move lands through the ONE unified position
 *        door, `SceneCommands.setEntityWorldPos`, which routes a world point to a UINode
 *        inset (Absolute), a Transform position (world entity), or a no-op (a
 *        flex-flow node the layout owns) — so align is correct for every entity kind
 *        without special-casing here. One gesture = one undo step. Geometry is in the
 *        pure `alignMath` module.
 */
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { useSelection } from '@/store/selectionStore';
import { entityBoxCorners } from 'esengine';
import { pruneDescendants, isFlowUINode, isOrphanUINode } from './transformTools';
import { alignTargets, distributeTargets, type AlignBox, type AlignOp, type DistributeAxis } from './alignMath';
import type { EntityId } from '@/types';

/** One target of an align gesture: where it is, and the box it presents. Boxes are
 *  measured in the work plane's two axes as the SCREEN names them, so "left" and
 *  "top" mean what they say from any eye — head-on that is world x and y. */
interface AlignTarget {
  sid: EntityId;
  at: { x: number; y: number; z: number };
  box: AlignBox;
}

/** Positionable selection → each entity's box on the work plane. Excludes flex-flow /
 *  orphan UI nodes (setEntityWorldPos can't move them) and descendants of a selected
 *  ancestor (already carried by their parent's move). */
function collectBoxes(): AlignTarget[] {
  const ids = pruneDescendants([...useSelection.getState().selectedIds]).filter(
    (sid) => !isFlowUINode(sid) && !isOrphanUINode(sid),
  );
  const out: AlignTarget[] = [];
  for (const sid of ids) {
    const rt = SceneModel.runtimeFor(sid);
    if (rt == null) continue;
    const obb = ViewportController.entityBounds(rt) ?? ViewportController.uiEntityWorldOBB(rt);
    const at = rt != null ? ViewportController.getEntityWorldPos(rt) : null;
    if (!obb || !at) continue;
    const uv = entityBoxCorners(obb).map((c) => ViewportController.worldToPlanePoint(c));
    const us = uv.map((p) => p.u);
    const vs = uv.map((p) => p.v);
    const origin = ViewportController.worldToPlanePoint({ x: obb.cx, y: obb.cy, z: obb.cz });
    out.push({
      sid,
      at,
      box: {
        minX: Math.min(...us), maxX: Math.max(...us),
        minY: Math.min(...vs), maxY: Math.max(...vs),
        cx: origin.u, cy: origin.v,
      },
    });
  }
  return out;
}

function apply(targets: AlignTarget[], moved: Array<{ cx: number; cy: number }>, label: string): void {
  SceneCommands.beginGesture(label);
  try {
    targets.forEach((t, i) => {
      const p = ViewportController.planePointToWorld(t.at, moved[i].cx, moved[i].cy);
      SceneCommands.setEntityWorldPos(t.sid, p.x, p.y, p.z);
    });
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
