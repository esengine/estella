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
import {
  LayerOrder, layerOrderOf, layerFrontness, compareDrawRank, sortingIdentity,
} from '../src/render/layerOrder';

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
  const rank = (layer: number, order: LayerOrder, worldZ = 0, worldY = 0, orderInLayer = 0) =>
    ({ layer, order, worldY, worldZ, orderInLayer });

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

  // Each of these is a case the layer's own rule gets wrong on purpose, so what is
  // measured is Sprite.order overriding it — the thing the sort key does one field
  // below the layer. A pick that skipped this selects the sprite underneath.
  it('lets a stated order override the rule that would have decided', () => {
    // Painter: the farther sprite is told to sit on top.
    expect(compareDrawRank(rank(1, LayerOrder.Painter, -10, 0, 1),
                           rank(1, LayerOrder.Painter, 10))).toBeGreaterThan(0);
    // Y-sort: the one further back is told to sit on top. This layer had no other
    // override at all — z never reaches a y-sorted key.
    expect(compareDrawRank(rank(1, LayerOrder.YSort, 0, 50, 1),
                           rank(1, LayerOrder.YSort, 0, -50))).toBeGreaterThan(0);
  });

  it('leaves the rule in charge where no order was stated', () => {
    expect(compareDrawRank(rank(1, LayerOrder.YSort, 0, -50, 5),
                           rank(1, LayerOrder.YSort, 0, 50, 5))).toBeGreaterThan(0);
  });

  it('keeps an order inside its own layer', () => {
    expect(compareDrawRank(rank(1, LayerOrder.Painter, 0, 0, 127),
                           rank(2, LayerOrder.Painter, 0, 0, -128))).toBeLessThan(0);
  });

  // Biased and clamped like the engine's key: -1 sinks below an unstated 0, and two
  // orders past the range compare EQUAL because the frame drew them equal.
  it('mirrors the key’s sign and its clamp', () => {
    expect(compareDrawRank(rank(1, LayerOrder.Painter, 0, 0, -1),
                           rank(1, LayerOrder.Painter))).toBeLessThan(0);
    expect(compareDrawRank(rank(1, LayerOrder.Painter, 0, 0, 200),
                           rank(1, LayerOrder.Painter, 0, 0, 300))).toBe(0);
  });
});

/**
 * A group's whole claim is that nothing outside it lands between its members. That is
 * the property to pin — not "a group sorts" — because every wrong resolution here still
 * orders the members correctly among themselves and only fails against an outsider.
 */
describe('sortingIdentity', () => {
  const rank = (id: ReturnType<typeof sortingIdentity>, worldZ = 0) => ({
    layer: id.layer,
    order: LayerOrder.Painter,
    orderInLayer: id.orderInLayer,
    groupInner: id.groupInner,
    worldY: 0,
    worldZ,
  });

  it('leaves an ungrouped draw stating its own layer and order', () => {
    const id = sortingIdentity([], 3, 7);
    expect(id).toEqual({ layer: 3, orderInLayer: 7, groupInner: null });
  });

  it('hands the group the outward identity and the member the inner one', () => {
    const id = sortingIdentity([{ layer: 5, order: 2 }], 3, 7);
    expect(id).toEqual({ layer: 5, orderInLayer: 2, groupInner: 7 });
  });

  it('keeps an outsider from landing between two members', () => {
    const group = [{ layer: 5, order: 2 }];
    const low = rank(sortingIdentity(group, 0, -100));
    const high = rank(sortingIdentity(group, 0, 100));
    const above = rank(sortingIdentity([], 5, 3));
    const below = rank(sortingIdentity([], 5, 1));
    expect(compareDrawRank(low, high)).toBeLessThan(0);
    expect(compareDrawRank(below, low)).toBeLessThan(0);
    expect(compareDrawRank(high, above)).toBeLessThan(0);
  });

  // The engine's nesting rule: the FIRST nesting decides the block and deeper ones
  // join it, so a sub-assembly cannot be split around a sibling of the block it is in.
  it('gives a nested group one block order, whatever the member states', () => {
    const nested = [{ layer: 5, order: 2 }, { layer: 9, order: 4 }];
    expect(sortingIdentity(nested, 0, 99).groupInner).toBe(4);
    expect(sortingIdentity(nested, 0, -99).groupInner).toBe(4);
  });

  it('reads the outermost group for the layer, however deep the nesting', () => {
    const nested = [{ layer: 5, order: 2 }, { layer: 9, order: 4 }, { layer: 1, order: 6 }];
    const id = sortingIdentity(nested, 0, 0);
    expect(id.layer).toBe(5);
    expect(id.orderInLayer).toBe(2);
  });

  // Members separate by their stated place BEFORE the layer's rule gets a say —
  // mirroring the key, where the member field sits directly under stage.
  it('ranks a member above a nearer sibling it was stated above', () => {
    const group = [{ layer: 5, order: 0 }];
    const front = rank(sortingIdentity(group, 0, 0), 1000);
    const stated = rank(sortingIdentity(group, 0, 1), -1000);
    expect(compareDrawRank(front, stated)).toBeLessThan(0);
  });
});
