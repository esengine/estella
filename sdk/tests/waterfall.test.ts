// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterfall.test.ts
 * @brief   A Waterfall's sheets: the path they take, what ends them, and what their vertices carry for the shader.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setWorldUnitsPerMeter } from '../src/ecs/worldUnits';
import { MeshChannel, type MeshData } from '../src/asset/meshFormat';
import { Waterfall, WaterfallAnchor, buildWaterfall, waterfallAnchorPoint, waterfallFlight, waterfallHeading, type WaterfallData, type WaterfallLip } from '../src/water/waterfall';
import { WATERFALL_SHADER_TEMPLATE } from '../src/water/waterfallShader';

beforeAll(() => setWorldUnitsPerMeter(1));
afterAll(() => setWorldUnitsPerMeter(100));

const fall = (over: Partial<WaterfallData> = {}): WaterfallData => ({ width: 8, speed: 5, flare: 1, sheets: 1, sheetGap: 1, maxDrop: 300, rows: 16, across: 4, ...over });
const lip: WaterfallLip = { x: 10, y: 100, z: -20, dirX: 1, dirZ: 0 };

function read(mesh: MeshData, semantic: number, i: number, n: number): number[] {
    const c = mesh.channels.find((ch) => ch.semantic === semantic)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    return Array.from({ length: n }, (_, k) => view.getFloat32(i * mesh.vertexStride + c.offset + k * 4, true));
}
const colour = (mesh: MeshData, i: number, k: number): number =>
    mesh.vertices[i * mesh.vertexStride + mesh.channels.find((ch) => ch.semantic === MeshChannel.Color)!.offset + k]!;

describe('a waterfall\'s flight', () => {
    it('ends where the path meets the ground, by the time gravity takes to drop that far', () => {
        const { seconds, drop } = waterfallFlight(fall(), lip, { heightAt: () => 20 });
        expect(drop).toBeGreaterThanOrEqual(80);
        expect(drop).toBeLessThan(83);
        expect(seconds).toBeCloseTo(Math.sqrt((2 * drop) / 9.8), 5);
    });

    it('ends in water of another body, and not in the water it left, which reaches past the lip', () => {
        // The river it leaves, to 6 units past the lip and sagging there as a field read between texels does; then the sea.
        const waterAt = (x: number, _z: number, y: number): { body: number; above: number } => (x < 16 ? { body: 7, above: y - (100.1 - (x - 10)) } : { body: 3, above: y });
        const landed = waterfallFlight(fall(), lip, { waterAt }).drop;
        expect(landed).toBeGreaterThanOrEqual(100);
        expect(landed).toBeLessThan(103);
        // A fall from dry ground lands in the first water it meets.
        expect(waterfallFlight(fall(), { ...lip, x: 20 }, { waterAt: (x, _z, y) => (x > 25 ? { body: 3, above: y - 60 } : null) }).drop).toBeLessThan(43);
    });

    it('falls its whole length over nothing, and is thrown further by more speed', () => {
        expect(waterfallFlight(fall({ maxDrop: 50 }), lip, null).drop).toBe(50);
        const slow = waterfallFlight(fall({ speed: 2 }), lip, { heightAt: (x) => (x < 30 ? 90 : 0) }).drop;
        const fast = waterfallFlight(fall({ speed: 20 }), lip, { heightAt: (x) => (x < 30 ? 90 : 0) }).drop;
        expect(slow).toBeLessThan(12);
        expect(fast).toBeGreaterThan(90);
    });
});

