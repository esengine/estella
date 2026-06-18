/**
 * @file    moduleHealth.ts
 * @brief   Terminal-abort tracking for the C++/WASM boundary.
 *
 * @details The engine compiles the WASM module with `-fno-exceptions`, so a C++
 *          failure (OOM, failed assert, unreachable) calls `abort()` and tears
 *          the module down permanently — it does NOT surface as a catchable JS
 *          exception. Without tracking, the SDK keeps calling into the corpse,
 *          reading and writing undefined memory.
 *
 *          This module is the error channel for that model: install an
 *          `onAbort` guard that flips a per-module "dead" flag, and have every
 *          boundary call short-circuit with {@link WasmModuleAborted} instead of
 *          invoking a dead module. The flag is terminal — a module never
 *          recovers from abort.
 */

/** Thrown when a boundary call is attempted on a WASM module that has aborted. */
export class WasmModuleAborted extends Error {
    /** Where the rejected call originated (for diagnostics). */
    readonly context: string;
    /** The abort reason reported by the emscripten runtime, if any. */
    readonly reason: string | undefined;

    constructor(context: string, reason?: string, cause?: unknown) {
        super(
            `WASM module aborted; refusing to call into it (${context})` +
            (reason ? `: ${reason}` : ''),
        );
        this.name = 'WasmModuleAborted';
        this.context = context;
        this.reason = reason;
        if (cause !== undefined) {
            (this as { cause?: unknown }).cause = cause;
        }
    }
}

interface ModuleHealth {
    aborted: boolean;
    reason?: string;
    guardInstalled?: boolean;
}

// Health is keyed by module identity so multiple modules (main, side-modules,
// test mocks) are tracked independently and state is GC'd with the module.
const healthByModule = new WeakMap<object, ModuleHealth>();

function stateOf(module: object): ModuleHealth {
    let s = healthByModule.get(module);
    if (!s) {
        s = { aborted: false };
        healthByModule.set(module, s);
    }
    return s;
}

/** Mark a module as aborted (terminal). Idempotent; keeps the first reason. */
export function markModuleAborted(module: object, reason?: string): void {
    const s = stateOf(module);
    if (!s.aborted) {
        s.aborted = true;
        s.reason = reason;
    }
}

/** True if the module has aborted. False for null/undefined (nothing to call). */
export function isModuleAborted(module: object | null | undefined): boolean {
    return module ? stateOf(module).aborted : false;
}

/** Throw {@link WasmModuleAborted} if the module has aborted; otherwise no-op. */
export function throwIfModuleAborted(module: object | null | undefined, context: string): void {
    if (!module) return;
    const s = stateOf(module);
    if (s.aborted) {
        throw new WasmModuleAborted(context, s.reason);
    }
}

/**
 * Install a terminal abort guard on a module. The emscripten runtime invokes
 * `Module.onAbort(what)` when it aborts; we flip the dead flag so subsequent
 * boundary calls short-circuit. Any pre-existing `onAbort` is preserved and
 * still called. Idempotent per module.
 */
export function installAbortGuard(module: object): void {
    const s = stateOf(module);
    if (s.guardInstalled) return;
    s.guardInstalled = true;

    const m = module as { onAbort?: (what: unknown) => void };
    const prev = typeof m.onAbort === 'function' ? m.onAbort.bind(m) : null;
    m.onAbort = (what: unknown): void => {
        markModuleAborted(module, what === null || what === undefined ? undefined : String(what));
        if (prev) prev(what);
    };
}
