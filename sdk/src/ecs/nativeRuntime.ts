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

import { World } from '../world';
import { ensureBuiltinComponentsRegistered } from '../component';
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
