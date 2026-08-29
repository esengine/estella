// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fakeSpineModule.ts
 * @brief   One spine version's wasm module, faked at the ABI.
 *
 * @details A runtime builds its own ABI adapter from a module, so this is the
 *          seam a test drives it through — the same one production uses. What it
 *          reports is what the native side was actually told: which skeletons
 *          are parsed and which instances exist, right now.
 */
import { vi } from 'vitest';
import type { SpineWasmModule } from '../../src/spine/SpineModuleLoader';
import type { SpineEraBinding } from '../../src/spine/prepareSpine';

export interface FakeSpineModule {
    module: SpineWasmModule;
    /** Live native state, as the fake sees it. */
    skeletons: number[];
    instances: number[];
    /** Set false to make the next parse fail, as a bad skeleton document would. */
    parses: boolean;
    loadSkeleton: ReturnType<typeof vi.fn>;
    unloadSkeleton: ReturnType<typeof vi.fn>;
    createInstance: ReturnType<typeof vi.fn>;
    destroyInstance: ReturnType<typeof vi.fn>;
}

export function fakeSpineModule(): FakeSpineModule {
    let nextSkeleton = 1;
    let nextInstance = 1000;
    const fake = {
        skeletons: [] as number[],
        instances: [] as number[],
        parses: true,
    } as FakeSpineModule;

    fake.loadSkeleton = vi.fn(() => {
        if (!fake.parses) return -1;
        const handle = nextSkeleton++;
        fake.skeletons.push(handle);
        return handle;
    });
    fake.unloadSkeleton = vi.fn((handle: number) => {
        const at = fake.skeletons.indexOf(handle);
        if (at >= 0) fake.skeletons.splice(at, 1);
    });
    fake.createInstance = vi.fn(() => {
        const id = nextInstance++;
        fake.instances.push(id);
        return id;
    });
    fake.destroyInstance = vi.fn((id: number) => {
        const at = fake.instances.indexOf(id);
        if (at >= 0) fake.instances.splice(at, 1);
    });

    const exports: Record<string, (...args: never[]) => unknown> = {
        spine_loadSkeleton: fake.loadSkeleton as never,
        spine_unloadSkeleton: fake.unloadSkeleton as never,
        spine_createInstance: fake.createInstance as never,
        spine_destroyInstance: fake.destroyInstance as never,
        spine_getLastError: () => 'the fake refused to parse',
        spine_getAtlasPageCount: () => 0,
        spine_getMeshBatchCount: () => 0,
    };
    fake.module = {
        cwrap: (name: string) => exports[name] ?? (() => 0),
        _malloc: () => 0,
        _free: () => {},
        HEAPU8: new Uint8Array(4096),
        HEAPF32: new Float32Array(1024),
        HEAP32: new Int32Array(1024),
        HEAPU32: new Uint32Array(1024),
        HEAPU16: new Uint16Array(1024),
    } as never;
    return fake;
}

/** A prepared era with nothing behind it: what a runtime binds an entity to. */
export function fakeSpineEra(
    id: string, skelData: Uint8Array | string = new Uint8Array([1]),
): SpineEraBinding & { claims: { retained: number; released: number } } {
    const claims = { retained: 0, released: 0 };
    return {
        id,
        claims,
        value: {
            skelData, atlasText: '', isBinary: typeof skelData !== 'string',
            textures: new Map(),
        },
        retain: () => {
            claims.retained++;
            return { release: () => { claims.released++; } };
        },
    };
}
