// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The transform tool's pointer decision tree (the imperative shell over the
 *        pure gizmo math): gizmo-handle drag → axis-constrained group transform;
 *        entity pick → select (Shift toggles) + move; empty → marquee box-select.
 *        Engine access is mocked, so this asserts the wiring, not GL geometry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GIZMO } from '@/tools/gizmo';

// Shared mutable test state the module mocks read (hoisted above the vi.mock calls).
const h = vi.hoisted(() => ({
  pick: { entity: null as number | null, rect: [] as number[], stack: undefined as number[] | undefined },
  pos: new Map<number, { x: number; y: number }>(),
  locked: new Set<number>(),
  calls: { setXY: [] as Array<[number, number, number]>, dup: [] as number[], commit: 0, abort: 0 },
}));

vi.mock('@/engine/EngineHost', () => ({
  EngineHost: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } },
}));
vi.mock('@/engine/ViewportController', () => ({
  ViewportController: {
    canvasToWorld: (x: number, y: number) => ({ x, y }), // identity: world == client px
    // Head-on: the rings the rotate tool aims at reduce to the single Z one, and
    // the arrows to X and Y — world Z projects to nothing.
    viewAxes: () => ({ x: { dx: 1, dy: 0, depth: 0 }, y: { dx: 0, dy: -1, depth: 0 }, z: { dx: 0, dy: 0, depth: 1 } }),
    // Flat scene: every plane is z = 0, which is what the orthographic editor
    // answers anyway — the drag plane must not change these expectations.
    entityPlaneZ: () => 0,
    // The identity above, on the plane the handle chose: head-on that is the z
    // plane, so a drag reads the same world units it always did.
    canvasToWorldOnPlane: (x: number, y: number) => ({ x, y, z: 0 }),
    worldToClient: (x: number, y: number) => ({ x, y }),
    getEntityWorldXY: (rt: number) => h.pos.get(rt) ?? { x: 0, y: 0 },
    getEntityWorldAngleRad: () => 0,
    getEntityWorldQuat: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    pickEntity: () => h.pick.entity,
    pickEntitiesAt: () => (h.pick.stack ?? (h.pick.entity != null ? [h.pick.entity] : [])),
    pickInRect: () => h.pick.rect,
  },
}));
vi.mock('@/engine/SceneCommands', () => ({
  SceneCommands: {
    transaction: () => ({ commit: () => { h.calls.commit += 1; }, abort: () => { h.calls.abort += 1; } }),
    setEntityXY: (sid: number, x: number, y: number) => { h.calls.setXY.push([sid, x, y]); },
    setField: () => {},
    duplicateEntity: (sid: number) => { const n = sid + 100; h.calls.dup.push(n); return n; },
  },
}));
vi.mock('@/engine/SceneQuery', () => ({
  SceneQuery: {
    getFieldValue: (_s: number, _c: string, k: string) => (k === 'rotation' ? 0 : k === 'scale' ? [1, 1, 1] : undefined),
  },
}));
vi.mock('@/engine/SceneModel', () => ({
  SceneModel: {
    runtimeFor: (s: number) => s,
    sourceFor: (r: number) => r,
    entityBySource: () => undefined, // no hierarchy in these tests
    isEditable: (s: number) => !h.locked.has(s),
    subscribe: () => {},
  },
}));

import { TRANSFORM_TOOLS, selectionPivot } from '@/tools/transformTools';
import { Marquee } from '@/tools/marquee';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';

const ctx = { capture: vi.fn(), release: vi.fn() };
const ev = (x: number, y: number, mod: Partial<{ shift: boolean; alt: boolean }> = {}) => ({
  clientX: x, clientY: y, pointerId: 1, button: 0, shift: !!mod.shift, alt: !!mod.alt,
});

beforeEach(() => {
  h.pick.entity = null;
  h.pick.rect = [];
  h.pick.stack = undefined;
  h.pos.clear();
  h.locked.clear();
  h.calls.setXY = [];
  h.calls.dup = [];
  h.calls.commit = 0;
  h.calls.abort = 0;
  useSelection.getState().select(null);
  useEditorStore.setState({ tool: 'move', showGizmos: true, snapping: false });
  Marquee.set(null);
});