describe('a waterfall\'s sheets', () => {
    it('are built along -z in the entity\'s own space, level at the lip and widening to the foot', () => {
        const mesh = buildWaterfall(fall({ flare: 1 }), lip, { heightAt: () => 20 })!;
        const rows = 16, cells = 4, last = rows * (cells + 1);
        expect(mesh.vertexCount).toBe((rows + 1) * (cells + 1));
        expect(read(mesh, MeshChannel.Position, 0, 3)).toEqual([-4, -0, -0]);
        expect(read(mesh, MeshChannel.Normal, 0, 3)[1]).toBeCloseTo(1, 5);
        const foot = read(mesh, MeshChannel.Position, last, 3), across = read(mesh, MeshChannel.Position, last + cells, 3);
        expect(foot[1]).toBeLessThan(-80);
        expect(foot[2]).toBeLessThan(-15);
        expect(across[0]! - foot[0]!).toBeCloseTo(16, 3);
        expect(mesh.aabbMin[1]).toBeCloseTo(foot[1]!, 4);
    });

    it('carry across and seconds fallen in the uv, the share done and the sheet\'s number in the colour, and 0 alpha at the edges', () => {
        const mesh = buildWaterfall(fall({ sheets: 3 }), lip, { heightAt: () => 20 })!;
        const per = 17 * 5;
        expect(mesh.vertexCount).toBe(3 * per);
        expect(read(mesh, MeshChannel.TexCoord0, 0, 2)).toEqual([0, 0]);
        const end = read(mesh, MeshChannel.TexCoord0, per - 1, 2);
        expect(end[0]).toBe(1);
        expect(end[1]).toBeGreaterThan(3.9);
        expect(colour(mesh, 0, 0)).toBe(0);
        expect(colour(mesh, per - 1, 0)).toBe(255);
        expect(new Set([colour(mesh, 0, 1), colour(mesh, per, 1), colour(mesh, 2 * per, 1)]).size).toBe(3);
        expect(colour(mesh, 0, 3)).toBe(0);
        expect(colour(mesh, 2, 3)).toBe(255);
        expect(colour(mesh, 4, 3)).toBe(0);
    });

    it('is nothing without a width or a drop', () => {
        expect(buildWaterfall(fall({ width: 0 }), lip, null)).toBeNull();
        expect(buildWaterfall(fall({ maxDrop: 0 }), lip, null)).toBeNull();
    });
});

describe('the Waterfall component and its shader', () => {
    it('aims by the entity\'s turn about the vertical', () => {
        expect(waterfallHeading({ x: 0, y: 0, z: 0, w: 1 })).toEqual([-0, -1]);
        const quarter = waterfallHeading({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
        expect(quarter[0]).toBeCloseTo(-1, 6);
        expect(quarter[1]).toBeCloseTo(0, 6);
        expect(waterfallHeading({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })).toEqual([0, -1]);
    });

    it('has its lengths in world units, and a shader that rides its pattern down with the water in both languages', () => {
        const d = Waterfall._default;
        expect([d.width, d.speed, d.sheetGap, d.maxDrop, d.flare]).toEqual([8, 5, 0.9, 300, 1.1]);
        const source = WATERFALL_SHADER_TEMPLATE.source;
        expect(source).toContain('(v_texCoord.y - u_time.x) * u_run');
        expect(source).toContain('(v.v_texCoord.y - tc.u_time.x) * mc.u_run');
        // A strand is long: about four lie across half a sheet and one lasts about a second of the fall, not a speckle of sixty by fifteen.
        expect(source).toContain('#pragma param u_strands float default(3.75)');
        expect(source).toContain('#pragma param u_run float default(0.97)');
        expect(source).not.toContain('u_run * 28.0');
        for (const p of ['u_water', 'u_foam', 'u_strands', 'u_run', 'u_veil', 'u_tearBy', 'u_opacity', 'u_roughness']) expect(source).toContain(`#pragma param ${p} `);
    });
});

describe('a WaterfallAnchor', () => {
    it('sits at the lip, at the foot, or a share of the time down, on the path the water takes', () => {
        const f = fall({ speed: 5 });
        const { seconds, drop } = waterfallFlight(f, lip, { heightAt: () => 20 });
        expect(waterfallAnchorPoint(f, seconds, { at: 0, lift: 0 }).map(Math.abs)).toEqual([0, 0, 0]);
        const foot = waterfallAnchorPoint(f, seconds, { at: 1, lift: 0 });
        expect(foot[1]).toBeCloseTo(-drop, 6);
        expect(foot[2]).toBeCloseTo(-5 * seconds, 6);
        const half = waterfallAnchorPoint(f, seconds, { at: 0.5, lift: 0 });
        expect(half[1]).toBeCloseTo(-drop / 4, 6);
        expect(half[2]).toBeCloseTo(-2.5 * seconds, 6);
    });

    it('is lifted off the path by its own lift, and holds a share past either end to that end', () => {
        const f = fall();
        expect(waterfallAnchorPoint(f, 2, { at: 1, lift: 3 })[1]).toBeCloseTo(waterfallAnchorPoint(f, 2, { at: 1, lift: 0 })[1] + 3, 6);
        expect(waterfallAnchorPoint(f, 2, { at: 4, lift: 0 })).toEqual(waterfallAnchorPoint(f, 2, { at: 1, lift: 0 }));
        expect(WaterfallAnchor._default).toEqual({ at: 1, lift: 0 });
    });
});
