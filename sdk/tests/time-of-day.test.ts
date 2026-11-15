import { describe, it, expect } from 'vitest';
import { timeOfDayAt, sunPosition, applyTimeToEffects, TimeDrive, timeScaleOfLight } from '../src/postprocess/timeOfDay';
import { blendWeather, WEATHER_RAIN, WEATHER_CLEAR } from '../src/postprocess/weather';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';
import '../src/postprocess/effects';

const effect = (uniforms: Record<string, number> = {}, colors: Record<string, { r: number; g: number; b: number; a: number }> = {}): BlendedEffect => ({
    enabled: true, uniforms: new Map(Object.entries(uniforms)), textures: new Map(), colors: new Map(Object.entries(colors)),
});

describe('sunPosition', () => {
    it('stands highest at noon, at the height the latitude and season give', () => {
        const noon = sunPosition(12, 40, 15, 0);
        expect(noon.elevation * 180 / Math.PI).toBeCloseTo(90 - 40 + 15, 3);
        const winter = sunPosition(12, 40, -20, 0);
        expect(winter.elevation).toBeLessThan(noon.elevation);
    });

    it('rises in the east and sets in the west', () => {
        const morning = timeOfDayAt(7).sunDir;
        const evening = timeOfDayAt(17).sunDir;
        expect(morning[0]).toBeGreaterThan(0.3);
        expect(evening[0]).toBeLessThan(-0.3);
    });

    it('is below the horizon at midnight and symmetric about noon', () => {
        expect(timeOfDayAt(0).sunDir[1]).toBeLessThan(-0.3);
        expect(timeOfDayAt(9).sunDir[1]).toBeCloseTo(timeOfDayAt(15).sunDir[1], 5);
    });

    it('turns with the world', () => {
        const a = timeOfDayAt(7, 40, 15, 0).sunDir;
        const b = timeOfDayAt(7, 40, 15, 90).sunDir;
        // A quarter turn takes +X to -Z.
        expect(b[2]).toBeCloseTo(-a[0], 4);
        expect(b[1]).toBeCloseTo(a[1], 6);
    });
});

describe('timeOfDayAt', () => {
    it('lights a day fully and a night with the moon alone', () => {
        const noon = timeOfDayAt(12);
        const night = timeOfDayAt(1);
        expect(noon.light).toBeGreaterThan(0.95);
        expect(noon.sky).toBeGreaterThan(0.9);
        expect(night.light).toBeGreaterThan(0);
        expect(night.light).toBeLessThan(0.08);
        expect(night.lightTint[2]).toBeGreaterThan(night.lightTint[0]);
        // The key light is aimed at the moon, which is above the horizon.
        expect(night.lightDir[1]).toBeGreaterThan(0);
        expect(night.sky).toBeLessThan(0.16);
    });

    it('makes the low sun warm and weak', () => {
        const low = timeOfDayAt(6.3);
        const noon = timeOfDayAt(12);
        expect(low.light).toBeLessThan(noon.light);
        expect(low.lightTint[2]).toBeLessThan(low.lightTint[0] - 0.05);
    });

    it('never has the key light jump in strength between neighbouring minutes', () => {
        let previous = timeOfDayAt(0).light;
        for (let m = 1; m <= 24 * 60; m++) {
            const light = timeOfDayAt(m / 60).light;
            expect(Math.abs(light - previous)).toBeLessThan(0.05);
            previous = light;
        }
    });

    it('wraps the hour', () => {
        expect(timeOfDayAt(25).sunDir[1]).toBeCloseTo(timeOfDayAt(1).sunDir[1], 6);
        expect(timeOfDayAt(-1).sunDir[1]).toBeCloseTo(timeOfDayAt(23).sunDir[1], 6);
    });
});

describe('timeScaleOfLight', () => {
    it('dims an ambient light of its own colour by the hour, and leaves one the sky lights to the sky', () => {
        const dusk = timeOfDayAt(18.4, 35, 10, 180);
        expect(dusk.sky).toBeLessThan(0.5);
        expect(timeScaleOfLight(dusk, false, false)).toEqual({ scale: dusk.sky, tint: dusk.skyTint });
        expect(timeScaleOfLight(dusk, false, true)).toEqual({ scale: 1, tint: [1, 1, 1] });
    });

    it('scales the sun by the hour whatever lights the scene', () => {
        const dusk = timeOfDayAt(18.4, 35, 10, 180);
        expect(timeScaleOfLight(dusk, true, true)).toEqual({ scale: dusk.light, tint: dusk.lightTint });
        expect(timeScaleOfLight(dusk, true, false)).toEqual({ scale: dusk.light, tint: dusk.lightTint });
    });
});

describe('applyTimeToEffects', () => {
    it('gives the sky the clock\'s sun and the fog the night\'s darkness', () => {
        const state = timeOfDayAt(1);
        const effects = new Map<string, BlendedEffect>([
            ['skyAtmosphere', effect()],
            ['heightFog', effect({}, { u_fogColor: { r: 0.6, g: 0.7, b: 0.8, a: 1 } })],
            ['autoExposure', effect({ u_bias: 0.1 })],
        ]);
        applyTimeToEffects(effects, state, TimeDrive.All, false);
        const sky = effects.get('skyAtmosphere')!;
        expect(sky.uniforms.get('u_followSun')).toBe(0);
        expect(sky.uniforms.get('u_sunElevation')).toBeCloseTo(state.sunElevation, 6);
        const fog = effects.get('heightFog')!;
        expect(fog.colors.get('u_fogColor')!.g).toBeLessThan(0.1);
        // Without the clock's lights the fog is told where the sun is instead of following a light that is not moving.
        expect(fog.uniforms.get('u_followSun')).toBe(0);
        expect(effects.get('autoExposure')!.uniforms.get('u_bias')).toBeGreaterThan(0.5);
    });

    it('leaves the fog following the light when the clock moves the lights', () => {
        const effects = new Map<string, BlendedEffect>([['heightFog', effect({}, { u_fogColor: { r: 0.6, g: 0.7, b: 0.8, a: 1 } })]]);
        applyTimeToEffects(effects, timeOfDayAt(12), TimeDrive.All, true);
        expect(effects.get('heightFog')!.uniforms.has('u_followSun')).toBe(false);
    });

    it('touches only what it is asked to drive', () => {
        const effects = new Map<string, BlendedEffect>([['skyAtmosphere', effect()], ['autoExposure', effect({ u_bias: 0 })]]);
        applyTimeToEffects(effects, timeOfDayAt(1), TimeDrive.Exposure, false);
        expect(effects.get('skyAtmosphere')!.uniforms.size).toBe(0);
        expect(effects.get('autoExposure')!.uniforms.get('u_bias')).toBeGreaterThan(0);
    });
});

describe('the weather and the sky', () => {
    it('is overcast under rain and clear under a clear sky', () => {
        expect(blendWeather(WEATHER_RAIN, -1, 0).overcast).toBeGreaterThan(0.8);
        expect(blendWeather(WEATHER_CLEAR, -1, 0).overcast).toBe(0);
    });
});