describe('empty space → marquee box-select', () => {
  it('drags a box and selects what it covers', () => {
    h.pick.entity = null;
    h.pick.rect = [5, 6];
    const t = TRANSFORM_TOOLS.select;
    expect(t.onPointerDown(ev(10, 10), ctx)).toBe(true);
    t.onPointerMove(ev(60, 70), ctx);
    expect(Marquee.get()).toEqual({ x: 10, y: 10, w: 50, h: 60 });
    t.onPointerUp(ev(60, 70), ctx);
    expect([...useSelection.getState().selectedIds].sort()).toEqual([5, 6]);
    expect(Marquee.get()).toBeNull();
  });

  it('a bare click on empty space clears the selection', () => {
    useSelection.getState().select(9);
    h.pick.entity = null;
    const t = TRANSFORM_TOOLS.select;
    t.onPointerDown(ev(10, 10), ctx);
    t.onPointerUp(ev(10, 10), ctx); // no movement
    expect(useSelection.getState().selectedId).toBeNull();
  });
});

describe('entity pick → select + move', () => {
  it('selects the clicked entity, and the SELECT tool moves it by the world delta', () => {
    h.pick.entity = 7;
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.select;
    expect(t.onPointerDown(ev(100, 100), ctx)).toBe(true);
    expect(useSelection.getState().selectedId).toBe(7);
    t.onPointerMove(ev(130, 100), ctx); // +30 in x, past the slop
    t.onPointerUp(ev(130, 100), ctx);
    expect(h.calls.setXY.at(-1)).toEqual([7, 130, 100]);
    expect(h.calls.commit).toBe(1);
  });

  it('a transform tool selects on a body press but does not transform', () => {
    // The gizmo handles say which axis you meant; the body says nothing. Dragging
    // it used to transform freely, so any click that wobbled nudged the thing you
    // were only trying to pick.
    h.pick.entity = 7;
    h.pos.set(7, { x: 100, y: 100 });
    for (const mode of ['move', 'rotate', 'scale'] as const) {
      h.calls.setXY = [];
      useSelection.getState().select(null);
      const t = TRANSFORM_TOOLS[mode];
      expect(t.onPointerDown(ev(100, 100), ctx)).toBe(true);
      expect(useSelection.getState().selectedId).toBe(7);
      t.onPointerMove(ev(160, 140), ctx); // well past the slop
      t.onPointerUp(ev(160, 140), ctx);
      expect(h.calls.setXY).toEqual([]);
    }
  });

  it('the select tool does not nudge on a click that only wobbles', () => {
    h.pick.entity = 7;
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.select;
    t.onPointerDown(ev(100, 100), ctx);
    t.onPointerMove(ev(102, 101), ctx); // inside the click slop
    t.onPointerUp(ev(102, 101), ctx);
    expect(h.calls.setXY).toEqual([]);
  });

  it('Shift-click toggles selection without starting a drag', () => {
    useSelection.getState().select(7);
    h.pick.entity = 9;
    const t = TRANSFORM_TOOLS.move;
    expect(t.onPointerDown(ev(50, 50, { shift: true }), ctx)).toBe(false);
    expect([...useSelection.getState().selectedIds].sort()).toEqual([7, 9]);
  });

  it('Alt-drag duplicates on the first move and moves the copy', () => {
    h.pick.entity = 7;
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.select;
    t.onPointerDown(ev(100, 100, { alt: true }), ctx);
    expect(h.calls.dup).toEqual([]); // deferred — no clone until the drag actually moves
    t.onPointerMove(ev(140, 100), ctx); // past the slop → clone NOW, retarget onto the copy
    expect(h.calls.dup).toEqual([107]); // copy id = original + 100 (mock)
    expect(useSelection.getState().selectedId).toBe(107);
    t.onPointerUp(ev(140, 100), ctx);
    expect(h.calls.setXY.at(-1)).toEqual([107, 140, 100]); // copy tracks the cursor from the original's start
  });

  it('Alt rides the gizmo handle, now that the body does not transform', () => {
    useSelection.getState().select(7);
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.move;
    // Grab the x arrow: the pivot is the entity, world == client px in this harness.
    t.onPointerDown(ev(100 + GIZMO.axisLen - 5, 100, { alt: true }), ctx);
    expect(h.calls.dup).toEqual([]); // still deferred
    t.onPointerMove(ev(100 + GIZMO.axisLen + 40, 100), ctx);
    expect(h.calls.dup).toEqual([107]);
    t.onPointerUp(ev(100 + GIZMO.axisLen + 40, 100), ctx);
  });

  it('a bare Alt-click leaves no duplicate (no drag past the slop)', () => {
    h.pick.entity = 7;
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.select;
    t.onPointerDown(ev(100, 100, { alt: true }), ctx);
    t.onPointerUp(ev(100, 100), ctx); // released in place — never a drag
    expect(h.calls.dup).toEqual([]); // the old bug stacked a copy on the original here
  });

  it('repeated clicks at the same spot cycle through the overlapping stack', () => {
    h.pick.stack = [7, 8, 9]; // topmost-first, all under (100,100)
    for (const id of [7, 8, 9]) h.pos.set(id, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.select;
    const click = () => {
      t.onPointerDown(ev(100, 100), ctx);
      t.onPointerUp(ev(100, 100), ctx);
      return useSelection.getState().selectedId;
    };
    expect([click(), click(), click(), click()]).toEqual([7, 8, 9, 7]);
  });

  it('a drag grabs the selected object instead of cycling', () => {
    h.pick.stack = [7, 8];
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.move;
    t.onPointerDown(ev(100, 100), ctx);
    t.onPointerUp(ev(100, 100), ctx); // click 1 → 7
    t.onPointerDown(ev(100, 100), ctx);
    t.onPointerMove(ev(140, 100), ctx); // drag past the slop
    t.onPointerUp(ev(140, 100), ctx);
    expect(useSelection.getState().selectedId).toBe(7); // stayed on 7, moved it
    expect(h.calls.setXY.at(-1)).toEqual([7, 140, 100]);
  });
});

describe('gizmo handle → axis-constrained group transform', () => {
  it('the X handle moves only in X', () => {
    useSelection.getState().select(7);
    h.pos.set(7, { x: 200, y: 200 });
    const t = TRANSFORM_TOOLS.move;
    // Pivot at (200,200); the X handle sits one axis-length to the right.
    const downX = 200 + GIZMO.axisLen - 4;
    expect(t.onPointerDown(ev(downX, 200), ctx)).toBe(true);
    t.onPointerMove(ev(downX + 40, 240), ctx); // drag +40x, +40y
    t.onPointerUp(ev(downX + 40, 240), ctx);
    // y is constrained out: entity moves +40 in x, 0 in y.
    expect(h.calls.setXY.at(-1)).toEqual([7, 240, 200]);
    // Selection unchanged — a gizmo drag never re-picks.
    expect(useSelection.getState().selectedId).toBe(7);
  });

  it('the center plane moves freely in both axes', () => {
    useSelection.getState().select(7);
    h.pos.set(7, { x: 200, y: 200 });
    const t = TRANSFORM_TOOLS.move;
    expect(t.onPointerDown(ev(200, 200), ctx)).toBe(true); // cursor on the pivot = plane handle
    t.onPointerMove(ev(225, 215), ctx);
    t.onPointerUp(ev(225, 215), ctx);
    expect(h.calls.setXY.at(-1)).toEqual([7, 225, 215]);
  });
});

describe('locked entities are not transformed by the viewport', () => {
  // Picking already refuses a locked entity, but the OUTLINER selects one happily —
  // and until selectionPivot answered for the editable subset, the gizmo that
  // appeared for it dragged like any other, so a lock stopped the click and nothing
  // else. This is the whole of what a lock does to a gesture.
  it('a locked selection has no gizmo pivot, so the drag writes nothing and marquees', () => {
    useSelection.getState().select(7);
    h.pos.set(7, { x: 200, y: 200 });
    h.locked.add(7);
    expect(selectionPivot([7])).toBeNull(); // no pivot → the viewport draws no gizmo
    const t = TRANSFORM_TOOLS.move;
    const downX = 200 + GIZMO.axisLen - 4;
    t.onPointerDown(ev(downX, 200), ctx);
    t.onPointerMove(ev(downX + 40, 240), ctx);
    // No handle and (picking already refuses it) no body: the spot is empty space,
    // so the gesture is a box-select — the same thing it is over bare grid.
    expect(Marquee.get()).not.toBeNull();
    t.onPointerUp(ev(downX + 40, 240), ctx);
    expect(h.calls.setXY).toEqual([]);
  });

  it('a mixed selection transforms only its unlocked members', () => {
    useSelection.getState().selectMany([7, 8], 7);
    h.pos.set(7, { x: 200, y: 200 });
    h.pos.set(8, { x: 200, y: 200 });
    h.locked.add(8);
    const t = TRANSFORM_TOOLS.move;
    const downX = 200 + GIZMO.axisLen - 4;
    expect(t.onPointerDown(ev(downX, 200), ctx)).toBe(true); // 7 still has handles
    t.onPointerMove(ev(downX + 40, 200), ctx);
    t.onPointerUp(ev(downX + 40, 200), ctx);
    expect(h.calls.setXY.map(([id]) => id)).toEqual([7]);
  });

  it('unlocking restores the pivot', () => {
    h.pos.set(7, { x: 200, y: 200 });
    h.locked.add(7);
    expect(selectionPivot([7])).toBeNull();
    h.locked.delete(7);
    expect(selectionPivot([7])).toEqual({ x: 200, y: 200 });
  });
});
