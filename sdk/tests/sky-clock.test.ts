// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** The sky's clouds are where their wind has taken them so far: a wind that changes moves them from there, and never moves the sky. */
import { beforeEach, describe, expect, it } from 'vitest';
import { advanceSkyClock, applySkyClock, setSkyClockState, skyClockState } from '../src/postprocess/skyClock';
import { applyCloudsToFog } from '../src/postprocess/cloudShafts';
import { resetWeatherSystem } from '../src/postprocess/weatherSystem';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';

const sky = (uniforms: Record<string, number> = {}): BlendedEffect =>
    ({ enabled: true, uniforms: new Map(Object.entries({ u_windSpeed: 1, u_windDirection: 90, u_cloud2Wind: 2, u_cloudChange: 0.5, ...uniforms })), colors: new Map(), textures: new Map() }) as unknown as BlendedEffect;
const effects = (e: BlendedEffect): Map<string, BlendedEffect> => new Map([['skyAtmosphere', e]]);

beforeEach(() => setSkyClockState(null));

describe('the sky clock', () => {
    it('adds up what the wind does, the way it blows', () => {
        applySkyClock(effects(sky()), 1);
        advanceSkyClock(2);
        expect(skyClockState().driftX).toBeCloseTo(2, 6);
        expect(skyClockState().driftZ).toBeCloseTo(0, 6);
        expect(skyClockState().evolve).toBeCloseTo(1, 6);
    });

    it('tells the sky where its clouds are', () => {
        const e = sky();
        applySkyClock(effects(e), 1);
        advanceSkyClock(3);
        applySkyClock(effects(e), 1);
        expect(e.uniforms.get('u_cloudDriftX')).toBeCloseTo(3, 6);
        expect(e.uniforms.get('u_cloudEvolve')).toBeCloseTo(1.5, 6);
    });

    it('does not move the clouds when the wind changes, however long it has run', () => {
        applySkyClock(effects(sky()), 1);
        advanceSkyClock(10000);
        const before = skyClockState().driftX;
        const e = sky({ u_windSpeed: 2 });
        applySkyClock(effects(e), 1);
        expect(skyClockState().driftX).toBe(before);
        expect(e.uniforms.get('u_cloudDriftX')).toBe(before);
        advanceSkyClock(1);
        expect(skyClockState().driftX).toBeCloseTo(before + 2, 3);
    });

    it('turns with the wind from where the clouds are', () => {
        applySkyClock(effects(sky()), 1);
        advanceSkyClock(5);
        applySkyClock(effects(sky({ u_windDirection: 0 })), 1);
        advanceSkyClock(5);
        expect(skyClockState().driftX).toBeCloseTo(5, 6);
        expect(skyClockState().driftZ).toBeCloseTo(5, 6);
    });

    it('takes the weather\'s wind', () => {
        applySkyClock(effects(sky()), 3);
        advanceSkyClock(1);
        expect(skyClockState().driftX).toBeCloseTo(3, 6);
        expect(skyClockState().upperDriftX).toBeCloseTo(6, 6);
    });

    it('moves the upper layer by its own share of the wind', () => {
        applySkyClock(effects(sky({ u_cloud2Wind: 0.5 })), 1);
        advanceSkyClock(4);
        expect(skyClockState().upperDriftX).toBeCloseTo(2, 6);
        expect(skyClockState().driftX).toBeCloseTo(4, 6);
    });

    it('stands still while the game does, and the same steps come to the same place', () => {
        applySkyClock(effects(sky()), 1);
        advanceSkyClock(1 / 60);
        const at = skyClockState();
        advanceSkyClock(0);
        expect(skyClockState()).toEqual(at);
        setSkyClockState(null);
        applySkyClock(effects(sky()), 1);
        advanceSkyClock(1 / 60);
        expect(skyClockState()).toEqual(at);
    });

    it('keeps a saved place, and starts over with none', () => {
        setSkyClockState({ driftX: 9, evolve: 2 });
        expect(skyClockState()).toEqual({ driftX: 9, driftZ: 0, upperDriftX: 0, upperDriftZ: 0, evolve: 2 });
        setSkyClockState(null);
        expect(skyClockState().driftX).toBe(0);
    });

    it('starts over when the weather system does, so another run in one page is the same sky', () => {
        applySkyClock(effects(sky()), 1);
        advanceSkyClock(5);
        resetWeatherSystem();
        expect(skyClockState().driftX).toBe(0);
    });

    it('leaves a scene with no sky alone', () => {
        const none = new Map<string, BlendedEffect>();
        applySkyClock(none, 1);
        advanceSkyClock(5);
        expect(none.size).toBe(0);
        expect(skyClockState().driftX).toBe(0);
    });

    it('gives the fog the same place the sky has, so its shafts stand under the clouds', () => {
        const e = sky({ u_cloudShadow: 0.5, u_clouds: 0.5 });
        const fog = { enabled: true, uniforms: new Map([['u_cloudShade', 1]]), colors: new Map(), textures: new Map() } as unknown as BlendedEffect;
        const all = new Map([['skyAtmosphere', e], ['heightFog', fog]]);
        applySkyClock(all, 1);
        advanceSkyClock(7);
        applySkyClock(all, 1);
        applyCloudsToFog(all);
        expect(fog.uniforms.get('u_skyDriftX')).toBeCloseTo(7, 6);
        expect(fog.uniforms.get('u_skyEvolve')).toBeCloseTo(3.5, 6);
    });
});
