// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-bridge.test.ts
 * @brief   F2 core batch: the six core engine-module API facets (renderer /
 *          draw / material / geometry / postprocess / gl-debug) route through
 *          one shared CoreApiBridge, so each inherits the terminal-abort guard.
 *          Verified directly on CoreApiBridge and end-to-end via GLDebug.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WasmModuleAborted } from '../src/moduleHealth';
import { CoreApiBridge } from '../src/CoreApiBridge';
import { GLDebug, initGLDebugAPI, shutdownGLDebugAPI } from '../src/glDebug';
import type { ESEngineModule } from '../src/wasm';

describe('CoreApiBridge', () => {
    it('carries the per-instance label into abort diagnostics', () => {
        const bridge = new CoreApiBridge('geometry');
        const m = {
            geometry_upload: () => 0,
            onAbort: undefined as ((w: unknown) => void) | undefined,
            _malloc: () => 0,
            _free: () => {},
        } as unknown as ESEngineModule;
        bridge.connect(m);

        (m as unknown as { onAbort: (w: unknown) => void }).onAbort('oom');
        let caught: unknown;
        try { (bridge.module as unknown as { geometry_upload: () => void }).geometry_upload(); }
        catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('geometry.geometry_upload');
    });
});

describe('GLDebug (core facet end-to-end)', () => {
    afterEach(() => shutdownGLDebugAPI());

    function makeModule(): ESEngineModule {
        return {
            gl_checkErrors: (_ctx: string) => 7,
            gl_enableErrorCheck: vi.fn(),
            renderer_diagnose: vi.fn(),
            onAbort: undefined,
        } as unknown as ESEngineModule;
    }

    it('routes calls through the guard when healthy', () => {
        initGLDebugAPI(makeModule());
        expect(GLDebug.check('frame')).toBe(7);
    });

    it('refuses calls after the module aborts', () => {
        const m = makeModule();
        initGLDebugAPI(m);
        (m as unknown as { onAbort: (w: unknown) => void }).onAbort('unreachable');

        let caught: unknown;
        try { GLDebug.check('frame'); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('glDebug.gl_checkErrors');
    });

    it('falls back to 0 once disconnected', () => {
        initGLDebugAPI(makeModule());
        shutdownGLDebugAPI();
        expect(GLDebug.check('frame')).toBe(0);
    });
});
