// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
vi.mock('../src/runtime/runtimeAssets', () => ({ createTextureFromPixels: vi.fn(() => 9) }));

import { describe, it, expect, vi } from 'vitest';
import { SkyEnvironment } from '../src/postprocess/skyEnvironment';
import { defineSkyEffect } from '../src/postprocess/customSky';
import { stillSkyKey } from '../src/postprocess/skyStill';
import { CUSTOM_SKY_HEIGHT, CUSTOM_SKY_WIDTH } from '../src/postprocess/customSky';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';
import type { ESEngineModule } from '../src/wasm';

function core() {
    const heap = new ArrayBuffer(1 << 20);
    let next = 1024;
    return {
        HEAPU8: new Uint8Array(heap),
        HEAPF32: new Float32Array(heap),
        _malloc: (n: number) => { const p = next; next += (n + 15) & ~15; return p; },
        _free: () => undefined,
        postprocess_requestSkyCapture: vi.fn(),
        postprocess_pollSkyCapture: vi.fn(() => 1),
        postprocess_takeSkyCapture: vi.fn((dst: number, bytes: number) => bytes >= CUSTOM_SKY_WIDTH * CUSTOM_SKY_HEIGHT * 4 && dst > 0),
        environment_create: vi.fn(() => 5),
        environment_release: vi.fn(),
        renderer_setSkyEnvironment: vi.fn(),
    };
}

const SKY = { glsl: 'vec3 skyRadiance(vec3 d, vec3 s, vec3 c, float e) { return vec3(u_gain); }', wgsl: 'fn skyRadiance(d : vec3f, s : vec3f, c : vec3f, e : f32) -> vec3f { return vec3f(mc.u_gain); }',
    uniforms: [{ name: 'u_gain', label: 'Gain', min: 0, max: 4, step: 0.01, defaultValue: 1 }] };
defineSkyEffect({ type: 'stillNebula', label: 'Still Nebula', still: true, ...SKY });
defineSkyEffect({ type: 'movingNebula', label: 'Moving Nebula', ...SKY });

const effect = (uniforms: Record<string, number>): BlendedEffect =>
    ({ enabled: true, uniforms: new Map(Object.entries(uniforms)), textures: new Map(), colors: new Map() });

function run(sky: SkyEnvironment, c: ReturnType<typeof core>, type: string, keys: (t: number) => string | undefined, from: number, until: number): void {
    for (let t = from; t <= until; t += 0.25) sky.updateCaptured(c as unknown as ESEngineModule, type, t, keys(t));
}

describe('a still sky as the scene\'s environment', () => {
    it('is captured once, and the environment kept while nothing it is made from changes', () => {
        const c = core();
        const sky = new SkyEnvironment(1);
        run(sky, c, 'stillNebula', () => 'a', 0, 10);
        expect(c.postprocess_requestSkyCapture).toHaveBeenCalledTimes(1);
        expect(c.environment_create).toHaveBeenCalledTimes(1);
        expect(sky.environment).toBe(5);
    });

    it('is captured again when its params change, at most once a second', () => {
        const c = core();
        const sky = new SkyEnvironment(1);
        run(sky, c, 'stillNebula', (t) => (t < 2 ? 'a' : `b${Math.floor(t * 4)}`), 0, 4);
        expect(c.postprocess_requestSkyCapture).toHaveBeenCalledTimes(3);
        run(sky, c, 'stillNebula', () => 'c', 4.25, 8);
        expect(c.postprocess_requestSkyCapture).toHaveBeenCalledTimes(4);
        run(sky, c, 'stillNebula', () => 'c', 8.25, 20);
        expect(c.postprocess_requestSkyCapture).toHaveBeenCalledTimes(4);
    });

    it('leaves a sky that is not still captured again every second', () => {
        const c = core();
        const sky = new SkyEnvironment(1);
        run(sky, c, 'movingNebula', () => undefined, 0, 10);
        expect(c.postprocess_requestSkyCapture.mock.calls.length).toBeGreaterThanOrEqual(8);
    });

    it('is keyed by its params, its brightness and the suns, not by whether its panorama is ready', () => {
        expect(stillSkyKey('movingNebula', effect({ u_gain: 1 }), '')).toBeUndefined();
        const key = stillSkyKey('stillNebula', effect({ u_gain: 1, u_intensity: 1, u_skyStillOn: 0 }), 'sun');
        expect(stillSkyKey('stillNebula', effect({ u_gain: 1, u_intensity: 1, u_skyStillOn: 1 }), 'sun')).toBe(key);
        expect(stillSkyKey('stillNebula', effect({ u_gain: 2, u_intensity: 1, u_skyStillOn: 0 }), 'sun')).not.toBe(key);
        expect(stillSkyKey('stillNebula', effect({ u_gain: 1, u_intensity: 2, u_skyStillOn: 0 }), 'sun')).not.toBe(key);
        expect(stillSkyKey('stillNebula', effect({ u_gain: 1, u_intensity: 1, u_skyStillOn: 0 }), 'moved')).not.toBe(key);
    });
});
