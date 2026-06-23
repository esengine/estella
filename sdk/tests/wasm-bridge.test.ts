// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wasm-bridge.test.ts
 * @brief   The single SDK→WASM bridge base class: it installs the terminal-abort
 *          guard once and hands back a guarded module view in which every
 *          function call refuses to touch a dead module — while HEAP views and
 *          the allocator pass straight through.
 */
import { describe, it, expect, vi } from 'vitest';
import { WasmBridge } from '../src/WasmBridge';
import { WasmModuleAborted, isModuleAborted } from '../src/moduleHealth';
import { withMalloc } from '../src/wasmScratch';
import { PhysicsBridge } from '../src/physics/PhysicsBridge';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';

// ---------------------------------------------------------------------------
// A tiny module that looks like an emscripten module: some callable exports,
// HEAP views, an allocator, and an emscripten-style onAbort hook.
// ---------------------------------------------------------------------------
interface TestModule {
    add(a: number, b: number): number;
    boom(): number;
    HEAPF32: Float32Array;
    freed: number[];
    onAbort?: (what: unknown) => void;
    _malloc(size: number): number;
    _free(ptr: number): void;
}

function makeModule(): TestModule {
    const heap = new Float32Array(16);
    const m: TestModule = {
        add: (a, b) => a + b,
        // Aborts mid-call (flips the dead flag via onAbort), then throws raw.
        boom() {
            this.onAbort?.('memory access out of bounds');
            throw new Error('raw failure');
        },
        HEAPF32: heap,
        freed: [],
        _malloc: (size: number) => size,        // pretend ptr === size
        _free(ptr: number) { this.freed.push(ptr); },
    };
    return m;
}

class TestBridge extends WasmBridge<TestModule> {
    protected readonly label = 'test';
}

describe('WasmBridge base', () => {
    it('throws on module access before connect', () => {
        const b = new TestBridge();
        expect(b.connected).toBe(false);
        expect(() => b.module).toThrow(/not connected/);
        expect(b.raw).toBeNull();
    });

    it('passes healthy function calls straight through', () => {
        const b = new TestBridge();
        b.connect(makeModule());
        expect(b.connected).toBe(true);
        expect(b.module.add(2, 3)).toBe(5);
    });

    it('installs the abort guard on connect', () => {
        const b = new TestBridge();
        const m = makeModule();
        b.connect(m);
        expect(isModuleAborted(m)).toBe(false);
        m.onAbort!('OOM');
        expect(isModuleAborted(m)).toBe(true);
    });

    it('short-circuits guarded calls after an abort (pre-check)', () => {
        const b = new TestBridge();
        const m = makeModule();
        b.connect(m);
        m.onAbort!('OOM');

        let caught: unknown;
        try { b.module.add(1, 2); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('test.add');
    });

    it('surfaces an abort that happens DURING a call as WasmModuleAborted', () => {
        const b = new TestBridge();
        b.connect(makeModule());

        let caught: unknown;
        try { b.module.boom(); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        // original raw error is preserved as the cause
        expect((caught as { cause?: Error }).cause).toBeInstanceOf(Error);
        expect(((caught as { cause?: Error }).cause as Error).message).toBe('raw failure');
    });

    it('passes HEAP views through live (re-read each access)', () => {
        const b = new TestBridge();
        const m = makeModule();
        b.connect(m);
        b.module.HEAPF32[0] = 42;
        expect(m.HEAPF32[0]).toBe(42);

        // Emulate ALLOW_MEMORY_GROWTH replacing the heap: the guarded view must
        // see the new array, not a cached one.
        const grown = new Float32Array(32);
        grown[0] = 7;
        m.HEAPF32 = grown;
        expect(b.module.HEAPF32[0]).toBe(7);
    });

    it('leaves _malloc/_free unguarded so withScratch can free after an abort', () => {
        const b = new TestBridge();
        const m = makeModule();
        b.connect(m);

        // A scratch whose body aborts the module: the op throws, but the
        // finally still frees through the unguarded allocator.
        expect(() => withMalloc(b.module, 8, () => {
            b.module.boom();
        })).toThrow(WasmModuleAborted);
        expect(m.freed).toEqual([8]); // freed despite the abort
    });

    it('disconnect unbinds the module', () => {
        const b = new TestBridge();
        b.connect(makeModule());
        b.disconnect();
        expect(b.connected).toBe(false);
        expect(() => b.module).toThrow(/not connected/);
    });
});

// ---------------------------------------------------------------------------
// Physics sample: the first subsystem migrated onto the bridge. A minimal fake
// physics module verifies that `_physics_*` calls inherit the abort guard with
// zero changes to the ~60 existing call sites.
// ---------------------------------------------------------------------------
function makePhysicsModule(): PhysicsWasmModule {
    const heap = new Float32Array(16);
    const fake = {
        steps: 0,
        _physics_step(_dt: number) { (this as { steps: number }).steps++; },
        _physics_getGravity: () => 0,
        HEAPF32: heap,
        HEAPU8: new Uint8Array(64),
        HEAPU32: new Uint32Array(16),
        _malloc: (size: number) => size,
        _free: vi.fn(),
        onAbort: undefined as ((what: unknown) => void) | undefined,
    };
    return fake as unknown as PhysicsWasmModule;
}

describe('PhysicsBridge (F2 sample)', () => {
    it('routes _physics_* calls through the guard', () => {
        const bridge = new PhysicsBridge();
        const m = makePhysicsModule();
        bridge.connect(m);

        bridge.module._physics_step(1 / 60);
        bridge.module._physics_step(1 / 60);
        expect((m as unknown as { steps: number }).steps).toBe(2);
    });

    it('refuses _physics_* calls after the physics module aborts', () => {
        const bridge = new PhysicsBridge();
        const m = makePhysicsModule();
        bridge.connect(m);

        // Emscripten fires onAbort on the standalone physics module.
        (m as unknown as { onAbort: (w: unknown) => void }).onAbort('unreachable');

        let caught: unknown;
        try { bridge.module._physics_step(1 / 60); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('physics._physics_step');
        // the dead module was NOT stepped again
        expect((m as unknown as { steps: number }).steps).toBe(0);
    });
});
