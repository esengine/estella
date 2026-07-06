// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { KineticScroll, ScrollContainer } from '../src/ui';

describe('ScrollContainer drag options', () => {
    it('defaults dragScroll on and decelerationRate to the ScrollRect standard', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 100, y: 100 },
            contentSize: { x: 100, y: 500 },
        });
        expect(c.getDragScroll()).toBe(true);
        expect(c.getDecelerationRate()).toBe(0.135);
    });

    it('plumbs explicit dragScroll / decelerationRate through', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 100, y: 100 },
            contentSize: { x: 100, y: 500 },
            dragScroll: false,
            decelerationRate: 0.5,
        });
        expect(c.getDragScroll()).toBe(false);
        expect(c.getDecelerationRate()).toBe(0.5);
    });
});

describe('KineticScroll', () => {
    const dt = 1 / 60;

    it('starts at rest: no drag, no coast, zero velocity', () => {
        const k = new KineticScroll();
        expect(k.isDragging()).toBe(false);
        expect(k.isCoasting()).toBe(false);
        expect(k.getVelocity()).toEqual({ x: 0, y: 0 });
    });

    it('beginDrag marks dragging and zeroes any prior velocity', () => {
        const k = new KineticScroll();
        k.beginDrag();
        k.sample({ x: 0, y: 10 }, dt);
        k.endDrag();
        expect(k.isCoasting()).toBe(true);

        k.beginDrag();     // catch: a new grab kills the coast
        expect(k.isDragging()).toBe(true);
        expect(k.getVelocity()).toEqual({ x: 0, y: 0 });
        expect(k.isCoasting()).toBe(false);
    });

    it('sampling steers velocity toward delta/dt (EMA, not raw last frame)', () => {
        const k = new KineticScroll();
        k.beginDrag();
        // Steady 10px per frame at 60fps = 600 px/s.
        for (let i = 0; i < 60; i++) k.sample({ x: 0, y: 10 }, dt);
        const v = k.getVelocity();
        expect(v.y).toBeGreaterThan(550);
        expect(v.y).toBeLessThanOrEqual(600 + 1e-9);

        // One jittery zero-delta frame must not wipe the built-up velocity.
        k.sample({ x: 0, y: 0 }, dt);
        expect(k.getVelocity().y).toBeGreaterThan(400);
    });

    it('ignores samples when not dragging and ticks zero while dragging', () => {
        const k = new KineticScroll();
        k.sample({ x: 5, y: 5 }, dt);           // no beginDrag → no-op
        expect(k.getVelocity()).toEqual({ x: 0, y: 0 });

        k.beginDrag();
        k.sample({ x: 0, y: 10 }, dt);
        expect(k.tick(dt)).toEqual({ x: 0, y: 0 }); // held drag never coasts
    });

    it('release coasts: tick returns v·dt and decays to rest', () => {
        const k = new KineticScroll();
        k.beginDrag();
        for (let i = 0; i < 30; i++) k.sample({ x: 0, y: 10 }, dt);
        k.endDrag();
        expect(k.isCoasting()).toBe(true);

        const first = k.tick(dt);
        expect(first.y).toBeGreaterThan(0);

        let travelled = first.y;
        let frames = 0;
        while (k.isCoasting() && frames < 10_000) {
            travelled += k.tick(dt).y;
            frames++;
        }
        expect(frames).toBeLessThan(10_000);        // it does come to rest
        expect(k.isCoasting()).toBe(false);
        expect(k.getVelocity()).toEqual({ x: 0, y: 0 });
        // ~600 px/s decaying at 0.135/s integrates to ≈ v0·(-1/ln r) ≈ 300 px.
        expect(travelled).toBeGreaterThan(100);
        expect(travelled).toBeLessThan(600);
    });

    it('decelerationRate is framerate-independent (30fps ≈ 120fps distance)', () => {
        const run = (step: number): number => {
            const k = new KineticScroll();
            k.beginDrag();
            for (let i = 0; i < 50; i++) k.sample({ x: 0, y: 600 * step }, step);
            k.endDrag();
            let d = 0;
            let guard = 0;
            while (k.isCoasting() && guard++ < 100_000) d += k.tick(step).y;
            return d;
        };
        const d30 = run(1 / 30);
        const d120 = run(1 / 120);
        expect(Math.abs(d30 - d120) / d30).toBeLessThan(0.1);
    });

    it('killAxis stops one axis and lets the other coast on', () => {
        const k = new KineticScroll();
        k.beginDrag();
        for (let i = 0; i < 30; i++) k.sample({ x: 10, y: 10 }, dt);
        k.endDrag();

        k.killAxis('x');
        expect(k.getVelocity().x).toBe(0);
        expect(k.isCoasting()).toBe(true);       // y still alive
        expect(k.tick(dt).x).toBe(0);
        expect(k.getVelocity().y).toBeGreaterThan(0);
    });

    it('stop() halts everything immediately', () => {
        const k = new KineticScroll();
        k.beginDrag();
        for (let i = 0; i < 30; i++) k.sample({ x: 10, y: 10 }, dt);
        k.endDrag();
        k.stop();
        expect(k.isCoasting()).toBe(false);
        expect(k.tick(dt)).toEqual({ x: 0, y: 0 });
    });
});
