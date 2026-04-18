/**
 * @file    context.ts
 * @brief   Explicit application context replacing globalThis implicit coupling
 */

export interface EditorBridge {
    registerComponent(name: string, defaults: Record<string, unknown>, isTag: boolean): void;
}

export interface PendingSystemEntry {
    schedule: number;
    system: unknown;
}

export type WasmErrorHandler = (error: unknown, context: string) => void;

export interface WasmErrorState {
    handler: WasmErrorHandler | null;
    lastReportTime: number;
    suppressedCount: number;
}

export class AppContext {
    readonly componentRegistry = new Map<string, any>();
    readonly pendingSystems: PendingSystemEntry[] = [];
    editorBridge: EditorBridge | null = null;
    readonly wasmError: WasmErrorState = { handler: null, lastReportTime: 0, suppressedCount: 0 };

    /** @brief Drain all pending systems and clear the queue */
    drainPendingSystems(): PendingSystemEntry[] {
        const drained = this.pendingSystems.splice(0);
        return drained;
    }

    /** @brief Reset all mutable state for a new session */
    reset(): void {
        this.pendingSystems.length = 0;
        this.componentRegistry.clear();
        this.editorBridge = null;
        this.wasmError.handler = null;
        this.wasmError.lastReportTime = 0;
        this.wasmError.suppressedCount = 0;
    }
}

/**
 * Module-level default context.
 *
 * Multi-app note: this default is shared across all consumers that call
 * `getDefaultContext()` without first installing their own context. If you
 * run multiple isolated Apps in one process, each must call
 * `setDefaultContext(new AppContext())` on its own entry path — the lazy
 * singleton here will otherwise leak state (component registry, pending
 * systems, wasm-error throttle) between them.
 */
let defaultContext_: AppContext | null = null;

export function getDefaultContext(): AppContext {
    if (!defaultContext_) defaultContext_ = new AppContext();
    return defaultContext_;
}

export function setDefaultContext(ctx: AppContext): void {
    defaultContext_ = ctx;
}
