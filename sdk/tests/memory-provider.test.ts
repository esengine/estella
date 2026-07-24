// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    memory-provider.test.ts
 * @brief   The fast-path memory backend seam. The generated ptrAccessors are the
 *          one marshalling path; only where the heap views come from differs by
 *          backend. These tests drive resolvePtrSetter/Getter through both:
 *            * WasmMemoryProvider  — whole wasm HEAP + a per-entity byte offset;
 *            * NativeMemoryProvider — a zero-copy ArrayBuffer over one native
 *              component (the host's es_<Component>_buffer), offset 0.
 *          The parity test proves both write byte-identical component memory for
 *          the same input — the crux of "one SDK, two backends". No device.
 */
import { describe, expect, it } from 'vitest';
import { BuiltinBridge } from '../src/ecs/BuiltinBridge';
import { NativeMemoryProvider } from '../src/ecs/memoryProvider';
import { PTR_LAYOUTS } from '../src/ptrLayouts.generated';
import { PTR_ACCESSORS } from '../src/ecs/ptrAccessors.generated';
import type { CppRegistry, ESEngineModule } from '../src/wasm';

const CPP = 'Sprite';
const layout = PTR_LAYOUTS[CPP];
const accessor = PTR_ACCESSORS[CPP];

// resolvePtr* never call registry methods, so any non-null value is enough.
const REG = {} as unknown as CppRegistry;

// A byte window comfortably larger than a Sprite (~92 B), used as both the native
// component buffer and the web heap slot so the two are directly comparable.
const SLOT = 256;

/** Representative data spanning color / vec2 / bool, over the generated defaults.
 *  Values are exactly representable in f32 so the stored-and-read round-trip is
 *  exact (component fields are f32; e.g. 0.1 would round). */
function sampleData(): Record<string, unknown> {
    const d = accessor.create() as Record<string, unknown>;
    d.color = { r: 0.5, g: 0.25, b: 0.125, a: 1 };
    d.size = { x: 12, y: 34 };
    d.lit = true;
    return d;
}

/** A fake ESEngineModule: HEAP views over `heap` + the wasm ptr export returning
 *  a fixed byte offset for the (single) test entity. */
function wasmModule(heap: ArrayBuffer, offset: number): ESEngineModule {
    return {
        HEAPF32: new Float32Array(heap),
        HEAPU32: new Uint32Array(heap),
        HEAPU8: new Uint8Array(heap),
        [layout.ptrFn]: (_reg: unknown, _e: number) => offset,
    } as unknown as ESEngineModule;
}

describe('MemoryProvider', () => {
    it('has the Sprite fixture (layout + accessor)', () => {
        expect(layout).toBeDefined();
        expect(accessor).toBeDefined();
    });

    it('WasmMemoryProvider (derived from module) writes/reads at the entity ptr offset', () => {
        const heap = new ArrayBuffer(1024);
        const offset = SLOT;                    // pretend the component lives here
        const bridge = new BuiltinBridge();
        bridge.connect(REG, wasmModule(heap, offset));

        const set = bridge.resolvePtrSetter(CPP);
        const get = bridge.resolvePtrGetter(CPP);
        expect(set).toBeTypeOf('function');
        expect(get).toBeTypeOf('function');

        const data = sampleData();
        set!(1, data);
        const read = get!(1) as Record<string, unknown>;
        expect(read.color).toEqual(data.color);
        expect(read.size).toEqual(data.size);
        expect(read.lit).toBe(true);

        // Wrote at the offset, not at 0.
        expect([...new Uint8Array(heap, 0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('NativeMemoryProvider round-trips through es_<C>_buffer with the same accessors', () => {
        const comp = new ArrayBuffer(SLOT);      // one native Sprite component
        const scope = { [`es_${CPP}_buffer`]: (_e: number) => comp };
        const bridge = new BuiltinBridge();
        bridge.connect(REG, undefined, { memory: new NativeMemoryProvider(scope) });

        const set = bridge.resolvePtrSetter(CPP);
        const get = bridge.resolvePtrGetter(CPP);
        expect(set).toBeTypeOf('function');

        const data = sampleData();
        set!(7, data);
        const read = get!(7) as Record<string, unknown>;
        expect(read.color).toEqual(data.color);
        expect(read.size).toEqual(data.size);
        expect(read.lit).toBe(true);
    });

    it('web and native backends write byte-identical component memory', () => {
        const data = sampleData();

        // web: component at offset SLOT within a larger heap.
        const heap = new ArrayBuffer(SLOT * 2);
        const web = new BuiltinBridge();
        web.connect(REG, wasmModule(heap, SLOT));
        web.resolvePtrSetter(CPP)!(1, data);
        const webBytes = [...new Uint8Array(heap, SLOT, SLOT)];

        // native: component at offset 0 of its own buffer.
        const comp = new ArrayBuffer(SLOT);
        const native = new BuiltinBridge();
        native.connect(REG, undefined, {
            memory: new NativeMemoryProvider({ [`es_${CPP}_buffer`]: () => comp }),
        });
        native.resolvePtrSetter(CPP)!(1, data);
        const nativeBytes = [...new Uint8Array(comp)];

        expect(nativeBytes).toEqual(webBytes);
    });

    it('NativeMemoryProvider skips an entity with no live component (nullish buffer)', () => {
        const scope = { [`es_${CPP}_buffer`]: (_e: number) => null };
        const bridge = new BuiltinBridge();
        bridge.connect(REG, undefined, { memory: new NativeMemoryProvider(scope) });
        const get = bridge.resolvePtrGetter(CPP);
        expect(get).toBeTypeOf('function');
        expect(get!(1)).toBeNull();               // no throw, no read
    });

    it('no module and no memory override => no fast path (unchanged web fallback)', () => {
        const bridge = new BuiltinBridge();
        bridge.connect(REG);                      // no module, no memory
        expect(bridge.resolvePtrSetter(CPP)).toBeNull();
        expect(bridge.resolvePtrGetter(CPP)).toBeNull();
        expect(bridge.resolvePtrFn(CPP)).toBeNull();
    });

    it('disconnect tears down the fast path', () => {
        const comp = new ArrayBuffer(SLOT);
        const bridge = new BuiltinBridge();
        bridge.connect(REG, undefined, {
            memory: new NativeMemoryProvider({ [`es_${CPP}_buffer`]: () => comp }),
        });
        expect(bridge.resolvePtrSetter(CPP)).toBeTypeOf('function');
        bridge.disconnect();
        expect(bridge.resolvePtrSetter(CPP)).toBeNull();
    });
});
