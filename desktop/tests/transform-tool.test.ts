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
  pick: { entity: null as number | null, rect: [] as number[] },
  pos: new Map<number, { x: number; y: number }>(),
  calls: { setXY: [] as Array<[number, number, number]>, dup: [] as number[], commit: 0, abort: 0 },
}));

vi.mock('@/engine/EngineHost', () => ({
  EngineHost: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } },
}));
vi.mock('@/engine/ViewportController', () => ({
  ViewportController: {
    canvasToWorld: (x: number, y: number) => ({ x, y }), // identity: world == client px
    worldToClient: (x: number, y: number) => ({ x, y }),
    getEntityXY: (rt: number) => h.pos.get(rt) ?? { x: 0, y: 0 },
    pickEntity: () => h.pick.entity,
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
  SceneModel: { runtimeFor: (s: number) => s, sourceFor: (r: number) => r, subscribe: () => {} },
}));

import { TRANSFORM_TOOLS } from '@/tools/transformTools';
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
  h.pos.clear();
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
  it('selects the clicked entity and moves it by the world delta', () => {
    h.pick.entity = 7;
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.move;
    expect(t.onPointerDown(ev(100, 100), ctx)).toBe(true);
    expect(useSelection.getState().selectedId).toBe(7);
    t.onPointerMove(ev(130, 100), ctx); // +30 in x
    t.onPointerUp(ev(130, 100), ctx);
    expect(h.calls.setXY.at(-1)).toEqual([7, 130, 100]);
    expect(h.calls.commit).toBe(1);
  });

  it('Shift-click toggles selection without starting a drag', () => {
    useSelection.getState().select(7);
    h.pick.entity = 9;
    const t = TRANSFORM_TOOLS.move;
    expect(t.onPointerDown(ev(50, 50, { shift: true }), ctx)).toBe(false);
    expect([...useSelection.getState().selectedIds].sort()).toEqual([7, 9]);
  });

  it('Alt-drag duplicates and moves the copy', () => {
    h.pick.entity = 7;
    h.pos.set(7, { x: 100, y: 100 });
    const t = TRANSFORM_TOOLS.move;
    t.onPointerDown(ev(100, 100, { alt: true }), ctx);
    expect(h.calls.dup).toEqual([107]); // copy id = original + 100 (mock)
    expect(useSelection.getState().selectedId).toBe(107);
    t.onPointerMove(ev(140, 100), ctx);
    t.onPointerUp(ev(140, 100), ctx);
    expect(h.calls.setXY.at(-1)).toEqual([107, 140, 100]); // copy tracks the cursor from the original's start
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
