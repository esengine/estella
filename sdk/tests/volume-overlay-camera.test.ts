// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which cameras a post-process volume gives a stack to.
 *
 * A first-person view model is a second camera that clears depth only and draws the held gun over the world's finished
 * image. Given the scene's global stack too, it ran height fog and sky over that whole image with its own cleared depth
 * reading as infinitely far, and the world under the gun was painted out (2026-11-11). And a camera under a
 * player was placed at its LOCAL position, near the origin, for the weight of a local volume.
 */
import { describe, it, expect } from 'vitest';
import { postProcessVolumeSystem, cleanupVolumeSystem } from '../src/postprocess/volumeSystem';
import { PostProcessAPI } from '../src/postprocess/PostProcessAPI';
import type { Entity } from '../src/types';
import type { ShaderHandle } from '../src/render/material';

function volumeApi() {
    const api = new PostProcessAPI();
    // Exercise the real camera bindings without opening a graphics device.
    api.volumeShaders.set('vignette', 0 as ShaderHandle);
    return api;
}

const at = (x: number, y: number, z: number, world?: { x: number; y: number; z: number }) => ({
    position: { x, y, z }, worldPosition: world ?? { x, y, z },
});
const camera = (clearFlags: number) => ({ isActive: true, clearFlags, projectionType: 0 });
const vignette = { type: 'vignette', enabled: true, uniforms: { u_intensity: 0.4, u_softness: 0.5 } };

const run = (api: unknown, volumes: unknown[], cameras: unknown[]) =>
    (postProcessVolumeSystem as unknown as { _fn: (...a: unknown[]) => void })._fn(api, volumes, cameras);

describe('which cameras a volume gives a stack to', () => {
    it('gives none to a camera that draws over another camera (clears depth only, or nothing)', () => {
        const api = volumeApi();
        const volume = [1, { isGlobal: true, priority: 0, weight: 1, effects: [vignette] }, at(0, 0, 0)];
        run(api, [volume], [[10, camera(3), at(0, 1, 0)], [11, camera(2), at(0, 1, 0)], [12, camera(0), at(0, 1, 0)]]);
        expect([...api.state.cameraBindings.keys()]).toEqual([10]);
    });

    it('lets go of a stack a camera held before it became an overlay', () => {
        const api = volumeApi();
        const volume = [1, { isGlobal: true, priority: 0, weight: 1, effects: [vignette] }, at(0, 0, 0)];
        run(api, [volume], [[11, camera(3), at(0, 1, 0)]]);
        expect(api.getStack(11 as Entity)).not.toBeNull();
        run(api, [volume], [[11, camera(2), at(0, 1, 0)]]);
        expect(api.getStack(11 as Entity)).toBeNull();
    });

    it('weighs a local volume where a child camera is in the world, not at its local position', () => {
        const api = volumeApi();
        const local = [1, { isGlobal: false, shape: 0, size: { x: 4, y: 4, z: 4 }, blendDistance: 0, priority: 0, weight: 1, effects: [vignette] }, at(50, 0, 0)];
        // An eye 0.7 above its player, the player standing inside the volume at x = 50.
        run(api, [local], [[10, camera(3), at(0, 0.7, 0, { x: 50, y: 0.7, z: 0 })]]);
        expect(api.getStack(10 as Entity)).not.toBeNull();
    });

    it.each(['leave', 'overlay', 'empty chain', 'plugin cleanup'])('preserves a replacement stack on %s', transition => {
        const api = volumeApi(), eye = 11 as Entity;
        const view = [eye, camera(3), at(0, 0, 0)];
        const data = { isGlobal: true, priority: 0, weight: 1, effects: [vignette] };
        const volume = [1, data, at(0, 0, 0)];
        run(api, [volume], [view]);
        const generated = api.getStack(eye)!;
        expect(generated).toBeTruthy();
        const custom = api.createStack();
        api.bind(eye, custom);
        switch (transition) {
            case 'leave': run(api, [], [view]); break;
            case 'overlay': run(api, [volume], [[eye, camera(2), at(0, 0, 0)]]); break;
            case 'empty chain':
                data.effects = [{ ...vignette, type: 'unavailable-effect' }];
                run(api, [volume], [view]);
                break;
            case 'plugin cleanup': cleanupVolumeSystem(api); break;
        }
        expect(api.getStack(eye)).toBe(custom);
        expect(custom.isDestroyed).toBe(false);
        cleanupVolumeSystem(api);
        expect(generated.isDestroyed).toBe(true);
        expect(api.volumeStacks.size).toBe(0);
        expect(api.getStack(eye)).toBe(custom);
    });
});
