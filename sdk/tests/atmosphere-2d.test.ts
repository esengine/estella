// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { coversPoint, stepFade } from '../src/render/coverFade';
import { applyWeatherToEffects, blendWeather, WeatherDrive, WEATHER_CLEAR, WEATHER_NONE, WEATHER_RAIN } from '../src/postprocess/weather';
import { getEffectDef } from '../src/postprocess/effects';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';
import { BUILTIN_SHADER_TEMPLATES } from '../src/render/builtinShaders';
import { reflectEsshader } from '../src/render/shaderReflect';

const mist = (uniforms: Record<string, number> = {}): BlendedEffect =>
    ({ enabled: true, uniforms: new Map(Object.entries(uniforms)), textures: new Map(), colors: new Map() });

describe('the ground a cover fade reads as under it', () => {
    const centre = { x: 100, y: 50 };
    const half = { x: 40, y: 20 };

    it('is the whole rectangle for a roof', () => {
        expect(coversPoint(100, 50, centre, half, 0, false)).toBe(true);
        expect(coversPoint(139, 69, centre, half, 0, false)).toBe(true);
        expect(coversPoint(141, 50, centre, half, 0, false)).toBe(false);
    });

    it('is the ellipse inside it for a crown: a corner of the rectangle is open sky', () => {
        expect(coversPoint(139, 69, centre, half, 0, true)).toBe(false);
        expect(coversPoint(130, 50, centre, half, 0, true)).toBe(true);
    });

    it('reaches a margin past the edge, so the fade starts as a target steps up to it', () => {
        expect(coversPoint(145, 50, centre, half, 0, false)).toBe(false);
        expect(coversPoint(145, 50, centre, half, 10, false)).toBe(true);
    });

    it('covers nothing for a sprite with no size', () => {
        expect(coversPoint(0, 0, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, false)).toBe(false);
    });
});

describe('the fade itself', () => {
    it('moves toward its goal at one whole fade per fadeTime, and stops on it', () => {
        expect(stepFade(1, 0.2, 0.1, 0.4)).toBeCloseTo(0.75, 6);
        expect(stepFade(0.3, 0.2, 1, 0.4)).toBe(0.2);
        expect(stepFade(0.2, 1, 0.2, 0.4)).toBeCloseTo(0.7, 6);
        expect(stepFade(0.9, 1, 1, 0.4)).toBe(1);
    });

    it('is immediate with no fade time', () => {
        expect(stepFade(1, 0.1, 0.016, 0)).toBe(0.1);
    });
});

describe('the 2D mist', () => {
    it('is an effect that asks for no depth, so a scene that draws none can still have it', () => {
        const def = getEffectDef('mist2d');
        expect(def).toBeDefined();
        expect(def!.category).toBe('atmosphere');
        expect(def!.uniforms.map((u) => u.name)).toEqual(expect.arrayContaining(['u_density', 'u_coverage', 'u_scale', 'u_speed', 'u_direction', 'u_glow']));
    });

    it('thickens and spreads under rain, and stays within what an opacity can be', () => {
        const rain = blendWeather(WEATHER_RAIN, WEATHER_NONE, 0);
        const effects = new Map([['mist2d', mist({ u_density: 0.4, u_coverage: 0.5 })]]);
        applyWeatherToEffects(effects, rain, WeatherDrive.Fog);
        const out = effects.get('mist2d')!;
        expect(out.uniforms.get('u_density')).toBeGreaterThan(0.4);
        expect(out.uniforms.get('u_density')).toBeLessThanOrEqual(1);
        expect(out.uniforms.get('u_coverage')).toBeGreaterThan(0.5);
        expect(out.uniforms.get('u_coverage')).toBeLessThanOrEqual(1);
    });

    it('is left as authored under a clear sky and by a weather that does not drive the fog', () => {
        const clear = blendWeather(WEATHER_CLEAR, WEATHER_NONE, 0);
        const effects = new Map([['mist2d', mist({ u_density: 0.4, u_coverage: 0.5 })]]);
        applyWeatherToEffects(effects, clear, WeatherDrive.Fog);
        expect(effects.get('mist2d')!.uniforms.get('u_density')).toBeCloseTo(0.4, 6);
        const rain = blendWeather(WEATHER_RAIN, WEATHER_NONE, 0);
        const untouched = new Map([['mist2d', mist({ u_density: 0.4 })]]);
        applyWeatherToEffects(untouched, rain, WeatherDrive.Rain);
        expect(untouched.get('mist2d')!.uniforms.get('u_density')).toBe(0.4);
    });
});

describe('the Sway sprite template', () => {
    const template = BUILTIN_SHADER_TEMPLATES.find((t) => t.id === 'sprite-sway');

    it('is a built-in one, with both backends and the weather\'s wind as a parameter', () => {
        expect(template).toBeDefined();
        expect(template!.source).toContain('#pragma fragment wgsl');
        const names = reflectEsshader(template!.source).params.map((p) => p.name);
        expect(names).toEqual(expect.arrayContaining(['u_swayStrength', 'u_swaySpeed', 'u_swayScale', 'u_swayWind', 'u_tint', 'u_normalMap']));
    });

    it('starts with no wind added and a lean that is a share of the sprite', () => {
        expect(template!.defaults.u_swayWind).toBe(1);
        expect(template!.defaults.u_swayStrength as number).toBeGreaterThan(0);
        expect(template!.defaults.u_swayStrength as number).toBeLessThan(0.5);
    });

    it('holds the foot: the lean grows from nothing at the bottom edge, where the texture coordinate is 0', () => {
        expect(template!.source).toContain('pow(clamp(v_texCoord.y, 0.0, 1.0), 1.5)');
        expect(template!.source).toContain('pow(clamp(v.v_texCoord.y, 0.0, 1.0), 1.5)');
    });
});
