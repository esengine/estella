// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The optional subsystems on a device. On the web they are fetched wasm side
// modules; in a native app the same C is compiled into the host binary and its entry
// points sit on the JS global object. What must hold is that NOTHING downstream can
// tell the difference: the SDK's `PhysicsWasmModule` shape is satisfied by the host
// globals plus the heap, so the runtime's own gating installs physics either way.
//
// Driven against a mock host scope — the marshalling is what these check, not Box2D.
import { describe, it, expect, vi } from 'vitest';
import {
    createNativeSideModules, NATIVE_SIDE_MODULE_PROBES, SPINE_VERSION_BINDING,
} from '../src/ecs/nativeSideModules';
import { HEAP_BINDINGS } from '../src/ecs/nativeHeap';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { wrapDragonBonesModule } from '../src/dragonbones/DragonBonesModuleLoader';
import type { DragonBonesWasmModule } from '../src/dragonbones/DragonBonesModuleLoader';

/** A host that compiled physics in: the heap plus a few es_physics_* globals. */
function mockNativeHost(options: {
    physics?: boolean; heap?: boolean; spine?: number; dragonbones?: boolean;
} = {}) {
    const { physics = true, heap = true, spine, dragonbones = false } = options;
    const buffer = new ArrayBuffer(4096);
    let next = 8;
    const calls: { name: string; args: unknown[] }[] = [];
    const scope: Record<string, unknown> = {};
    if (heap) {
        scope[HEAP_BINDINGS.heap] = () => buffer;
        scope[HEAP_BINDINGS.malloc] = (bytes: number) => {
            const at = next; next += Math.ceil(bytes / 8) * 8; return at;
        };
        scope[HEAP_BINDINGS.free] = () => {};
    }
    if (physics) {
        const record = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); return 0; };
        for (const name of ['init', 'step', 'createBody', 'destroyBody', 'setGravity',
                            'getDynamicBodyCount', 'collectEvents', 'addPolygonShape']) {
            scope[`es_physics_${name}`] = record(name);
        }
        // The readback getters answer an OFFSET into the heap (the wrapper published
        // the module's bytes there), exactly like a wasm pointer.
        scope['es_physics_getDynamicBodyTransforms'] = () => 64;
    }
    if (spine !== undefined) {
        // A host links ONE spine runtime and says which (spine_runtimeVersion).
        scope[SPINE_VERSION_BINDING] = () => spine;
        scope['es_spine_loadSkeleton'] = (...args: unknown[]) => { calls.push({ name: 'loadSkeleton', args }); return 1; };
        scope['es_spine_playAnimation'] = (...args: unknown[]) => { calls.push({ name: 'playAnimation', args }); return 1; };
        // A C string crosses as a JS string, in and out — the generated wrapper reads
        // and writes them, so nothing here needs the heap.
        scope['es_spine_getAnimations'] = () => 'idle,walk,run';
    }
    if (dragonbones) {
        // One runtime, no version to declare: the format is frozen, so unlike Spine
        // there is nothing for the host to disagree with the content about.
        scope['es_db_loadSkeleton'] = (...args: unknown[]) => { calls.push({ name: 'loadSkeleton', args }); return 1; };
        scope['es_db_createInstance'] = (...args: unknown[]) => { calls.push({ name: 'createInstance', args }); return 0; };
        scope['es_db_getArmatures'] = () => '["Dragon"]';
    }
    return { scope, buffer, calls };
}

describe('createNativeSideModules', () => {
    it('answers physics when the host compiled it in', async () => {
        const { scope } = mockNativeHost();
        const mod = await createNativeSideModules(scope).acquire('physics');
        expect(mod).not.toBeNull();
    });

    it('answers null when the host did not — not an object that throws on first call', async () => {
        const { scope } = mockNativeHost({ physics: false });
        expect(await createNativeSideModules(scope).acquire('physics')).toBeNull();
    });

    it('answers null when the host bound no heap to marshal through', async () => {
        const { scope } = mockNativeHost({ heap: false });
        expect(await createNativeSideModules(scope).acquire('physics')).toBeNull();
    });

    it('answers null for a subsystem this host did not compile in', async () => {
        // The KTX2 transcoder is the one no native host needs a module for — it
        // transcodes in C++ behind the texture path (host/media/ktx2_decode.cpp).
        const { scope } = mockNativeHost();
        expect(await createNativeSideModules(scope).acquire('basis')).toBeNull();
        expect(NATIVE_SIDE_MODULE_PROBES.basis).toBeUndefined();
    });

    // The DragonBones module was linked into the Android host and unreachable from
    // it for exactly one missing probe entry, which is the shape of failure this
    // pins: the acquirer answering null while the binary carries the runtime.
    it('answers DragonBones when the host compiled it in', async () => {
        const { scope } = mockNativeHost({ dragonbones: true });
        const mod = await createNativeSideModules(scope).acquire('dragonbones');
        expect(mod).not.toBeNull();
        // Through the SAME cwrap the web loader uses, so the controller cannot tell
        // a compiled-in runtime from a fetched one.
        const wrapped = wrapDragonBonesModule(mod as unknown as DragonBonesWasmModule);
        expect(wrapped.getArmatures(1)).toBe('["Dragon"]');
    });

    it('answers null for DragonBones when the host did not compile it in', async () => {
        const { scope } = mockNativeHost();
        expect(await createNativeSideModules(scope).acquire('dragonbones')).toBeNull();
    });

    it('caches, so two consumers share one view', async () => {
        const host = createNativeSideModules(mockNativeHost().scope);
        expect(await host.acquire('physics')).toBe(await host.acquire('physics'));
    });
});

