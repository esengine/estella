// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  native-module-identity.test.ts — a subpath a native game imports and
 *        the graph the runtime installs from are ONE module.
 *
 * A separately bundled `esengine/physics3d` mints a second `Physics3D`, and
 * everything it carries is then a second copy: the plugin, the queries object,
 * the bridge to the module. The RESOURCE token survives that — identity is
 * interned by name (resource.ts) — but nothing else does, so the namespace still
 * has to hand back this graph's exports rather than a rival's.
 * `Physics3D !== undefined` cannot see any of it; the last cases here are the
 * sabotage, and they are what make the assertions above mean something.
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { MODULES } from '../../tools/nativeScriptModules.js';
import { defineResource } from '../src/ecs/resource';
import { Physics3D, Physics3DPlugin } from '../src/physics3d/Physics3DPlugin';
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
        // From the dispositions rather than a list kept here: a subpath added to
        // one and not the other resolves to nothing on a device, and a hand-kept
        // copy is the thing that goes stale.
        const owed = Object.entries(MODULES)
            .filter(([, m]) => m.disposition === 'native-subpath')
            .map(([specifier]) => specifier).sort();
        expect(Object.keys(NATIVE_MODULE_NAMESPACES).sort()).toEqual(owed);
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
        const app = App.new();
        // What installing physics3d does, reduced to the part identity depends on.
        app.insertResource(Physics3D, null);

        const asTheGameImportsIt = imported('esengine/physics3d').Physics3D as typeof Physics3D;
        expect(app.hasResource(asTheGameImportsIt)).toBe(true);
    });

    it('a second bundle of the same module still addresses the one slot', () => {
        const app = App.new();
        app.insertResource(Physics3D, null);

        // Byte-for-byte what Physics3DPlugin.ts declares: same name, different
        // object — a separately bundled subpath, and equally a hot reload.
        const rival = defineResource<unknown>(null, 'Physics3D');
        expect(rival).not.toBe(Physics3D);
        expect(app.hasResource(rival)).toBe(true);
    });

    it('and a DIFFERENT name is a different slot — the sabotage', () => {
        const app = App.new();
        app.insertResource(Physics3D, null);
        expect(app.hasResource(defineResource<unknown>(null, 'Physics3DRival'))).toBe(false);
    });

    it('but the namespace must still hand back THIS graph\'s plugin, not a rival\'s', () => {
        // The name rescues the resource TOKEN and nothing else: a rival bundle's
        // plugin would install a rival's queries against a rival's wasm module,
        // and no name anywhere would reconcile the two.
        expect(imported('esengine/physics3d').Physics3DPlugin).toBe(Physics3DPlugin);
    });
});
