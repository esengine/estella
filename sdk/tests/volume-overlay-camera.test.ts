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
import { postProcessVolumeSystem } from '../src/postprocess/volumeSystem';
import type { Entity } from '../src/types';

/** A stack that takes every call, and an API that records which camera holds one. */
function fakeApi() {
    const anyCall: ProxyHandler<object> = { get: (_t, key) => (key === 'then' ? undefined : () => undefined) };
    const bound = new Set<number>();
    const base = {
        volumeStacks: new Map<Entity, unknown>(),
        // Every effect's shader already made: the test is about which camera gets a stack, not about compiling one.
        volumeShaders: { get: () => 1, set: () => undefined },
        // A stack that reports a pass, as one built from the volume's effects would.
        createStack: () => new Proxy({ destroy: () => undefined, enabledPassCount: 1, displayLut: { amount: 0 } },
            { get: (t, key) => (key in t ? (t as Record<string | symbol, unknown>)[key] : anyCall.get!(t, key, t)) }),
        bind: (camera: Entity) => { bound.add(camera as number); },
        unbind: (camera: Entity) => { bound.delete(camera as number); },
    };
    const api = new Proxy(base, { get: (t, key) => (key in t ? (t as Record<string | symbol, unknown>)[key] : undefined) });
    return { api, bound };
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
        const { api, bound } = fakeApi();
        const volume = [1, { isGlobal: true, priority: 0, weight: 1, effects: [vignette] }, at(0, 0, 0)];
        run(api, [volume], [[10, camera(3), at(0, 1, 0)], [11, camera(2), at(0, 1, 0)], [12, camera(0), at(0, 1, 0)]]);
        expect([...bound]).toEqual([10]);
    });

    it('lets go of a stack a camera held before it became an overlay', () => {
        const { api, bound } = fakeApi();
        const volume = [1, { isGlobal: true, priority: 0, weight: 1, effects: [vignette] }, at(0, 0, 0)];
        run(api, [volume], [[11, camera(3), at(0, 1, 0)]]);
        expect(bound.has(11)).toBe(true);
        run(api, [volume], [[11, camera(2), at(0, 1, 0)]]);
        expect(bound.has(11)).toBe(false);
    });

    it('weighs a local volume where a child camera is in the world, not at its local position', () => {
        const { api, bound } = fakeApi();
        const local = [1, { isGlobal: false, shape: 0, size: { x: 4, y: 4, z: 4 }, blendDistance: 0, priority: 0, weight: 1, effects: [vignette] }, at(50, 0, 0)];
        // An eye 0.7 above its player, the player standing inside the volume at x = 50.
        run(api, [local], [[10, camera(3), at(0, 0.7, 0, { x: 50, y: 0.7, z: 0 })]]);
        expect(bound.has(10)).toBe(true);
    });
});
