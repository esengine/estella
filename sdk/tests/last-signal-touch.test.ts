// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { Gestures } from '../../fixtures/last-signal/src/touch';

const dt = 1 / 60;

describe('last signal: touch gestures', () => {
    it('reads a short press that stays put as a tap, where the finger lifted', () => {
        const g = new Gestures();
        expect(g.feed([{ id: 1, x: 100, y: 200 }], dt, false).tap).toBeNull();
        g.feed([{ id: 1, x: 103, y: 201 }], dt, false);
        expect(g.feed([], dt, false).tap).toEqual({ x: 103, y: 201 });
        expect(g.feed([], dt, false).tap).toBeNull();
    });

    it('does not tap after a long hold or after the finger has travelled', () => {
        const held = new Gestures();
        for (let i = 0; i < 40; i++) held.feed([{ id: 1, x: 100, y: 200 }], dt, false);
        expect(held.feed([], dt, false).tap).toBeNull();

        const dragged = new Gestures();
        dragged.feed([{ id: 1, x: 100, y: 200 }], dt, false);
        dragged.feed([{ id: 1, x: 140, y: 200 }], dt, false);
        dragged.feed([{ id: 1, x: 101, y: 200 }], dt, false);
        expect(dragged.feed([], dt, false).tap).toBeNull();
    });

    it('reports a one-finger drag frame by frame once it has left the tap slop', () => {
        const g = new Gestures();
        g.feed([{ id: 1, x: 100, y: 100 }], dt, false);
        expect(g.feed([{ id: 1, x: 105, y: 100 }], dt, false).drag).toBeNull();
        expect(g.feed([{ id: 1, x: 130, y: 110 }], dt, false).drag).toEqual({ fromX: 105, fromY: 100, toX: 130, toY: 110 });
        expect(g.feed([{ id: 1, x: 150, y: 110 }], dt, false).drag).toEqual({ fromX: 130, fromY: 110, toX: 150, toY: 110 });
        expect(g.feed([{ id: 1, x: 150, y: 110 }], dt, false).drag).toBeNull();
    });

    it('ignores a press that began on the interface, however it moves or ends', () => {
        const g = new Gestures();
        g.feed([{ id: 1, x: 100, y: 100 }], dt, true);
        expect(g.feed([{ id: 1, x: 200, y: 100 }], dt, false)).toEqual({ tap: null, drag: null, pinch: null });
        expect(g.feed([], dt, false).tap).toBeNull();
        g.feed([{ id: 2, x: 50, y: 50 }], dt, true);
        expect(g.feed([], dt, false).tap).toBeNull();
    });

    it('zooms by how two fingers spread, about the point between them, and neither drags nor taps', () => {
        const g = new Gestures();
        g.feed([{ id: 1, x: 100, y: 100 }], dt, false);
        g.feed([{ id: 1, x: 100, y: 100 }, { id: 2, x: 200, y: 100 }], dt, false);
        expect(g.feed([{ id: 1, x: 100, y: 100 }, { id: 2, x: 200, y: 100 }], dt, false).pinch).toEqual({ factor: 1, x: 150, y: 100 });
        const apart = g.feed([{ id: 1, x: 50, y: 100 }, { id: 2, x: 250, y: 100 }], dt, false);
        expect(apart.pinch).toEqual({ factor: 0.5, x: 150, y: 100 });
        expect(apart.drag).toBeNull();
        expect(g.feed([{ id: 1, x: 75, y: 100 }, { id: 2, x: 225, y: 100 }], dt, false).pinch?.factor).toBeCloseTo(200 / 150, 6);
        expect(g.feed([{ id: 2, x: 225, y: 100 }], dt, false)).toEqual({ tap: null, drag: null, pinch: null });
        expect(g.feed([{ id: 2, x: 300, y: 100 }], dt, false).drag).toBeNull();
        expect(g.feed([], dt, false).tap).toBeNull();
        g.feed([{ id: 3, x: 10, y: 10 }], dt, false);
        expect(g.feed([], dt, false).tap).toEqual({ x: 10, y: 10 });
    });
});
