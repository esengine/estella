// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The pure resize-gizmo math (uiResize.resizeUINodeAxis): moving one edge
 *        of a UINode maps to size / inset field writes that keep the CSS box model
 *        consistent across every anchor and unit.
 */
import { describe, it, expect } from 'vitest';
import { DimensionUnit } from 'esengine';
import { resizeUINodeAxis, type AxisResizeInput } from '@/engine/uiResize';

const px = (v: number) => ({ value: v, unit: DimensionUnit.Px });
const pct = (v: number) => ({ value: v, unit: DimensionUnit.Percent });
const auto = () => ({ value: 0, unit: DimensionUnit.Auto });

// ppu 1, parent extent 1000 world → percent delta = worldΔ / 10.
const base = (over: Partial<AxisResizeInput>): AxisResizeInput => ({
  size: px(100), nearInset: auto(), farInset: auto(),
  side: 'high', edgeDeltaWorld: 0, ppu: 1, parentExtentWorld: 1000,
  ...over,
});

describe('resizeUINodeAxis', () => {
  it('grows a px box from the far edge (near edge fixed)', () => {
    const w = resizeUINodeAxis(base({ size: px(100), nearInset: px(0), side: 'high', edgeDeltaWorld: 50 }));
    expect(w.size).toEqual(px(150));
    expect(w.nearInset).toBeUndefined();
    expect(w.farInset).toBeUndefined();
  });

  it('shrinks a px box from the near edge and tracks the pinned near inset (far edge fixed)', () => {
    const w = resizeUINodeAxis(base({ size: px(100), nearInset: px(20), side: 'low', edgeDeltaWorld: 30 }));
    expect(w.size).toEqual(px(70)); // 100 - 30
    expect(w.nearInset).toEqual(px(50)); // 20 + 30 → left edge in by 30, right stays
  });

  it('end-anchored: dragging the far edge grows the size and follows the pinned far inset', () => {
    const w = resizeUINodeAxis(base({ size: px(100), nearInset: auto(), farInset: px(10), side: 'high', edgeDeltaWorld: 40 }));
    expect(w.size).toEqual(px(140));
    expect(w.farInset).toEqual(px(-30)); // 10 - 40 → right edge out by 40, left stays
  });

  it('end-anchored: dragging the near edge only changes size (near inset is auto)', () => {
    const w = resizeUINodeAxis(base({ size: px(100), nearInset: auto(), farInset: px(10), side: 'low', edgeDeltaWorld: 25 }));
    expect(w.size).toEqual(px(75));
    expect(w.nearInset).toBeUndefined();
    expect(w.farInset).toBeUndefined();
  });

  it('is unit-aware: a percent-sized box resizes in percent of the parent', () => {
    const w = resizeUINodeAxis(base({ size: pct(40), nearInset: px(0), side: 'high', edgeDeltaWorld: 50 }));
    expect(w.size).toEqual(pct(45)); // +50 world / 1000 * 100 = +5%
  });

  it('centered box (both insets/margins auto): resize changes only the size', () => {
    const hi = resizeUINodeAxis(base({ size: px(100), nearInset: auto(), farInset: auto(), side: 'high', edgeDeltaWorld: 40 }));
    expect(hi.size).toEqual(px(140));
    expect(hi.nearInset).toBeUndefined();
    expect(hi.farInset).toBeUndefined();
    const lo = resizeUINodeAxis(base({ size: px(100), side: 'low', edgeDeltaWorld: 40 }));
    expect(lo.size).toEqual(px(60));
  });

  it('stretched (auto size, both insets pinned): the dragged edge moves its own inset', () => {
    const hi = resizeUINodeAxis(base({ size: auto(), nearInset: px(0), farInset: px(0), side: 'high', edgeDeltaWorld: 20 }));
    expect(hi.farInset).toEqual(px(-20));
    expect(hi.size).toBeUndefined();
    const lo = resizeUINodeAxis(base({ size: auto(), nearInset: px(0), farInset: px(0), side: 'low', edgeDeltaWorld: 20 }));
    expect(lo.nearInset).toEqual(px(20));
    expect(lo.size).toBeUndefined();
  });

  it('content-auto (auto size, no pinned insets): nothing to resize', () => {
    const w = resizeUINodeAxis(base({ size: auto(), nearInset: auto(), farInset: auto(), side: 'high', edgeDeltaWorld: 50 }));
    expect(w).toEqual({});
  });

  it('never produces a negative size', () => {
    const w = resizeUINodeAxis(base({ size: px(20), nearInset: px(0), side: 'low', edgeDeltaWorld: 999 }));
    expect(w.size).toEqual(px(0));
  });
});
