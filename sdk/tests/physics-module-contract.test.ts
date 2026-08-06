// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The physics plugin checks that the wasm answers to the interface.
 *
 * `PhysicsWasmModule` is a TypeScript interface and therefore gone at run time.
 * A `physics.wasm` built before the JS that drives it installed happily and then
 * threw `_physics_capturePoses is not a function` twice a frame for the length
 * of the session — for anyone who put a RigidBody in a scene and pressed Play.
 */
import { describe, it, expect, vi } from 'vitest';
import { PhysicsPlugin } from '../src/physics/PhysicsPlugin';
import type { App } from '../src/app/app';

/** Everything the plugin touches before it would reach the module. */
function fakeApp(): App & { errors: string[] } {
    const errors: string[] = [];
    const resources = new Map<unknown, unknown>();
    return {
        errors,
        insertResource: (def: unknown, value: unknown) => { resources.set(def, value); },
        getResource: (def: unknown) => resources.get(def) ?? {},
        subsystems: {
            transition: () => {},
            markError: (_name: string, message: string) => { errors.push(message); },
        },
        setFixedTimestep: () => {},
        world: { getAllEntities: () => [] },
        addSystem: () => {},
    } as unknown as App & { errors: string[] };
}

const EVERY_EXPORT = [
    '_physics_init', '_physics_setWorldConfig', '_physics_step',
    '_physics_capturePoses', '_physics_getInterpolatedCount', '_physics_getInterpolatedTransforms',
    '_physics_collectEvents', '_physics_getDynamicBodyCount', '_physics_getDynamicBodyTransforms',
    '_physics_setBodyTransform',
];

const moduleWith = (names: readonly string[]): Record<string, unknown> =>
    Object.fromEntries(names.map((n) => [n, vi.fn()]));

/** Let the plugin's init promise settle. */
const settle = () => new Promise((r) => { setTimeout(r, 0); });

describe('the physics plugin against a stale wasm', () => {
    it('refuses a module missing the frame loop it will call, and names what is missing', async () => {
        const stale = moduleWith(EVERY_EXPORT.filter((n) => !n.includes('Interpolated') && n !== '_physics_capturePoses'));
        const app = fakeApp();
        new PhysicsPlugin('', {}, async () => stale as never).build(app);
        await settle();

        expect(app.errors).toHaveLength(1);
        expect(app.errors[0]).toContain('_physics_capturePoses');
        expect(app.errors[0]).toContain('out of date');
        // The point of throwing rather than warning: nothing was initialised, so
        // no system runs that would throw again on every tick.
        expect(stale._physics_init).not.toHaveBeenCalled();
    });

    it('lets a module that answers to the whole contract through', async () => {
        const good = moduleWith(EVERY_EXPORT);
        const app = fakeApp();
        new PhysicsPlugin('', {}, async () => good as never).build(app);
        await settle();

        expect(app.errors.filter((e) => e.includes('out of date'))).toHaveLength(0);
        expect(good._physics_init).toHaveBeenCalled();
    });
});
