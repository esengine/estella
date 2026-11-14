// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    addWindFront, springAt, stepWind, windLean, windMemory, windUniforms,
    WIND_FIELD_GLSL, WIND_FIELD_PARAMS, WIND_FIELD_WGSL, WIND_FRONTS, WIND_PASSES, WIND_RING,
} from '../src/render/windField';

describe('the wind field', () => {
    it('springs: over within a quarter second, back past upright, still by the ring', () => {
        let peak = 0;
        let peakAt = 0;
        let low = 0;
        for (let s = 0; s <= WIND_RING; s += 0.005) {
            const v = springAt(s);
            if (v > peak) { peak = v; peakAt = s; }
            low = Math.min(low, v);
        }
        expect(peak).toBeGreaterThan(0.95);
        expect(peak).toBeLessThan(1.05);
        expect(peakAt).toBeGreaterThan(0.15);
        expect(peakAt).toBeLessThan(0.35);
        expect(low).toBeLessThan(-0.25);
        expect(springAt(-0.1)).toBe(0);
        expect(springAt(WIND_RING + 0.01)).toBe(0);
        expect(Math.abs(springAt(WIND_RING - 0.01))).toBeLessThan(0.05);
    });

    it('leaves a pass every half radius a body travels, with the velocity it moved at', () => {
        const memory = windMemory();
        stepWind(memory, [{ id: 1, x: 0, y: 0, z: 0, radius: 2, strength: 1 }], 0);
        stepWind(memory, [{ id: 1, x: 0.5, y: 0, z: 0, radius: 2, strength: 1 }], 0.05);
        expect(memory.passes).toHaveLength(0);
        stepWind(memory, [{ id: 1, x: 2, y: 0, z: 0, radius: 2, strength: 1 }], 0.1);
        expect(memory.passes).toHaveLength(1);
        const p = memory.passes[0]!;
        expect(p.vx).toBeCloseTo(20, 5);
        expect(p.x).toBeCloseTo(1, 5);
        expect(p.t0).toBeCloseTo(0.05, 5);
    });

    it('pushes a plant beside the path along it, and one out of reach not at all', () => {
        const memory = windMemory();
        stepWind(memory, [{ id: 1, x: 0, y: 0, z: 0, radius: 2, strength: 1 }], 0);
        stepWind(memory, [{ id: 1, x: 2, y: 0, z: 0, radius: 2, strength: 1 }], 0.1);
        const at = 0.05 + 0.25;
        const near = windLean('xz', { x: 1, y: 0, z: 0.5 }, at, memory.passes, []);
        const far = windLean('xz', { x: 1, y: 0, z: 3 }, at, memory.passes, []);
        expect(near.x).toBeGreaterThan(5);
        expect(Math.abs(near.y)).toBeLessThan(1e-9);
        expect(far.x).toBe(0);
    });

    it('reaches a plant only when its front has travelled that far, and pushes it outward', () => {
        const memory = windMemory();
        addWindFront(memory, { x: 0, y: 0, z: 0 }, 1, { strength: 20, speed: 10, reach: 30 });
        const plant = { x: 10, y: 0, z: 0 };
        expect(windLean('xz', plant, 1.99, [], memory.fronts).x).toBe(0);
        const after = windLean('xz', plant, 2.25, [], memory.fronts);
        expect(after.x).toBeGreaterThan(5);
        expect(windLean('xz', { x: 40, y: 0, z: 0 }, 6, [], memory.fronts).x).toBe(0);
    });

    it('reads the picture plane in 2D: a body moving along x leans plants along x', () => {
        const memory = windMemory();
        stepWind(memory, [{ id: 1, x: 0, y: 0, z: 0, radius: 64, strength: 1 }], 0);
        stepWind(memory, [{ id: 1, x: 64, y: 0, z: 0, radius: 64, strength: 1 }], 0.2);
        const lean = windLean('xy', { x: 32, y: 10 }, 0.1 + 0.25, memory.passes, []);
        expect(lean.x).toBeGreaterThan(100);
        expect(lean.y).toBe(0);
    });

    it('drops what has rung down, and hands the shaders the newest, as ages', () => {
        const memory = windMemory();
        for (let i = 0; i <= 12; i++) stepWind(memory, [{ id: 1, x: i, y: 0, z: 0, radius: 2, strength: 1 }], i * 0.1);
        expect(memory.passes.length).toBe(12);
        const u = windUniforms(memory, 1.2);
        const ages = Array.from({ length: WIND_PASSES }, (_, i) => u.get(`u_windPass${i}`)!.w);
        expect(ages[0]).toBeCloseTo(0.05, 5);
        for (let i = 1; i < ages.length; i++) expect(ages[i]).toBeGreaterThan(ages[i - 1]!);
        stepWind(memory, [], 1.2 + WIND_RING + 0.1);
        expect(memory.passes).toHaveLength(0);
        expect(u.get(`u_windFrontP${WIND_FRONTS - 1}`)).toEqual({ x: 0, y: 0, z: 0, w: 0 });
    });

    it('declares and calls every pass and front in both languages', () => {
        for (let i = 0; i < WIND_PASSES; i++) {
            expect(WIND_FIELD_PARAMS).toContain(`u_windPass${i} vec4`);
            expect(WIND_FIELD_PARAMS).toContain(`u_windPassV${i} vec4`);
        }
        const glslCalls = WIND_FIELD_GLSL.split('esWindPassAt(at,').length - 1;
        const wgslCalls = WIND_FIELD_WGSL.split('esWindPassAt(at,').length - 1;
        expect(glslCalls).toBe(WIND_PASSES * 2);
        expect(wgslCalls).toBe(WIND_PASSES * 2);
        expect(WIND_FIELD_GLSL.split('esWindFrontAt(at,').length - 1).toBe(WIND_FRONTS * 2);
        expect(WIND_FIELD_WGSL).toContain('mc.u_windFrontP3');
        expect(WIND_FIELD_GLSL).not.toContain('u_time');
    });
});
