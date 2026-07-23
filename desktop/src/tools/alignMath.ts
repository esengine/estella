// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  alignMath.ts
 * @brief Pure world-space (y-up) geometry for multi-selection align + distribute —
 *        no engine / DOM coupling, so it unit-tests in isolation. The imperative
 *        shell (alignTools) reads the live selection's boxes and applies these
 *        targets through SceneCommands.
 */

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';
export type DistributeAxis = 'h' | 'v';

/** A selected entity's world AABB — edges, and the transform origin the move writes. */
export interface AlignBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Transform origin (NOT the AABB center — a rotated/offset box's origin differs). */
  cx: number;
  cy: number;
}

/** Target transform origin per box for an align op (world y-up: top = maxY). */
export function alignTargets(boxes: AlignBox[], op: AlignOp): Array<{ cx: number; cy: number }> {
  const minX = Math.min(...boxes.map((b) => b.minX));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  const unionCx = (minX + maxX) / 2;
  const unionCy = (minY + maxY) / 2;
  return boxes.map((b) => {
    switch (op) {
      case 'left': return { cx: b.cx + (minX - b.minX), cy: b.cy };
      case 'right': return { cx: b.cx + (maxX - b.maxX), cy: b.cy };
      case 'hcenter': return { cx: unionCx, cy: b.cy };
      case 'top': return { cx: b.cx, cy: b.cy + (maxY - b.maxY) };
      case 'bottom': return { cx: b.cx, cy: b.cy + (minY - b.minY) };
      case 'vmiddle': return { cx: b.cx, cy: unionCy };
    }
  });
}

/** Target transform origin per box for equal edge-gap distribution. The two extreme
 *  boxes stay put and define the span; the interior boxes are spread so the gaps
 *  between adjacent edges are equal (Figma "distribute spacing"). Returned in input
 *  order (< 3 boxes is a no-op → each box keeps its own origin). */
export function distributeTargets(boxes: AlignBox[], axis: DistributeAxis): Array<{ cx: number; cy: number }> {
  const targets = boxes.map((b) => ({ cx: b.cx, cy: b.cy }));
  const n = boxes.length;
  if (n < 3) return targets;
  const order = boxes.map((_, i) => i);
  if (axis === 'h') {
    order.sort((a, b) => boxes[a].minX - boxes[b].minX);
    const span = boxes[order[n - 1]].maxX - boxes[order[0]].minX;
    const sumW = boxes.reduce((s, b) => s + (b.maxX - b.minX), 0);
    const gap = (span - sumW) / (n - 1);
    let cursor = boxes[order[0]].minX;
    for (const i of order) {
      targets[i] = { cx: boxes[i].cx + (cursor - boxes[i].minX), cy: boxes[i].cy };
      cursor += (boxes[i].maxX - boxes[i].minX) + gap;
    }
  } else {
    order.sort((a, b) => boxes[a].minY - boxes[b].minY);
    const span = boxes[order[n - 1]].maxY - boxes[order[0]].minY;
    const sumH = boxes.reduce((s, b) => s + (b.maxY - b.minY), 0);
    const gap = (span - sumH) / (n - 1);
    let cursor = boxes[order[0]].minY;
    for (const i of order) {
      targets[i] = { cx: boxes[i].cx, cy: boxes[i].cy + (cursor - boxes[i].minY) };
      cursor += (boxes[i].maxY - boxes[i].minY) + gap;
    }
  }
  return targets;
}
