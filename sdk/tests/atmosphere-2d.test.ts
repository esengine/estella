// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { coversPoint, stepFade } from '../src/render/coverFade';
import { applyRainSheltersToRain, drynessOf, maskRects, shelterOf, uprightOf, uprightRects, shelterMaskSizeOf, ellipseStripsOf, ELLIPSE_STRIPS, type Shelter } from '../src/render/rainShelter';
import { defaultQualityProfile, parseQualityConfig } from '../src/render/quality';
import { RAIN_SHELTER_MASK_TEXTURE } from '../src/postprocess/rainShelterMask';
import { runtimeTextureHandle, runtimeTextureRef } from '../src/postprocess/runtimeTextures';
import { Light } from '../src/ecs/component';
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

    it('is an effect that asks for no depth, whose shelter mask and the rectangle it covers are written by the engine', () => {
        const def = getEffectDef('rain2d');
        expect(def).toBeDefined();
        expect(def!.category).toBe('atmosphere');
        expect(def!.uniforms.filter((u) => u.internal).map((u) => u.name)).toEqual(['u_maskL', 'u_maskB', 'u_maskW', 'u_maskH']);
        expect(def!.textures).toEqual([{ name: RAIN_SHELTER_MASK_TEXTURE, label: 'Shelter Mask', internal: true }]);
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

    it('lists a sprite that stands on the ground as an upright, with how much of it shows', () => {
        const u = uprightOf(sprite(0.5), at(10, 20), { inset: 4, enabled: true })!;
        expect(u).toMatchObject({ x: 10, y: 20, hx: 46, hy: 26 });
        expect(u.amount).toBe(0.5);
        expect(uprightOf(sprite(0), at(0, 0), { inset: 0, enabled: true })).toBeNull();
        expect(uprightOf(sprite(1), at(0, 0), { inset: 0, enabled: false })).toBeNull();
        expect(uprightOf(sprite(1), at(0, 0), { inset: 40, enabled: true })).toBeNull();
    });

    it('paints only the uprights the view can see, one rectangle each, the amount in the colour', () => {
        const view = { left: -100, right: 100, bottom: -100, top: 100 };
        const seen = uprightOf(sprite(1), at(0, 0), { inset: 0, enabled: true })!;
        const far = uprightOf(sprite(1), at(900, 0), { inset: 0, enabled: true })!;
        expect(uprightRects([seen, far], view)).toEqual([{ x: 0, y: 0, w: 100, h: 60, dry: 1 }]);
    });

    it('leaves the rings, splashes and wet darkening off what stands, in both shader languages', () => {
        const rain2dSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'postprocess', 'sources', 'rain2d.ts'), 'utf8');
        expect(rain2dSource).toContain('float ground = 1.0 - min(m.y * 1.15, 1.0);');
        expect(rain2dSource).toContain('let ground = 1.0 - min(m.y * 1.15, 1.0);');
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

    const view = { left: -500, bottom: -500, right: 500, top: 500 };

    it('draws a box shelter as one rectangle of its own size', () => {
        expect(maskRects([{ x: 10, y: 20, hx: 50, hy: 30, dry: 0.7 }], view)).toEqual([{ x: 10, y: 20, w: 100, h: 60, dry: 0.7 }]);
    });

    it('draws a round shelter as strips whose widths follow the ellipse and whose heights fill it', () => {
        const rects = maskRects([{ x: 0, y: 0, hx: 100, hy: -50, dry: 1 }], view);
        expect(rects).toHaveLength(ELLIPSE_STRIPS);
        expect(rects.reduce((sum, r) => sum + r.h, 0)).toBeCloseTo(100, 6);
        const widest = Math.max(...rects.map((r) => r.w));
        expect(widest).toBeGreaterThan(190);
        expect(widest).toBeLessThanOrEqual(200);
        expect(Math.min(...rects.map((r) => r.w))).toBeLessThan(80);
        const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
        expect(area).toBeGreaterThan(Math.PI * 100 * 50 * 0.97);
        expect(area).toBeLessThan(Math.PI * 100 * 50 * 1.03);
    });

    it('draws the driest last, so where two shelters overlap the drier wins', () => {
        const rects = maskRects([{ x: 0, y: 0, hx: 10, hy: 10, dry: 0.9 }, { x: 0, y: 0, hx: 40, hy: 40, dry: 0.2 }], view);
        expect(rects.map((r) => r.dry)).toEqual([0.2, 0.9]);
    });

    it('leaves out a shelter the view cannot see, and keeps every one it can: there is no count to run out of', () => {
        const many: Shelter[] = Array.from({ length: 200 }, (_, i) => ({ x: (i % 20) * 40 - 400, y: Math.floor(i / 20) * 40 - 200, hx: 15, hy: 15, dry: 0.5 }));
        expect(maskRects(many, view)).toHaveLength(200);
        const away: Shelter[] = [{ x: 5000, y: 0, hx: 10, hy: 10, dry: 1 }, { x: 0, y: -5000, hx: 10, hy: 10, dry: 1 }];
        expect(maskRects(away, view)).toEqual([]);
        expect(maskRects([{ x: 540, y: 0, hx: 50, hy: 10, dry: 1 }], view)).toHaveLength(1);
    });

    it('tells a rain2d effect where the mask lies and which texture it is, and leaves other effects and a disabled rain alone', () => {
        const effects = new Map([['rain2d', mist()]]);
        applyRainSheltersToRain(effects);
        const rain = effects.get('rain2d')!;
        for (const name of ['u_maskL', 'u_maskB', 'u_maskW', 'u_maskH']) expect(rain.uniforms.get(name)).toBe(0);
        expect(rain.textures.size).toBe(0);
        const none = new Map([['mist2d', mist()]]);
        applyRainSheltersToRain(none);
        expect(none.get('mist2d')!.uniforms.size).toBe(0);
        const off = new Map([['rain2d', { ...mist(), enabled: false }]]);
        applyRainSheltersToRain(off);
        expect(off.get('rain2d')!.uniforms.size).toBe(0);
    });

    it('has a mask size of its own, authored on the effect, that a quality level can only hold lower', () => {
        const size = getEffectDef('rain2d')!.uniforms.find((u) => u.name === 'u_maskSize')!;
        expect(size.defaultValue).toBe(512);
        expect(size.internal).toBeUndefined();
        expect(shelterMaskSizeOf(1024, 256)).toBe(256);
        expect(shelterMaskSizeOf(128, 256)).toBe(128);
        expect(shelterMaskSizeOf(1024, null)).toBe(1024);
        expect(shelterMaskSizeOf(Number.NaN, null)).toBe(512);
        expect(shelterMaskSizeOf(1, null)).toBe(64);
        expect(shelterMaskSizeOf(99999, null)).toBe(2048);
        expect(shelterMaskSizeOf(500, null) % 16).toBe(0);
    });

    it('cuts an ellipse into as many strips as its mask can show', () => {
        expect(ellipseStripsOf(512)).toBe(ELLIPSE_STRIPS);
        expect(ellipseStripsOf(64)).toBe(8);
        expect(ellipseStripsOf(4096)).toBe(64);
        const round: Shelter[] = [{ x: 0, y: 0, hx: 100, hy: -50, dry: 1 }];
        const view = { left: -500, bottom: -500, right: 500, top: 500 };
        expect(maskRects(round, view, 8)).toHaveLength(8);
        expect(maskRects(round, view, 64)).toHaveLength(64);
    });

    it('is held lower by each quality level, and a project can say its own', () => {
        expect(defaultQualityProfile('low').shelterMaskSize).toBe(256);
        expect(defaultQualityProfile('medium').shelterMaskSize).toBe(512);
        expect(defaultQualityProfile('high').shelterMaskSize).toBe(1024);
        expect([8, 12, 16]).toEqual(['low', 'medium', 'high'].map((l) => defaultQualityProfile(l as 'low').shadowSoftSamples));
        expect(parseQualityConfig({ mode: 'low', profiles: { low: { shadowSoftSamples: 99 }, medium: { shadowSoftSamples: 0 } } }).profiles?.low?.shadowSoftSamples).toBe(32);
        expect(parseQualityConfig({ mode: 'low', profiles: { medium: { shadowSoftSamples: 0 } } }).profiles?.medium?.shadowSoftSamples).toBe(1);
        const q = parseQualityConfig({ mode: 'low', profiles: { low: { shelterMaskSize: 100000 }, medium: { shelterMaskSize: 'big' } } });
        expect(q.profiles?.low?.shelterMaskSize).toBe(2048);
        expect(q.profiles?.medium?.shelterMaskSize).toBe(512);
    });

    it('names its mask by a ref that carries the handle, so a texture made again is a new ref', () => {
        const ref = runtimeTextureRef(RAIN_SHELTER_MASK_TEXTURE, 42);
        expect(runtimeTextureHandle(ref)).toBe(42);
        expect(runtimeTextureRef(RAIN_SHELTER_MASK_TEXTURE, 43)).not.toBe(ref);
        expect(runtimeTextureHandle('assets/textures/rain.png')).toBeNull();
        expect(runtimeTextureHandle('@runtime:rain-shelter-mask#0')).toBeNull();
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

describe('the layers a light reaches', () => {
    it('is every layer by default, so a scene written before it is lit as it was', () => {
        expect(Light._default.layerMin).toBe(-128);
        expect(Light._default.layerMax).toBe(127);
    });

    it('is told to every Lit sprite template, which reads the layer its vertex wrote and names it to the lighting', () => {
        for (const id of ['sprite-lit', 'sprite-sway']) {
            const source = BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id)!.source;
            expect(source, id).toContain('flat in highp float v_lightLayer;');
            expect(source, id).toContain('applyLighting2DLayer(base.rgb, N, v_worldPos, v_lightLayer)');
            expect(source, id).toContain('applyLighting2DLayer(base.rgb, N, v.v_worldPos, v.v_lightLayer)');
        }
    });

    it('is not asked of the mesh templates, which have no layer to give', () => {
        for (const id of ['model', 'toon', 'matcap']) {
            expect(BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id)!.source, id).not.toContain('v_lightLayer');
        }
    });
});
