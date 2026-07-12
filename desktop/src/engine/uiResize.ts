// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  uiResize — the pure geometry→box-field math behind the viewport UI resize
 *        gizmo. Dragging one edge of a UINode is resolved in WORLD units, then
 *        written back to the node's own fields in its own units, so a resize keeps
 *        the CSS box model consistent across every anchor:
 *
 *        - Definite size (px/%): the dragged edge changes the size; the opposite
 *          edge stays put. A pinned inset on the dragged side tracks the moved edge.
 *        - Stretched (auto size + both insets pinned): the dragged edge moves its
 *          own inset, growing/shrinking the span.
 *        - Content-auto (no fixed extent): nothing to resize on that axis.
 *
 *        Kept unit-testable (pure numbers, no World/DOM) — the gizmo supplies the
 *        world geometry (edge delta, ppu, parent extent), this returns field writes.
 */
import { DimensionUnit, type Dimension } from 'esengine';

/** Which edge of the axis is being dragged (low = left/bottom, high = right/top). */
export type ResizeSide = 'low' | 'high';

export interface AxisResizeInput {
  /** Current size on this axis (width or height). */
  size: Dimension;
  /** Low-edge inset (insetLeft / insetBottom). */
  nearInset: Dimension;
  /** High-edge inset (insetRight / insetTop). */
  farInset: Dimension;
  side: ResizeSide;
  /** How far the dragged edge moved along the axis's + direction, in world units. */
  edgeDeltaWorld: number;
  /** Design px per world unit (Canvas pixelsPerUnit). */
  ppu: number;
  /** Parent's extent on this axis, in world units (for percent conversion). */
  parentExtentWorld: number;
}

export interface AxisResizeWrites {
  size?: Dimension;
  nearInset?: Dimension;
  farInset?: Dimension;
}

const isAuto = (d: Dimension) => d.unit === DimensionUnit.Auto;

/** A world-unit delta expressed in `unit`: px = design px (world × ppu); percent =
 *  fraction of the parent extent. */
function worldToUnit(worldDelta: number, unit: number, ppu: number, parentExtent: number): number {
  if (unit === DimensionUnit.Percent) return parentExtent > 0 ? (worldDelta / parentExtent) * 100 : 0;
  return worldDelta * ppu;
}

const shift = (d: Dimension, worldDelta: number, ppu: number, parent: number): Dimension => ({
  value: d.value + worldToUnit(worldDelta, d.unit, ppu, parent),
  unit: d.unit,
});

/** The field writes that resize one axis by moving one edge. Empty when the axis is
 *  content-auto (no fixed extent to change). */
export function resizeUINodeAxis(inp: AxisResizeInput): AxisResizeWrites {
  const { size, nearInset, farInset, side, edgeDeltaWorld, ppu, parentExtentWorld } = inp;
  const w: AxisResizeWrites = {};

  if (!isAuto(size)) {
    // The dragged edge grows/shrinks the size; the opposite edge is the fixed anchor.
    const sizeDelta = side === 'high' ? edgeDeltaWorld : -edgeDeltaWorld;
    const value = Math.max(0, size.value + worldToUnit(sizeDelta, size.unit, ppu, parentExtentWorld));
    w.size = { value, unit: size.unit };
    // A pinned inset on the dragged side must follow the moved edge, else the box
    // shifts instead of resizing.
    if (side === 'high' && !isAuto(farInset)) w.farInset = shift(farInset, -edgeDeltaWorld, ppu, parentExtentWorld);
    if (side === 'low' && !isAuto(nearInset)) w.nearInset = shift(nearInset, edgeDeltaWorld, ppu, parentExtentWorld);
    return w;
  }

  if (!isAuto(nearInset) && !isAuto(farInset)) {
    // Stretched: the dragged edge moves its own inset (the high edge sits at
    // parentExtent − farInset, so moving it +Δ means farInset −Δ).
    if (side === 'high') w.farInset = shift(farInset, -edgeDeltaWorld, ppu, parentExtentWorld);
    else w.nearInset = shift(nearInset, edgeDeltaWorld, ppu, parentExtentWorld);
  }
  return w;
}
