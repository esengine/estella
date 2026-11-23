// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { buildRainDrops, rainFall, snowFall, splashFall, RAIN_DROPS_SHADER } from '../src/postprocess/rainDrops';
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

    it('take their look from the effect, in metres, so a toon rain is the author\'s values and textures, not new code', () => {
        const drops = rainFall(effect({ u_streakWidth: 0.05, u_streakBrightness: 2 }), 0, 100);
        expect(drops.width).toBeCloseTo(5, 9);
        expect(drops.brightness).toBe(2);
        expect([drops.color, drops.texture]).toEqual(['u_streakColor', 'u_streakTexture']);
        const snow = snowFall(effect({ u_snowfall: 1, u_flakeSize: 0.1 }), 0, 1);
        expect(snow.width).toBeCloseTo(0.1, 9);
        expect([snow.color, snow.texture]).toEqual(['u_flakeColor', 'u_flakeTexture']);
    });

    it('throw splashes where the drops fall, as many droplets, as fast and as long as the effect says, and none at size 0', () => {
        const drops = rainFall(effect({ u_intensity: 1 }), 0, 100);
        const splash = splashFall(effect({ u_splashDroplets: 6, u_splashSpeed: 2, u_splashLife: 0.5, u_splashSize: 0.05 }), drops, 100);
        expect(splash.mode).toBe(2);
        expect(splash.share).toBe(drops.share);
        expect(splash.width).toBeCloseTo(5, 9);
        expect(splash.splash).toEqual({ droplets: 6, speed: 2, life: 0.5 });
        expect([splash.color, splash.texture]).toEqual(['u_splashColor', 'u_splashTexture']);
        expect(splashFall(effect({ u_splashDroplets: 40 }), drops, 100).splash.droplets).toBe(8);
        expect(splashFall(effect({ u_splashSize: 0 }), drops, 100).share).toBe(0);
    });

    it('are drawn with the author\'s texture where one is given: its alpha the shape, its colour a tint', () => {
        expect(RAIN_DROPS_SHADER).toContain('u_rainSprite');
        expect(RAIN_DROPS_SHADER).toContain('u_rainTint.rgb * sprite.rgb');
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
