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

export class AppContext {
    readonly componentRegistry = new Map<string, any>();
    readonly pendingSystems: PendingSystemEntry[] = [];
    editorBridge: EditorBridge | null = null;

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
    }
}

let defaultContext_: AppContext | null = null;

export function getDefaultContext(): AppContext {
    if (!defaultContext_) defaultContext_ = new AppContext();
    return defaultContext_;
}

export function setDefaultContext(ctx: AppContext): void {
    defaultContext_ = ctx;
}
