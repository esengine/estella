// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  layer-order.test.ts — the JS mirror of DrawList::layerOrder.
 *
 * These pin the two things a mirror can get wrong and look fine: the precedence
 * when a layer declares both masks, and which DIRECTION counts as "in front".
 * A frontness with the sign flipped ranks a pick exactly backwards, and every
 * individual answer still looks plausible.
 */
import { describe, it, expect } from 'vitest';
import { LayerOrder, layerOrderOf, layerFrontness, compareDrawRank } from '../src/render/layerOrder';

describe('layerOrderOf', () => {
  it('is painter order when neither mask claims the layer', () => {
    expect(layerOrderOf(0, 0, 0)).toBe(LayerOrder.Painter);
    expect(layerOrderOf(5, 1 << 4, 1 << 6)).toBe(LayerOrder.Painter);
  });

  it('reads the bit for the layer, not the layer number', () => {
    expect(layerOrderOf(3, 1 << 3, 0)).toBe(LayerOrder.YSort);
    expect(layerOrderOf(3, 0, 1 << 3)).toBe(LayerOrder.Depth);
    expect(layerOrderOf(31, 0, 1 << 31 >>> 0)).toBe(LayerOrder.Depth);
  });

  // The engine resolves the contradiction one way and the editor has to resolve
  // it the same way, or a doubly-declared layer picks against what it drew.
  it('gives y-sort precedence when a layer declares both', () => {
    expect(layerOrderOf(2, 1 << 2, 1 << 2)).toBe(LayerOrder.YSort);
  });

  it('treats layers outside 0..31 as painter-ordered', () => {
    expect(layerOrderOf(-1, 0xffffffff, 0xffffffff)).toBe(LayerOrder.Painter);
    expect(layerOrderOf(32, 0xffffffff, 0xffffffff)).toBe(LayerOrder.Painter);
    expect(layerOrderOf(1e6, 0xffffffff, 0xffffffff)).toBe(LayerOrder.Painter);
  });
});

describe('layerFrontness', () => {
  // Camera looks down -z, so larger z is nearer — the same statement the engine's
  // sort key makes when it orders the transparent stage back-to-front.
  it('ranks larger z in front for painter and depth layers', () => {
    for (const order of [LayerOrder.Painter, LayerOrder.Depth]) {
      expect(layerFrontness(order, 0, 150)).toBeGreaterThan(layerFrontness(order, 0, -150));
      expect(layerFrontness(order, 999, 5)).toBe(5); // y is not consulted
    }
  });

  // Y-up world, top-down game: lower on screen is nearer the viewer.
  it('ranks lower world Y in front for y-sorted layers', () => {
    expect(layerFrontness(LayerOrder.YSort, -100, 0))
      .toBeGreaterThan(layerFrontness(LayerOrder.YSort, 100, 0));
    expect(layerFrontness(LayerOrder.YSort, 10, 999)).toBe(-10); // z is not consulted
  });
});

describe('compareDrawRank', () => {
  const rank = (layer: number, order: LayerOrder, worldZ = 0, worldY = 0) =>
    ({ layer, order, worldY, worldZ });

  it('gives the higher sorting layer the front, as paint order does', () => {
    expect(compareDrawRank(rank(5, LayerOrder.Painter), rank(1, LayerOrder.Painter))).toBeGreaterThan(0);
    expect(compareDrawRank(rank(0, LayerOrder.YSort), rank(3, LayerOrder.YSort))).toBeLessThan(0);
  });

  // The 2.5D claim itself: a depth layer resolves per pixel, so a nearer opaque
  // draw occludes what a LATER layer puts over it. Ranking these by layer would
  // name the sprite the depth buffer just rejected.
  it('lets depth beat the sorting layer — but only between two depth layers', () => {
    const nearLow = rank(1, LayerOrder.Depth, 150);
    const farHigh = rank(2, LayerOrder.Depth, -150);
    expect(compareDrawRank(nearLow, farHigh)).toBeGreaterThan(0);

    // One side painter-ordered: no depth test happens, so the later layer covers.
    expect(compareDrawRank(rank(1, LayerOrder.Depth, 150), rank(2, LayerOrder.Painter, -900)))
      .toBeLessThan(0);
  });

  it('falls back to the layer rule inside one layer', () => {
    expect(compareDrawRank(rank(1, LayerOrder.Painter, 10), rank(1, LayerOrder.Painter, -10)))
      .toBeGreaterThan(0);
    expect(compareDrawRank(rank(1, LayerOrder.YSort, 0, -50), rank(1, LayerOrder.YSort, 0, 50)))
      .toBeGreaterThan(0);
  });

  it('is antisymmetric, so a sort cannot depend on the input order', () => {
    const a = rank(2, LayerOrder.Depth, 40);
    const b = rank(7, LayerOrder.Depth, -40);
    expect(Math.sign(compareDrawRank(a, b))).toBe(-Math.sign(compareDrawRank(b, a)));
    expect(compareDrawRank(a, a)).toBe(0);
  });
});
