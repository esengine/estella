/**
 * @file    WasmBridge.ts
 * @brief   Single base class for every SDK→WASM subsystem bridge.
 *
 * @details The SDK historically reached into the WASM module five different
 *          ways (a class wrapper for ECS, six global-singleton init/shutdown
 *          modules, and per-subsystem typed interfaces for physics/spine/
 *          tilemap/timeline). Each reinvented its own loader, ready state,
 *          missing-binding policy, and — critically — its own error handling,
 *          so only the ECS bridge ({@link ./ecs/BuiltinBridge}) honoured the
 *          terminal-abort guard. physics/spine/timeline called straight into a
 *          possibly-dead module.
 *
 *          `WasmBridge` is the single channel. A subsystem connects its module
 *          here once; the base installs the abort guard (see moduleHealth.ts)
 *          and hands back a guarded view of the module in which EVERY function
 *          call short-circuits with {@link WasmModuleAborted} after an abort
 *          instead of touching a corpse. Existing call sites are unchanged:
 *          `bridge.module` has the same type as the raw module, so the guard is
 *          transparent.
 *
 *          The guarded view passes through, unguarded:
 *            - non-function properties (HEAP* views, constants) — read live so
 *              they stay valid across ALLOW_MEMORY_GROWTH heap replacement;
 *            - `_malloc`/`_free` — allocator infrastructure that
 *              {@link ./wasmScratch withScratch} must still be able to call in
 *              its `finally` after an abort, so re-guarding them would mask the
 *              original error.
 */

import {
    installAbortGuard,
    isModuleAborted,
    throwIfModuleAborted,
    WasmModuleAborted,
} from './moduleHealth';

/** Properties that must reach the raw module untouched (allocator infra). */
function isAllocatorProp(prop: PropertyKey): boolean {
    return prop === '_malloc' || prop === '_free';
}

/**
 * Base class for a subsystem's bridge to its WASM module.
 *
 * @typeParam M - the module's call-surface type (e.g. `PhysicsWasmModule`).
 *
 * Subclasses only declare a {@link label} for diagnostics:
 * ```ts
 * export class PhysicsBridge extends WasmBridge<PhysicsWasmModule> {
 *     protected readonly label = 'physics';
 * }
 * ```
 */
export abstract class WasmBridge<M extends object> {
    /** Short subsystem name used in {@link WasmModuleAborted} diagnostics. */
    protected abstract readonly label: string;

    private raw_: M | null = null;
    private guarded_: M | null = null;
    /**
     * The module whose `onAbort`/dead-flag is authoritative. For a standalone
     * module (its own emscripten runtime, e.g. the shipped physics module) this
     * is the module itself. For a side module that shares the main module's
     * heap, pass the main module as `healthModule` — that is where emscripten
     * fires `onAbort` and where the dead flag must be read.
     */
    private health_: object | null = null;

    /**
     * Bind this bridge to a freshly-loaded module. Installs the terminal-abort
     * guard and builds the guarded view. Calling again rebinds to a new module.
     *
     * @param module        the module call surface used by `bridge.module`.
     * @param healthModule   the abort-authoritative module; defaults to `module`.
     */
    connect(module: M, healthModule: object = module): void {
        this.raw_ = module;
        this.health_ = healthModule;
        installAbortGuard(healthModule);
        this.guarded_ = this.makeGuarded_(module, healthModule);
    }

    /** Unbind. Subsequent `module` access throws until reconnected. */
    disconnect(): void {
        this.raw_ = null;
        this.guarded_ = null;
        this.health_ = null;
    }

    /** True once {@link connect} has run and before {@link disconnect}. */
    get connected(): boolean {
        return this.raw_ !== null;
    }

    /**
     * The guarded module. Every function call is gated through the abort guard;
     * HEAP views, constants, and `_malloc`/`_free` pass through to the live
     * module. Same static type as the raw module, so call sites are unchanged.
     *
     * @throws if the bridge is not connected.
     */
    get module(): M {
        if (!this.guarded_) {
            throw new Error(`${this.label} bridge is not connected to a WASM module`);
        }
        return this.guarded_;
    }

    /**
     * The unguarded module, or null if not connected. Prefer {@link module};
     * reach for `raw` only when the guard is provably unwanted (it almost never
     * is — `_malloc`/`_free` and HEAP views already pass through `module`).
     */
    get raw(): M | null {
        return this.raw_;
    }

    private makeGuarded_(module: M, health: object): M {
        const label = this.label;
        // One wrapper per accessed function, built lazily and reused, so the
        // steady-state cost is a proxy get + Map lookup rather than a fresh
        // closure per call.
        const wrappers = new Map<PropertyKey, (...args: unknown[]) => unknown>();

        return new Proxy(module, {
            get(target, prop): unknown {
                // Read with `target` as receiver so any getter (e.g. a side
                // module's HEAPF32 proxy getter) resolves against the module.
                const value = Reflect.get(target, prop, target);
                if (typeof value !== 'function' || isAllocatorProp(prop)) {
                    return value;
                }
                let wrapped = wrappers.get(prop);
                if (!wrapped) {
                    const fn = value as (...args: unknown[]) => unknown;
                    const op = `${label}.${typeof prop === 'string' ? prop : String(prop)}`;
                    wrapped = (...args: unknown[]): unknown => {
                        // Pre-check: never enter a dead module.
                        throwIfModuleAborted(health, op);
                        try {
                            return fn.apply(target, args);
                        } catch (err) {
                            // If THIS call aborted the module, surface it as the
                            // terminal error rather than letting the corpse's
                            // return value (undefined memory) propagate.
                            if (isModuleAborted(health)) {
                                throw new WasmModuleAborted(op, undefined, err);
                            }
                            throw err;
                        }
                    };
                    wrappers.set(prop, wrapped);
                }
                return wrapped;
            },
        }) as M;
    }
}
