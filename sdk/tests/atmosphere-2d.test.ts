// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { coversPoint, stepFade } from '../src/render/coverFade';
import { applyRainSheltersToRain, drynessOf, nearestShelters, shelterOf, type Shelter } from '../src/render/rainShelter';
import { RAIN_SHELTER_SLOTS, shelterUniform } from '../src/postprocess/rainShelterSlots';
import type { SpriteData, TransformData } from '../src/ecs/component';
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

describe('the 2D rain', () => {
    const sprite = (alpha: number, enabled = true): SpriteData =>
        ({ size: { x: 100, y: 60 }, pivot: { x: 0.5, y: 0.5 }, color: { r: 1, g: 1, b: 1, a: alpha }, enabled }) as SpriteData;
    const at = (x: number, y: number): TransformData =>
        ({ worldPosition: { x, y, z: 0 }, worldScale: { x: 1, y: 1, z: 1 } }) as TransformData;
    const data = { round: false, margin: 0, enabled: true };

    it('is an effect that asks for no depth and for no shelter map, with every shelter slot internal', () => {
        const def = getEffectDef('rain2d');
        expect(def).toBeDefined();
        expect(def!.category).toBe('atmosphere');
        const slots = def!.uniforms.filter((u) => u.internal);
        expect(slots).toHaveLength(RAIN_SHELTER_SLOTS * 5);
        expect(def!.uniforms.map((u) => u.name)).toEqual(expect.arrayContaining(['u_intensity', 'u_wetness', 'u_puddles', 'u_puddleScale', 'u_rippleScale']));
    });

    it('keeps the ground dry as far as the sprite lets it be seen: an opaque roof hides it, a clear one hides nothing', () => {
        expect(drynessOf(1)).toBe(0);
        expect(drynessOf(0)).toBe(1);
        expect(drynessOf(0.12)).toBeCloseTo(0.88, 6);
        expect(drynessOf(7)).toBe(0);
        expect(drynessOf(-1)).toBe(1);
    });

    it('lists a faded roof as a shelter, with its ground and the dryness the fade gives it', () => {
        const s = shelterOf(sprite(0.25), at(10, 20), { ...data, margin: 5 })!;
        expect(s).toMatchObject({ x: 10, y: 20, hx: 55, hy: 35 });
        expect(s.dry).toBeCloseTo(0.75, 6);
    });

    it('says round by a negative half height', () => {
        expect(shelterOf(sprite(0), at(0, 0), { ...data, round: true })!.hy).toBeLessThan(0);
    });

    it('lists nothing for an opaque sprite, a disabled one, or one with no ground', () => {
        expect(shelterOf(sprite(1), at(0, 0), data)).toBeNull();
        expect(shelterOf(sprite(0), at(0, 0), { ...data, enabled: false })).toBeNull();
        expect(shelterOf(sprite(0, false), at(0, 0), data)).toBeNull();
        expect(shelterOf({ ...sprite(0), size: { x: 0, y: 0 } }, at(0, 0), data)).toBeNull();
    });

    it('reads the sprite pivot: the ground is where the sprite is, not where the entity stands', () => {
        const s = shelterOf({ ...sprite(0), pivot: { x: 0.5, y: 0 } }, at(0, 0), data)!;
        expect(s.y).toBeCloseTo(30, 6);
    });

    it('hands the shader the shelters nearest the camera, by their edge, so a big roof is not passed over for a small shed', () => {
        const roof: Shelter = { x: 300, y: 0, hx: 250, hy: 250, dry: 1 };
        const shed: Shelter = { x: 120, y: 0, hx: 10, hy: 10, dry: 1 };
        const far: Shelter = { x: 900, y: 0, hx: 10, hy: 10, dry: 1 };
        expect(nearestShelters([far, shed, roof], 0, 0, 2)).toEqual([roof, shed]);
    });

    it('writes the slots of a rain2d effect and leaves other effects and a disabled rain alone', () => {
        const effects = new Map([['rain2d', mist()]]);
        applyRainSheltersToRain(effects, 0, 0);
        const rain = effects.get('rain2d')!;
        for (let slot = 0; slot < RAIN_SHELTER_SLOTS; slot++) expect(rain.uniforms.get(shelterUniform(slot, 'hx'))).toBe(0);
        const none = new Map([['mist2d', mist()]]);
        applyRainSheltersToRain(none, 0, 0);
        expect(none.get('mist2d')!.uniforms.size).toBe(0);
        const off = new Map([['rain2d', { ...mist(), enabled: false }]]);
        applyRainSheltersToRain(off, 0, 0);
        expect(off.get('rain2d')!.uniforms.size).toBe(0);
    });

    it('is the rain a weather raises, and brings no second rain beside it', () => {
        const rain = blendWeather(WEATHER_RAIN, WEATHER_NONE, 0);
        const effects = new Map([['rain2d', mist({ u_intensity: 0.1, u_wetness: 0.1 })]]);
        applyWeatherToEffects(effects, rain, WeatherDrive.Rain);
        expect(effects.has('rain')).toBe(false);
        expect(effects.get('rain2d')!.uniforms.get('u_intensity')).toBeGreaterThan(0.1);
        const plain = new Map<string, BlendedEffect>();
        applyWeatherToEffects(plain, rain, WeatherDrive.Rain);
        expect(plain.has('rain')).toBe(true);
    });
});
