// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pure viewport geometry — OBB hit-testing (rotation-aware), rect overlap,
 *        quat→angle, and snapping. These back picking / marquee / gizmo math, so
 *        they're the unit-testable core of the viewport interaction layer.
 */
import { describe, it, expect } from 'vitest';
import {
  type OBB,
  quatAngleZ,
  obbCorners,
  rectsIntersect,
  screenAABB,
  snapTo,
  clamp,
  worldToLocal2D,
  axisIndicatorEnds,
  frustumPlaneCrossings,
} from '@/engine/viewportMath';
import { LayerOrder, layerOrderOf, rankPickCandidates, type PickCandidate } from 'esengine';

const box = (cx: number, cy: number, hw: number, hh: number, rot = 0): OBB => ({ cx, cy, hw, hh, rot });

describe('quatAngleZ', () => {
  it('reads the Z angle of a pure-Z quaternion', () => {
    const a = Math.PI / 3;
    const q = { w: Math.cos(a / 2), x: 0, y: 0, z: Math.sin(a / 2) };
    expect(quatAngleZ(q)).toBeCloseTo(a, 6);
  });
  it('identity quat is zero', () => {
    expect(quatAngleZ({ w: 1, x: 0, y: 0, z: 0 })).toBeCloseTo(0, 6);
  });
});

describe('obbCorners', () => {
  it('gives the four corners of an axis-aligned box', () => {
    const cs = obbCorners(box(5, 5, 2, 1));
    expect(cs).toEqual([
      [3, 4],
      [7, 4],
      [7, 6],
      [3, 6],
    ]);
  });
});

