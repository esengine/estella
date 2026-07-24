// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Boot the real SDK ECS World over the native (embedded-Dawn) core.
//
// On web the World is connected to the wasm module's embind Registry; here it is
// connected to the native registry + memory backend, both composed from the host's
// generated bindings (createNativeRegistry / NativeMemoryProvider). The result is
// the SAME World class the web build uses — spawn / insert / get / query / parent
// authoring runs in the JS engine, writing the native C++ ECS, which the native
// host renders. No wasm module: entity generations fall back to World's JS path.

import { App } from '../app';
import { World } from '../world';
import { inputPlugin } from '../input';
import { ensureBuiltinComponentsRegistered } from '../component';
import { installNativePlatform, type NativeBridge } from '../platform/native';
import { createNativeRegistry } from './nativeRegistry';
import { NativeMemoryProvider } from './memoryProvider';

/**
 * Create a World bound to the native core. `scope` is where the host installed its
 * bindings (the QuickJS global object on a device; a plain object in tests). The
 * returned World is the real SDK World — the game script authors entities and
 * components through it, and the native host reads the resulting ECS each frame.
 */
export function createNativeWorld(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): World {
    // Idempotent: register every engine component so a scene can't silently drop one
    // (the native entry does this too, but keep the boot self-contained for hosts /
    // tests that call this directly).
    ensureBuiltinComponentsRegistered();

    const world = new World();
    world.connectCpp(createNativeRegistry(scope), undefined, {
        memory: new NativeMemoryProvider(scope),
    });
    return world;
}

/**
 * Boot a native App — the SAME App class the web build uses, over the native core
 * and the native platform. This is the system-binding layer on top of the ECS
 * (Stage B): `installNativePlatform(bridge)` routes the SDK's platform (input, and
 * later assets / audio) to the host's `NativeBridge`; the app runs the standard
 * plugins (input to start) against native ECS. No wasm module and no render plugin
 * — the native C++ host owns rendering and reads the ECS the app authors.
 *
 * The game authors through `app.world` and reads resources like `Input`; drive it
 * with `app.tick(dt)` each frame from the host loop.
 */
export function createNativeApp(
    bridge: NativeBridge,
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): App {
    ensureBuiltinComponentsRegistered();
    // Route the SDK platform to the host before any plugin builds (inputPlugin binds
    // getPlatform().bindInputEvents in build()).
    installNativePlatform(bridge);

    const app = App.new();
    app.connectCpp(createNativeRegistry(scope), undefined, {
        memory: new NativeMemoryProvider(scope),
    });
    app.addPlugin(inputPlugin);
    return app;
}
