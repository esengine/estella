/**
 * @file    context.ts
 * @brief   Explicit application context replacing globalThis implicit coupling
 */

/**
 * Surface the engine exposes to an attached editor host.
 *
 * `registerComponent` is called eagerly during `defineComponent` so the
 * editor knows the full component catalogue. The `on*` callbacks are all
 * optional — an editor that only needs the catalogue (no live inspector)
 * can leave them unset and avoid any per-mutation overhead.
 *
 * All entity values are the engine's numeric Entity handle. Component
 * identification is by the string name that was passed to
 * `registerComponent` / `defineComponent`.
 */
export interface EditorBridge {
    registerComponent(name: string, defaults: Record<string, unknown>, isTag: boolean): void;

    /** Fired after an entity is created (optionally with a Name component). */
    onEntitySpawned?(entity: number, name?: string): void;

    /** Fired just before an entity is destroyed. Components are still attached. */
    onEntityDespawned?(entity: number): void;

    /** Fired when a component is first attached to an entity. */
    onComponentAdded?(entity: number, component: string): void;

    /** Fired when a component is detached from an entity. */
    onComponentRemoved?(entity: number, component: string): void;

    /** Fired when component data changes (insert with new data, set, or edit). */
    onComponentChanged?(entity: number, component: string): void;

    /** Fired when a parent link changes. `parent === null` means the entity was unparented. */
    onParentChanged?(child: number, parent: number | null): void;
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
