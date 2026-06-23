// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-bridge.test.ts
 * @brief   A spine side module's wrapped API (behind SpineModuleController)
 *          inherits the terminal-abort guard with no change to its call sites.
 *          The old main-module SpineCpp surface was removed in S3 — spine is
 *          now fully side-module.
 */
import { describe, it, expect, vi } from 'vitest';
import { WasmModuleAborted } from '../src/moduleHealth';
import { SpineModuleController } from '../src/spine/SpineController';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';

// ---------------------------------------------------------------------------
// SpineModuleController over a side module (api surface + raw heap).
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
