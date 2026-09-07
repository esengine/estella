// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  native-module-identity.test.ts — a subpath a native game imports and
 *        the graph the runtime installs from are ONE module.
 *
 * `Res` is keyed by identity, so a separately bundled `esengine/physics3d`
 * mints a second `Physics3D`: the runtime installs a resource under the first,
 * the game asks with the second, and the two halves miss each other with no
 * error anywhere. `Physics3D !== undefined` cannot see that — the last case
 * here is the sabotage, and it is what makes the assertion above mean something.
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { defineResource } from '../src/ecs/resource';
import { Physics3D } from '../src/physics3d/Physics3DPlugin';
import { Physics2D } from '../src/physics/Physics2DPlugin';
import { Spine } from '../src/spine/SpinePlugin';
import {
    NATIVE_MODULE_NAMESPACES, NATIVE_MODULE_REGISTRY, installNativeModuleRegistry,
} from '../src/platform/nativeModuleRegistry';

/** What a packaged game script gets for `import … from '<specifier>'`. */
const imported = (specifier: string): Record<string, unknown> =>
    NATIVE_MODULE_NAMESPACES[specifier] as Record<string, unknown>;

describe('native subpath modules resolve to this graph', () => {
    it('publishes a namespace for every subpath a project may import', () => {
        expect(Object.keys(NATIVE_MODULE_NAMESPACES).sort()).toEqual([
            'esengine/dragonbones', 'esengine/physics', 'esengine/physics3d', 'esengine/spine',
        ]);
    });

    it('carries the exports the core namespace does not', () => {
        // The four that made this a bug rather than a tidy-up: `Physics3D` is what
        // third-person-3d imports, and it is absent from the core global.
        expect(imported('esengine/physics3d').Physics3D).toBeDefined();
        expect(imported('esengine/physics3d').Physics3DPlugin).toBeDefined();
        expect(imported('esengine/spine').formatSpineDiagnostics).toBeDefined();
        expect(imported('esengine/physics').physics2dPlugin).toBeDefined();
    });

    it('hands back the SAME token the plugins define, not a copy of one', () => {
        expect(imported('esengine/physics3d').Physics3D).toBe(Physics3D);
        expect(imported('esengine/physics').Physics2D).toBe(Physics2D);
        expect(imported('esengine/spine').Spine).toBe(Spine);
    });

    it('installs a non-enumerable global, once', () => {
        const host: Record<string, unknown> = {};
        installNativeModuleRegistry(host);
        installNativeModuleRegistry(host);
        expect(host[NATIVE_MODULE_REGISTRY]).toBe(NATIVE_MODULE_NAMESPACES);
        expect(Object.keys(host)).toEqual([]);
        expect(Object.getOwnPropertyDescriptor(host, NATIVE_MODULE_REGISTRY)?.enumerable).toBe(false);
    });
});

describe('identity, which is the whole point', () => {
    it('a resource installed by the runtime is found by the token a game imported', () => {
        const app = new App();
        // What installing physics3d does, reduced to the part identity depends on.
        app.insertResource(Physics3D, null);

        const asTheGameImportsIt = imported('esengine/physics3d').Physics3D as typeof Physics3D;
        expect(app.hasResource(asTheGameImportsIt)).toBe(true);
    });

    it('a second bundle of the same module is NOT found — the failure this prevents', () => {
        const app = new App();
        app.insertResource(Physics3D, null);

        // Byte-for-byte what Physics3DPlugin.ts declares. Same name, same default,
        // different object — which is all a separately bundled subpath would be.
        const rival = defineResource<unknown>(null, 'Physics3D');
        expect(app.hasResource(rival)).toBe(false);
        expect(rival).not.toBe(Physics3D);
    });
});
