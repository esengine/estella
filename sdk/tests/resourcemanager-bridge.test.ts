// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    resourcemanager-bridge.test.ts
 * @brief   The C++ ResourceManager embind object is guarded via WasmBridge with
 *          the main module as abort authority. Closes the last un-guarded WASM
 *          touchpoint after the F2 five-pattern unification.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WasmModuleAborted } from '../src/moduleHealth';
import {
    initResourceManager, shutdownResourceManager,
    requireResourceManager, getResourceManager,
} from '../src/resourceManager';
import type { CppResourceManager, ESEngineModule } from '../src/wasm';

function makeRm() {
    return {
        getTextureDimensions: vi.fn((h: number) => ({ width: h, height: h })),
    } as unknown as CppResourceManager;
}
function makeModule(): ESEngineModule {
    return { onAbort: undefined } as unknown as ESEngineModule;
}

describe('ResourceManager bridge', () => {
    afterEach(() => shutdownResourceManager());

    it('guards rm methods when the module is provided (production path)', () => {
        const rm = makeRm();
        const m = makeModule();
        initResourceManager(rm, m);

        expect(requireResourceManager().getTextureDimensions(4)).toEqual({ width: 4, height: 4 });

        (m as unknown as { onAbort: (w: unknown) => void }).onAbort('oom');
        let caught: unknown;
        try { requireResourceManager().getTextureDimensions(8); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('resourceManager.getTextureDimensions');
        // the dead module was not called for handle 8
        expect((rm as unknown as { getTextureDimensions: ReturnType<typeof vi.fn> })
            .getTextureDimensions).toHaveBeenCalledTimes(1);
    });

    it('keeps the raw rm when no module is passed (test/back-compat path)', () => {
        const rm = makeRm();
        initResourceManager(rm);
        // identity preserved — embind object not wrapped
        expect(getResourceManager()).toBe(rm);
    });
});
