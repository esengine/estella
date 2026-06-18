/**
 * @file    module-health.test.ts
 * @brief   The WASM terminal-abort error channel: a module abort flips a dead
 *          flag and boundary calls refuse to run rather than touching a corpse.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    WasmModuleAborted, markModuleAborted, isModuleAborted,
    throwIfModuleAborted, installAbortGuard,
} from '../src/moduleHealth';
import { handleWasmError } from '../src/wasmError';
import { BuiltinBridge } from '../src/ecs/BuiltinBridge';
import { COMPONENT_META, ABI_LAYOUT_HASH } from '../src/component.generated';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';

function stubMethod() { return undefined; }
function makeCompleteRegistry(): Record<string, (...args: unknown[]) => unknown> {
    const reg: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of Object.keys(COMPONENT_META)) {
        for (const prefix of ['add', 'get', 'has', 'remove']) {
            reg[`${prefix}${name}`] = stubMethod;
        }
    }
    return reg;
}

describe('moduleHealth primitive', () => {
    it('tracks abort state per module', () => {
        const m = {};
        expect(isModuleAborted(m)).toBe(false);
        markModuleAborted(m, 'OOM');
        expect(isModuleAborted(m)).toBe(true);
    });

    it('treats null/undefined as not-aborted (nothing to call)', () => {
        expect(isModuleAborted(null)).toBe(false);
        expect(isModuleAborted(undefined)).toBe(false);
    });

    it('throwIfModuleAborted carries context and reason', () => {
        const m = {};
        markModuleAborted(m, 'unreachable executed');
        let caught: WasmModuleAborted | null = null;
        try {
            throwIfModuleAborted(m, 'addSprite');
        } catch (e) {
            caught = e as WasmModuleAborted;
        }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect(caught!.context).toBe('addSprite');
        expect(caught!.reason).toBe('unreachable executed');
        expect(caught!.message).toContain('addSprite');
        expect(caught!.message).toContain('unreachable executed');
    });

    it('installAbortGuard flips the flag on abort and preserves a prior onAbort', () => {
        const prev = vi.fn();
        const m: { onAbort?: (what: unknown) => void } = { onAbort: prev };
        installAbortGuard(m);
        expect(isModuleAborted(m)).toBe(false);

        m.onAbort!('memory access out of bounds');
        expect(isModuleAborted(m)).toBe(true);
        expect(prev).toHaveBeenCalledWith('memory access out of bounds');
    });

    it('installAbortGuard is idempotent', () => {
        const m: { onAbort?: (what: unknown) => void } = {};
        installAbortGuard(m);
        const first = m.onAbort;
        installAbortGuard(m);
        expect(m.onAbort).toBe(first);
    });
});

describe('handleWasmError', () => {
    it('rethrows a WasmModuleAborted (fatal, never swallowed)', () => {
        expect(() => handleWasmError(new WasmModuleAborted('ctx'), 'ctx'))
            .toThrowError(WasmModuleAborted);
    });

    it('swallows ordinary transient errors', () => {
        expect(() => handleWasmError(new Error('transient'), 'ctx')).not.toThrow();
    });
});

describe('BuiltinBridge abort gating', () => {
    const firstName = Object.keys(COMPONENT_META)[0]!;

    it('refuses boundary calls once the module has aborted', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry() as unknown as CppRegistry;
        const module = {
            getBuiltinComponentNames: () => Object.keys(COMPONENT_META),
            getAbiLayoutHash: () => ABI_LAYOUT_HASH,
        } as unknown as ESEngineModule;

        bridge.connect(reg, module, { strict: true });
        const methods = bridge.getBuiltinMethods(firstName);

        // Healthy: calls pass through to the (stub) registry without throwing.
        expect(() => methods.has(1 as unknown as Entity)).not.toThrow();

        // Simulate a C++ abort firing the installed onAbort guard.
        (module as unknown as { onAbort: (w: unknown) => void }).onAbort('OOM');

        expect(() => methods.has(1 as unknown as Entity)).toThrowError(WasmModuleAborted);
        expect(() => methods.add(1 as unknown as Entity, {})).toThrowError(WasmModuleAborted);
    });
});
