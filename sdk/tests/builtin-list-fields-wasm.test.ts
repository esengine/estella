// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A builtin's list fields read back as arrays on every read path.
 *
 * Embind hands a `std::vector` field back as a heap object. emsdk 5 makes it
 * iterable, 4.0.10 does not, and neither frees it: `tryGet(Children)` returned
 * one, so the animator threw every frame on the WeChat GLX engine and leaked a
 * vector per joint per frame on every other. Requires build/wasm/web.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '../src/ecs/world';
import { Children } from '../src/ecs/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('builtin list fields', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('come back as arrays from get, tryGet and a resolved getter', () => {
        const registry = new module.Registry() as unknown as CppRegistry;
        const world = new World();
        world.connectCpp(registry, module);
        const parent = world.spawn();
        const kids = [world.spawn(), world.spawn()];
        for (const k of kids) world.setParent(k, parent);

        const reads = {
            get: world.get(parent, Children).entities,
            tryGet: world.tryGet(parent, Children)!.entities,
            getter: (world.resolveGetter(Children)!(parent) as { entities: unknown }).entities,
        };
        for (const [path, entities] of Object.entries(reads)) {
            expect(Array.isArray(entities), path).toBe(true);
            expect([...(entities as number[])].sort(), path).toEqual([...kids].sort());
        }
        world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    });
});