describe('rectsIntersect', () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  it('overlapping rects intersect', () => {
    expect(rectsIntersect(r, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
  it('disjoint rects do not', () => {
    expect(rectsIntersect(r, { x: 20, y: 0, w: 5, h: 5 })).toBe(false);
  });
  it('edge-touching counts as intersecting', () => {
    expect(rectsIntersect(r, { x: 10, y: 0, w: 5, h: 5 })).toBe(true);
  });
});

describe('screenAABB', () => {
  it('bounds a set of points', () => {
    expect(screenAABB([{ x: 1, y: 2 }, { x: 5, y: 1 }, { x: 3, y: 7 }])).toEqual({ x: 1, y: 1, w: 4, h: 6 });
  });
  it('returns null if any point failed to project', () => {
    expect(screenAABB([{ x: 1, y: 2 }, null])).toBeNull();
  });
});

describe('snapTo / clamp', () => {
  it('snaps to the nearest multiple', () => {
    expect(snapTo(17, 8)).toBe(16);
    expect(snapTo(20, 8)).toBe(24);
    expect(snapTo(13.4, 0)).toBe(13.4); // step <= 0 is a no-op
  });
  it('clamps to range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('worldToLocal2D', () => {
  it('identity frame passes the point through', () => {
    expect(worldToLocal2D(3, 4, { x: 0, y: 0, rot: 0, sx: 1, sy: 1 })).toEqual({ x: 3, y: 4 });
  });

  it('inverts translation', () => {
    expect(worldToLocal2D(13, 24, { x: 10, y: 20, rot: 0, sx: 1, sy: 1 })).toEqual({ x: 3, y: 4 });
  });

  it('round-trips the TRS compose (world = T + R·(S·local))', () => {
    const f = { x: 10, y: -5, rot: Math.PI / 3, sx: 2, sy: 0.5 };
    const local = { x: 3, y: -7 };
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    const wx = f.x + local.x * f.sx * c - local.y * f.sy * s;
    const wy = f.y + local.x * f.sx * s + local.y * f.sy * c;
    const back = worldToLocal2D(wx, wy, f);
    expect(back.x).toBeCloseTo(local.x, 9);
    expect(back.y).toBeCloseTo(local.y, 9);
  });

  it('a zero scale axis passes through undivided instead of exploding', () => {
    const p = worldToLocal2D(5, 6, { x: 0, y: 0, rot: 0, sx: 0, sy: 2 });
    expect(p.x).toBe(5);
    expect(p.y).toBe(3);
  });
});

describe('rankPickCandidates', () => {
  // Sprites listed near → far, so list order and depth order disagree on purpose.
  // This is the exact shape that used to select the sprite BEHIND the cursor.
  const cand = (entity: string, layer: number, z: number, index: number, ySort = 0, depth = 0, y = 0)
    : PickCandidate<string> => ({
    entity, index,
    rank: { layer, order: layerOrderOf(layer, ySort, depth), worldY: y, worldZ: z },
  });
  const DEPTH12 = (1 << 1) | (1 << 2);

  it('ranks the nearest first in a depth layer, whatever the list order', () => {
    const near = cand('near', 1, 150, 0, 0, DEPTH12);
    const mid = cand('mid', 1, 0, 1, 0, DEPTH12);
    const far = cand('far', 1, -150, 2, 0, DEPTH12);
    expect(rankPickCandidates([near, mid, far])).toEqual(['near', 'mid', 'far']);
    expect(rankPickCandidates([far, mid, near])).toEqual(['near', 'mid', 'far']);
  });

  // The depth buffer resolves per pixel, so it beats the sorting layer — the very
  // case the paired render check pins (near sprite in the LOWER layer wins).
  it('lets a nearer sprite in a LOWER depth layer win the click', () => {
    const near = cand('near', 1, 150, 0, 0, DEPTH12);
    const far = cand('far', 2, -150, 1, 0, DEPTH12);
    expect(rankPickCandidates([near, far])).toEqual(['near', 'far']);
  });

  // ... but only between two depth layers. A painter layer does not depth-test, so
  // it is simply painted later and covers what is under it.
  it('keeps the sorting layer in charge when a layer is not depth-resolved', () => {
    const nearDepth = cand('nearDepth', 1, 150, 0, 0, 1 << 1);
    const painterAbove = cand('painterAbove', 5, -900, 1);
    expect(rankPickCandidates([nearDepth, painterAbove])).toEqual(['painterAbove', 'nearDepth']);
  });

  it('ranks by z inside a plain painter layer too — the renderer sorts on it', () => {
    const near = cand('near', 1, 150, 0);
    const mid = cand('mid', 1, 0, 1);
    const far = cand('far', 1, -150, 2);
    expect(rankPickCandidates([far, near, mid])).toEqual(['near', 'mid', 'far']);
  });

  it('ranks lower world Y first in a y-sorted layer, ignoring z', () => {
    const top = cand('top', 1, 900, 0, 1 << 1, 0, 100);
    const bottom = cand('bottom', 1, -900, 1, 1 << 1, 0, -100);
    expect(rankPickCandidates([top, bottom])).toEqual(['bottom', 'top']);
  });

  it('falls back to later-drawn at equal depth, as paint order does', () => {
    expect(rankPickCandidates([cand('a', 0, 0, 0), cand('b', 0, 0, 1)])).toEqual(['b', 'a']);
  });

  it('leaves an empty hit list empty', () => {
    expect(rankPickCandidates([])).toEqual([]);
    expect(LayerOrder.Painter).toBe(0);
  });
});

describe('the view-axis indicator', () => {
  // Head-on: +Z is straight at the eye and every other end lies flat on screen.
  const headOn = {
    x: { dx: 1, dy: 0, depth: 0 },
    y: { dx: 0, dy: -1, depth: 0 },
    z: { dx: 0, dy: 0, depth: 1 },
  };

  it('places every end on its axis, both ways from the centre', () => {
    const at = Object.fromEntries(axisIndicatorEnds(headOn, 30).map((e) => [e.key, e]));
    expect([at['x+'].x, at['x+'].y]).toEqual([30, 0]);
    expect([at['x-'].x, at['x-'].y]).toEqual([-30, -0]);
    expect([at['y+'].x, at['y+'].y]).toEqual([0, -30]);
    expect([at['z+'].x, at['z+'].y]).toEqual([0, 0]);   // pointing at the eye, so no offset
    expect(at['z+'].depth).toBe(1);
    expect(at['z-'].depth).toBe(-1);
  });

  it('draws an axis leaning toward the eye shorter', () => {
    // A 60° turn: the same axis, foreshortened by cos — the cue that says how far
    // the view has turned. Normalizing the direction would erase it.
    const turned = { ...headOn, x: { dx: Math.cos(Math.PI / 3), dy: 0, depth: Math.sin(Math.PI / 3) } };
    const end = axisIndicatorEnds(turned, 30).find((e) => e.key === 'x+')!;
    expect(end.x).toBeCloseTo(15, 6);
  });

  it('orders the ends far to near, so a near knob covers a far one', () => {
    const keys = axisIndicatorEnds(headOn, 30).map((e) => e.key);
    expect(keys[0]).toBe('z-');
    expect(keys[keys.length - 1]).toBe('z+');
  });
});

describe('frustumPlaneCrossings', () => {
  /** Eight corners: near face bl, br, tr, tl at z = `nz`, the same square at `fz`. */
  const box = (nz: number, fz: number, half = 10): Float32Array => {
    const xy = [[-half, -half], [half, -half], [half, half], [-half, half]];
    return Float32Array.from([
      ...xy.flatMap(([x, y]) => [x!, y!, nz]),
      ...xy.flatMap(([x, y]) => [x!, y!, fz]),
    ]);
  };

  it('meets the plane halfway down an edge that spans it', () => {
    const pts = frustumPlaneCrossings(box(10, -10), 0);
    expect(pts.map((p) => p && [p.x, p.y])).toEqual([[-10, -10], [10, -10], [10, 10], [-10, 10]]);
  });

  it('interpolates x and y along the edge, not just z', () => {
    // A volume that widens with depth: at three quarters of the way down, the
    // crossing is three quarters of the way out.
    const c = Float32Array.from([
      -1, -1, 3, 1, -1, 3, 1, 1, 3, -1, 1, 3,
      -5, -5, -1, 5, -5, -1, 5, 5, -1, -5, 5, -1,
    ]);
    const pts = frustumPlaneCrossings(c, 0);
    expect(pts[0]!.x).toBeCloseTo(-4);
    expect(pts[0]!.y).toBeCloseTo(-4);
  });

  it('reports no crossing for edges that never reach the plane', () => {
    // Entirely in front of it, and lying parallel to it.
    expect(frustumPlaneCrossings(box(10, 1), 0)).toEqual([null, null, null, null]);
    expect(frustumPlaneCrossings(box(5, 5), 0)).toEqual([null, null, null, null]);
  });
});
