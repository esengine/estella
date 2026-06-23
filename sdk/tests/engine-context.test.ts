// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Engine instancing N1 (REARCH_ENGINE_INSTANCING.md): EstellaContext is a
 *        JS-newable embind instance + setActiveContext routes the bindings to it.
 *
 * Requires the built WASM SDK (build/wasm/web). Skips if absent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('Engine instancing (N1): EstellaContext embind', () => {
    let module: ESEngineModule;
    beforeAll(async () => {
        module = await loadWasmModule();
    });

    it('is JS-newable and exposes its lifecycle surface', () => {
        const ctx = new module.EstellaContext();
        try {
            // Fresh context: init (which needs a GL handle) has not run.
            expect(ctx.isInitialized()).toBe(false);
            expect(typeof ctx.shutdown).toBe('function');
        } finally {
            ctx.delete();
        }
    });

    it('setActiveContext accepts an instance and null without throwing', () => {
        const ctx = new module.EstellaContext();
        try {
            expect(() => module.setActiveContext(ctx)).not.toThrow();
            // Routing works: the active context carries the logic systems its
            // constructor registers, so a UI-system-backed binding does not fault.
            // (We assert no-throw rather than a value — N3 wires real ownership.)
            expect(() => module.setActiveContext(null)).not.toThrow();
        } finally {
            // Restore the unset (headless-fallback) state before freeing, so a
            // freed context is never left active for sibling tests (N4 adds the
            // dangling-pointer guard; until then keep tests well-behaved).
            module.setActiveContext(null);
            ctx.delete();
        }
    });

    it('shutdownRenderer is null-safe when no renderer was initialized', () => {
        // app.quit() now calls this (REARCH_ENGINE_INSTANCING N3/N4). Headless —
        // nothing was ever initialized — so it must be a safe no-op, not a crash.
        expect(() => module.shutdownRenderer()).not.toThrow();
        expect(() => module.shutdownRenderer()).not.toThrow(); // idempotent
    });

    it('supports independent context instances (isolation precondition)', () => {
        const a = new module.EstellaContext();
        const b = new module.EstellaContext();
        try {
            // Two distinct JS-owned instances — the foundation for isolated
            // edit/play realms. Neither is initialized; both are independently live.
            expect(a).not.toBe(b);
            expect(a.isInitialized()).toBe(false);
            expect(b.isInitialized()).toBe(false);
        } finally {
            a.delete();
            b.delete();
        }
    });
});
