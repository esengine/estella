/**
 * @file    spine-bridge.test.ts
 * @brief   F2 spine migration: both spine WASM surfaces (the main-module
 *          `spine_*` exports behind SpineCpp, and a side module's wrapped API
 *          behind SpineModuleController) inherit the terminal-abort guard with
 *          no change to their call sites.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WasmModuleAborted } from '../src/moduleHealth';
import {
    SpineCpp, initSpineCppAPI, shutdownSpineCppAPI,
} from '../src/spine/SpineCppAPI';
import { SpineModuleController } from '../src/spine/SpineController';
import type { ESEngineModule } from '../src/wasm';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';

// ---------------------------------------------------------------------------
// Surface 1: SpineCpp over the main engine module's spine_* exports.
// ---------------------------------------------------------------------------
function makeMainModule(over: Record<string, unknown> = {}): ESEngineModule {
    return {
        spine_play: (_e: number, _a: string, _l: boolean, _t: number) => true,
        spine_setSkin: (_e: number, _s: string) => true,
        onAbort: undefined,
        ...over,
    } as unknown as ESEngineModule;
}

describe('SpineCpp (main-module surface)', () => {
    afterEach(() => shutdownSpineCppAPI());

    it('calls spine_* through the guard when healthy', () => {
        initSpineCppAPI(makeMainModule());
        expect(SpineCpp.play(0 as never, 'walk')).toBe(true);
    });

    it('refuses spine_* calls after the module aborts', () => {
        const m = makeMainModule();
        initSpineCppAPI(m);
        (m as unknown as { onAbort: (w: unknown) => void }).onAbort('unreachable');

        let caught: unknown;
        try { SpineCpp.play(0 as never, 'walk'); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('spine.spine_play');
    });

    it('keeps missing-binding tolerance (absent export → fallback, not throw)', () => {
        // Module without spine_setSkin: optional chaining still yields the
        // `?? false` fallback rather than throwing.
        initSpineCppAPI(makeMainModule({ spine_setSkin: undefined }));
        expect(SpineCpp.setSkin(0 as never, 'armor')).toBe(false);
    });

    it('returns fallbacks once disconnected', () => {
        initSpineCppAPI(makeMainModule());
        shutdownSpineCppAPI();
        expect(SpineCpp.play(0 as never, 'walk')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Surface 2: SpineModuleController over a side module (api surface + raw heap).
// ---------------------------------------------------------------------------
function makeRaw(): SpineWasmModule {
    return {
        HEAPF32: new Float32Array(64),
        HEAPU8: new Uint8Array(256),
        HEAPU32: new Uint32Array(64),
        _malloc: () => 16,        // non-zero ptr so withScratch tracks/frees it
        _free: vi.fn(),
        onAbort: undefined,
        cwrap: () => () => 0,
        UTF8ToString: () => '',
        stringToNewUTF8: () => 0,
    } as unknown as SpineWasmModule;
}

function makeApi(): SpineWrappedAPI {
    return {
        playAnimation: vi.fn(() => 1),
        getBounds: vi.fn(),
    } as unknown as SpineWrappedAPI;
}

describe('SpineModuleController (side-module surface)', () => {
    it('routes api calls through the guard when healthy', () => {
        const api = makeApi();
        const c = new SpineModuleController(makeRaw(), api);
        expect(c.play(0, 'walk')).toBe(true);
        expect(api.playAnimation).toHaveBeenCalledOnce();
    });

    it('refuses api calls after the side module aborts', () => {
        const raw = makeRaw();
        const api = makeApi();
        const c = new SpineModuleController(raw, api);

        (raw as unknown as { onAbort: (w: unknown) => void }).onAbort('oom');

        let caught: unknown;
        try { c.play(0, 'walk'); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('spine.playAnimation');
        // the dead module was never actually called
        expect(api.playAnimation).not.toHaveBeenCalled();
    });

    it('frees scratch through the raw allocator even when a guarded call aborts', () => {
        const raw = makeRaw();
        const c = new SpineModuleController(raw, makeApi());
        (raw as unknown as { onAbort: (w: unknown) => void }).onAbort('oom');

        // getBounds allocates via raw._malloc then calls api.getBounds (guarded,
        // now throwing): the withMalloc finally must still free.
        expect(() => c.getBounds(0)).toThrow(WasmModuleAborted);
        expect((raw as unknown as { _free: ReturnType<typeof vi.fn> })._free)
            .toHaveBeenCalledWith(16);
    });
});
