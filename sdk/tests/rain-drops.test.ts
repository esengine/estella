// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { buildRainDrops, rainFall, snowFall, RAIN_DROPS_SHADER } from '../src/postprocess/rainDrops';
import { MeshChannel } from '../src/asset/meshFormat';

const effect = (values: Record<string, number>) => ({ uniforms: new Map(Object.entries(values)) });

describe('the 3D rain\'s drops', () => {
    it('fall at a raindrop\'s terminal velocity at the effect\'s default speed, faster as the speed is raised', () => {
        const fall = rainFall(effect({ u_wind: 0 }), 0, 100);
        expect(fall.velocity[1]).toBeCloseTo(-900, 6);
        expect(fall.velocity[0]).toBeCloseTo(0, 9);
        expect(fall.velocity[2]).toBeCloseTo(0, 9);
        expect(rainFall(effect({ u_wind: 0, u_speed: 3.2 }), 0, 100).velocity[1]).toBeCloseTo(-1800, 6);
        // In a project of a different scale they still fall nine metres a second.
        expect(rainFall(effect({ u_wind: 0 }), 0, 1).velocity[1]).toBeCloseTo(-9, 9);
    });

    it('lean with the wind toward where the clouds go, by the wind\'s share of their fall', () => {
        const fall = rainFall(effect({ u_wind: 0.5 }), 90, 100);
        expect(fall.velocity[0]).toBeCloseTo(450, 6);
        expect(fall.velocity[2]).toBeCloseTo(0, 6);
        const toward = rainFall(effect({ u_wind: 0.5 }), 0, 100);
        expect(toward.velocity[2]).toBeCloseTo(450, 6);
    });

    it('are as many as the rain is heavy, and streak as far as they fall while the shutter is open', () => {
        expect(rainFall(effect({ u_intensity: 1 }), 0, 100).share).toBeCloseTo(0.5, 9);
        expect(rainFall(effect({ u_intensity: 2 }), 0, 100).share).toBe(1);
        expect(rainFall(effect({ u_intensity: 0 }), 0, 100).share).toBe(0);
        const fall = rainFall(effect({ u_wind: 0, u_streakLength: 0.3 }), 0, 100);
        expect(fall.streak).toBeCloseTo(90, 6);
        expect(rainFall(effect({ u_wind: 0, u_streakLength: 0.6 }), 0, 100).streak).toBeCloseTo(180, 6);
    });

    it('are snow\'s flakes too: a metre a second, swaying, carried twice as far by the wind, as many as the snowfall, and no streak', () => {
        const snow = snowFall(effect({ u_wind: 0.5, u_snowfall: 1 }), 90, 100);
        expect(snow.mode).toBe(1);
        expect(snow.velocity[1]).toBeCloseTo(-100, 6);
        expect(snow.velocity[0]).toBeCloseTo(100, 6);
        expect(snow.streak).toBe(0);
        expect(snow.sway[0]).toBeGreaterThan(0);
        expect(snow.share).toBe(1);
        expect(snowFall(effect({}), 0, 100).share).toBe(0);
        expect(rainFall(effect({}), 0, 100).mode).toBe(0);
        expect(rainFall(effect({}), 0, 100).sway[0]).toBe(0);
    });

    it('are a quad each, numbered in the x of every corner, with bounds no camera culls', () => {
        const mesh = buildRainDrops(3);
        expect(mesh.vertexCount).toBe(12);
        expect(mesh.indices.length).toBe(18);
        const pos = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!.offset;
        const view = new DataView(mesh.vertices.buffer);
        for (let v = 0; v < 12; v++) expect(view.getFloat32(v * mesh.vertexStride + pos, true)).toBe(Math.floor(v / 4));
        expect(mesh.aabbMax[0]).toBeGreaterThan(1e8);
    });

    it('end on what stands over them, read from the frame\'s cover map, and are drawn where the eye sees them', () => {
        expect(RAIN_DROPS_SHADER).toContain('#pragma depthinput u_rainCover');
        expect(RAIN_DROPS_SHADER).toContain('#pragma vertexoffset');
        expect(RAIN_DROPS_SHADER).not.toContain('`');
    });
});
