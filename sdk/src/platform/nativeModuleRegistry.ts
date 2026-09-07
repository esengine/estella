// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    nativeModuleRegistry.ts
 * @brief   The public `esengine/*` subpath namespaces, published for a native
 *          game script to resolve against THIS module graph.
 *
 *          A native build has no module loader: the exporter rewrites every
 *          `esengine` import to something already evaluated. The bare specifier
 *          binds to `globalThis.ESEngine`; a subpath binds here.
 *
 *          It has to be this graph and not a second copy. `Physics3D` is
 *          `defineResource(null, 'Physics3D')` — a JS identity, not a C++
 *          binding — and `Res` is keyed by that identity. A separately bundled
 *          `physics3d` would mint a second token, the runtime would install a
 *          resource under the first, and the game would ask for the second and
 *          be told nothing is there.
 *
 *          NOT public API. It is a non-enumerable global the packaging step
 *          resolves against, and nothing re-exports it.
 */
import * as Physics2DModule from '../physics';
import * as Physics3DModule from '../physics3d';
import * as SpineModule from '../spine';
import * as DragonBonesModule from '../dragonbones';

/** Must equal NATIVE_MODULE_REGISTRY in tools/nativeScriptModules.mjs, which is
 *  what the exporter emits and what check-native-script-modules reads. */
export const NATIVE_MODULE_REGISTRY = '__ESTELLA_NATIVE_MODULES__';

/**
 * Namespace per specifier. The keys are the specifiers a project writes, so the
 * exporter's lookup and this table are spelled the same way on both sides.
 */
export const NATIVE_MODULE_NAMESPACES: Readonly<Record<string, unknown>> = {
    'esengine/physics': Physics2DModule,
    'esengine/physics3d': Physics3DModule,
    'esengine/spine': SpineModule,
    'esengine/dragonbones': DragonBonesModule,
};

/**
 * Publish the namespaces on the global the exporter resolves against.
 *
 * Non-enumerable so it stays out of anything that walks globalThis, and
 * idempotent because a host may evaluate the bundle more than once.
 */
export function installNativeModuleRegistry(target: object = globalThis): void {
    const holder = target as Record<string, unknown>;
    if (holder[NATIVE_MODULE_REGISTRY]) return;
    Object.defineProperty(holder, NATIVE_MODULE_REGISTRY, {
        value: NATIVE_MODULE_NAMESPACES,
        enumerable: false,
        writable: false,
        configurable: true,
    });
}
