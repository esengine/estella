// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { RippleField } from '../src/water/ripples';
import { wakeStrength, type FloatingData } from '../src/water/floating';
import type { WaterSample } from '../src/water/waterPlugin';

const field = (): RippleField => new RippleField(64, 64);

describe('RippleField', () => {
    it('dies away the same whether frames are even or a hitch comes every few', () => {
        // Each step used to read the last one's height change as a velocity under its own length, so a long frame after short ones multiplied
        // every wave: a 0.1 s hitch every fourth frame took this ripple past 1e29 in twelve seconds, and the water shook.
        const settle = (dts: number[]): number => {
            const f = new RippleField(128, 256);
            f.disturb(128, 128, 6, 1);
            for (let t = 0, i = 0; t < 12; i++) { const dt = dts[i % dts.length]!; f.step(dt, 12, 0.3, 1); t += dt; }
            return f.peak();
        };
        const even = settle([1 / 60]);
        expect(even).toBeLessThan(0.01);
        for (const uneven of [[0.004, 1 / 30], [1 / 120, 1 / 120, 1 / 120, 0.1]]) {
            const peak = settle(uneven);
            expect(Number.isFinite(peak)).toBe(true);
            expect(peak).toBeLessThan(even * 2);
        }
    });

    it('is still until something disturbs it', () => {
        const f = field();
        f.step(0.1, 6, 0.5, 0.4);
        expect(f.peak()).toBe(0);
        expect(f.heightAt(10, 10)).toBe(0);
    });

    it('puts a smooth bump where it is disturbed, and feeds the foam there', () => {
        const f = field();
        f.disturb(32, 32, 4, 1);
        expect(f.heightAt(32, 32)).toBeGreaterThan(0.8);
        expect(f.heightAt(32 + 6, 32)).toBe(0);
        expect(f.foamAt(32, 32)).toBeGreaterThan(0.5);
        f.disturb(32, 32, 4, -1);
        expect(f.heightAt(32, 32)).toBeCloseTo(0, 6);
    });

    it('spreads a bump out as a ring at the wave speed', () => {
        const f = field();
        f.disturb(32, 32, 2, 1);
        // One second at 8 units a second: the ring is about 8 units out and the middle has fallen.
        for (let i = 0; i < 60; i++) f.step(1 / 60, 8, 0, 0);
        let ringAt = 0, ringHeight = 0;
        for (let r = 0; r < 20; r += 0.5) {
            const h = f.heightAt(32 + r, 32);
            if (h > ringHeight) { ringHeight = h; ringAt = r; }
        }
        expect(ringAt).toBeGreaterThan(5);
        expect(ringAt).toBeLessThan(11);
        expect(Math.abs(f.heightAt(32, 32))).toBeLessThan(ringHeight);
        // Round: the same a quarter turn round.
        expect(f.heightAt(32, 32 + ringAt)).toBeCloseTo(f.heightAt(32 + ringAt, 32), 1);
    });

    it('stays stable at a large step by taking substeps', () => {
        const f = field();
        f.disturb(32, 32, 3, 1);
        for (let i = 0; i < 40; i++) f.step(0.1, 20, 0, 0);
        expect(Number.isFinite(f.peak())).toBe(true);
        expect(f.peak()).toBeLessThan(1.5);
    });

    it('loses height to damping, and the foam fades', () => {
        const f = field();
        f.disturb(32, 32, 4, 1);
        const before = f.foamAt(32, 32);
        for (let i = 0; i < 120; i++) f.step(1 / 60, 6, 2, 1);
        expect(f.peak()).toBeLessThan(0.1);
        expect(f.foamAt(32, 32)).toBeLessThan(before * 0.2);
    });

    it('lets waves out at the window\'s edge instead of reflecting them', () => {
        const f = field();
        f.disturb(32, 32, 2, 1);
        for (let i = 0; i < 360; i++) f.step(1 / 60, 10, 0, 0);
        // Six seconds at 10 units a second is far past the 32 units to the edge: what is left is the tail, not a ring coming back.
        expect(f.peak()).toBeLessThan(0.25);
    });

    it('moves its window in whole cells and carries the ripples with it', () => {
        const f = field();
        f.disturb(32, 32, 3, 1);
        const at = f.heightAt(32, 32);
        expect(f.recenter(32 + 10, 32)).toBe(true);
        expect(f.originX).toBeCloseTo(10, 6);
        expect(f.heightAt(32, 32)).toBeCloseTo(at, 6);
        expect(f.recenter(32 + 10, 32)).toBe(false);
        // Far away, nothing is carried: the water there is still.
        f.recenter(5000, 5000);
        expect(f.peak()).toBe(0);
    });

    it('is encoded for the shader: 128 at rest, the foam in green', () => {
        const f = field();
        let px = f.encode(1);
        expect(px[0]).toBe(128);
        expect(px[1]).toBe(0);
        expect(px[3]).toBe(255);
        f.disturb(32, 32, 4, 1);
        px = f.encode(1);
        const at = (Math.floor(32 / f.cell) * f.n + Math.floor(32 / f.cell)) * 4;
        expect(px[at]).toBeGreaterThan(220);
        expect(px[at + 1]).toBeGreaterThan(100);
        f.disturb(32, 32, 4, -2);
        expect(f.encode(1)[at]).toBeLessThan(100);
    });
});

describe('wakeStrength', () => {
    const floating: FloatingData = { buoyancy: 1, drag: 0, radius: 50, points: [], wake: 1 };
    const sample = (depth: number): WaterSample => ({ entity: 1 as never, depth, normal: [0, 1, 0], flow: [0, 0, 0], surface: [0, 0, 0], waterDepth: 1e6, bodyId: "", inside: true });

    it('is a dip for what goes down into the water, and a bump for what comes up', () => {
        expect(wakeStrength(sample(-10), [0, -300, 0], floating, 1 / 60)).toBeLessThan(0);
        expect(wakeStrength(sample(-10), [0, 300, 0], floating, 1 / 60)).toBeGreaterThan(0);
    });

    it('is made by moving along the surface too, and not by standing still', () => {
        expect(wakeStrength(sample(0), [200, 0, 0], floating, 1 / 60)).toBeLessThan(0);
        expect(wakeStrength(sample(0), [0, 0, 0], floating, 1 / 60)).toBeCloseTo(0, 12);
    });

    it('is nothing away from the surface, or with the multiplier at 0, and is capped', () => {
        expect(wakeStrength(sample(-500), [0, -300, 0], floating, 1 / 60)).toBe(0);
        expect(wakeStrength(sample(200), [0, -300, 0], floating, 1 / 60)).toBe(0);
        expect(wakeStrength(sample(-10), [0, -300, 0], { ...floating, wake: 0 }, 1 / 60)).toBe(0);
        expect(wakeStrength(null, [0, -300, 0], floating, 1 / 60)).toBe(0);
        expect(wakeStrength(sample(-10), [0, -1e9, 0], floating, 1 / 60)).toBeCloseTo(-10, 6);
    });
});