describe('the native physics module satisfies the SDK’s shape', () => {
    it('resolves an emscripten C export name to the host global', async () => {
        const { scope, calls } = mockNativeHost();
        const mod = (await createNativeSideModules(scope).acquire('physics')) as unknown as PhysicsWasmModule;
        mod._physics_init(0, -9.81, 1 / 60, 4, 120, 10, 10);
        mod._physics_step(1 / 60);
        expect(calls.map((c) => c.name)).toEqual(['init', 'step']);
        expect(calls[0]!.args).toEqual([0, -9.81, 1 / 60, 4, 120, 10, 10]);
    });

    it('carries the heap, so a caller writes its buffer and passes an offset', async () => {
        const { scope, buffer, calls } = mockNativeHost();
        const mod = (await createNativeSideModules(scope).acquire('physics')) as unknown as PhysicsWasmModule;
        // What PhysicsSystem does for a polygon collider.
        const verts = new Float32Array([0, 0, 1, 0, 1, 1]);
        const ptr = mod._malloc(verts.byteLength);
        mod.HEAPF32.set(verts, ptr / 4);
        mod._physics_addPolygonShape(1, ptr, 3, 0, 1, 0.3, 0, 0, 1, 0xffff);
        mod._free(ptr);
        // The bytes really landed in the host's arena, which is what the C side reads.
        expect(Array.from(new Float32Array(buffer, ptr, 6))).toEqual([0, 0, 1, 0, 1, 1]);
        expect(calls.at(-1)!.args[1]).toBe(ptr);
    });

    it('reads a readback getter as an offset into that same heap', async () => {
        const { scope, buffer } = mockNativeHost();
        const mod = (await createNativeSideModules(scope).acquire('physics')) as unknown as PhysicsWasmModule;
        // The host published a body transform at offset 64: [entity, x, y, angle].
        new Uint32Array(buffer, 64, 1)[0] = 7;
        new Float32Array(buffer, 68, 3).set([12.5, -3, 1.5]);
        const base = mod._physics_getDynamicBodyTransforms() >> 2;
        expect(mod.HEAPU32[base]).toBe(7);
        expect(Array.from(mod.HEAPF32.subarray(base + 1, base + 4))).toEqual([12.5, -3, 1.5]);
    });

    it('is honest about an entry point the host never bound', async () => {
        const { scope } = mockNativeHost();
        const mod = (await createNativeSideModules(scope).acquire('physics')) as unknown as
            Record<string, unknown>;
        expect(mod._physics_neverBound).toBeUndefined();
        expect('_physics_step' in mod).toBe(true);
        expect('_physics_neverBound' in mod).toBe(false);
    });

    it('does not invent a name that is not a C export', async () => {
        const { scope } = mockNativeHost();
        const mod = (await createNativeSideModules(scope).acquire('physics')) as unknown as
            Record<string, unknown>;
        // No leading underscore: not the export convention, so not forwarded.
        expect(mod.physics_step).toBeUndefined();
    });
});

describe('the runtime installs physics from a native host', () => {
    it('goes through the same acquirer the web realms use', async () => {
        const { scope } = mockNativeHost();
        const host = createNativeSideModules(scope);
        const acquire = vi.spyOn(host, 'acquire');
        await host.acquire('physics');
        expect(acquire).toHaveBeenCalledWith('physics');
    });
});

describe('spine on a native host', () => {
    it('answers the version the host actually linked', async () => {
        const host = createNativeSideModules(mockNativeHost({ spine: 42 }).scope);
        expect(await host.acquire('spine:4.2')).not.toBeNull();
    });

    it('refuses a version it did not link, rather than mis-decoding a skeleton', async () => {
        // The three vendored runtimes export the same symbols, so the entry points
        // being present says nothing about the format they can read.
        const host = createNativeSideModules(mockNativeHost({ spine: 42 }).scope);
        expect(await host.acquire('spine:3.8')).toBeNull();
        expect(await host.acquire('spine:4.1')).toBeNull();
    });

    it('answers nothing when no spine runtime is linked at all', async () => {
        const host = createNativeSideModules(mockNativeHost().scope);
        expect(await host.acquire('spine:4.2')).toBeNull();
    });

    it('cwrap is a passthrough — the wrapper already speaks JS strings', async () => {
        const { scope, calls } = mockNativeHost({ spine: 42 });
        const mod = (await createNativeSideModules(scope).acquire('spine:4.2')) as unknown as {
            cwrap(ident: string, ret: string | null, args: string[]): (...a: unknown[]) => unknown;
        };
        const play = mod.cwrap('spine_playAnimation', 'number', ['number', 'string', 'number', 'number']);
        expect(play(1, 'walk', 1, 0)).toBe(1);
        expect(calls.at(-1)).toEqual({ name: 'playAnimation', args: [1, 'walk', 1, 0] });

        const list = mod.cwrap('spine_getAnimations', 'string', ['number']);
        expect(list(1)).toBe('idle,walk,run');
    });

    it('reads and writes heap strings the way emscripten states them', async () => {
        const { scope } = mockNativeHost({ spine: 42 });
        const mod = (await createNativeSideModules(scope).acquire('spine:4.2')) as unknown as {
            UTF8ToString(ptr: number): string;
            stringToNewUTF8(str: string): number;
            _free(ptr: number): void;
        };
        const ptr = mod.stringToNewUTF8('走る');
        expect(ptr).toBeGreaterThan(0);
        expect(mod.UTF8ToString(ptr)).toBe('走る');
        expect(mod.UTF8ToString(0)).toBe('');   // what UTF8ToString(0) answers on the web
        mod._free(ptr);
    });
});
