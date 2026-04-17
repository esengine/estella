/**
 * @file    lifecycle.ts
 * @brief   App lifecycle plugin - visibility/focus auto-pause and lifecycle events
 */

import { defineResource } from './resource';
import type { Plugin } from './app';
import { getPlatformType } from './platform';
import { log } from './logger';

// =============================================================================
// Lifecycle State
// =============================================================================

export type LifecycleEvent = 'show' | 'hide' | 'pause' | 'resume';
export type LifecycleListener = (event: LifecycleEvent) => void;

export class LifecycleManager {
    private listeners_: LifecycleListener[] = [];
    private visible_ = true;
    private focused_ = true;
    private autoPause_: boolean;

    constructor(autoPause = true) {
        this.autoPause_ = autoPause;
    }

    get visible(): boolean {
        return this.visible_;
    }

    get focused(): boolean {
        return this.focused_;
    }

    get autoPause(): boolean {
        return this.autoPause_;
    }

    set autoPause(v: boolean) {
        this.autoPause_ = v;
    }

    on(listener: LifecycleListener): () => void {
        this.listeners_.push(listener);
        return () => {
            const idx = this.listeners_.indexOf(listener);
            if (idx >= 0) this.listeners_.splice(idx, 1);
        };
    }

    off(listener: LifecycleListener): void {
        const idx = this.listeners_.indexOf(listener);
        if (idx >= 0) this.listeners_.splice(idx, 1);
    }

    /** @internal */
    setVisible_(v: boolean): void {
        if (this.visible_ === v) return;
        this.visible_ = v;
        this.emit_(v ? 'show' : 'hide');
    }

    /** @internal */
    setFocused_(v: boolean): void {
        if (this.focused_ === v) return;
        this.focused_ = v;
    }

    /** @internal */
    emit_(event: LifecycleEvent): void {
        for (const listener of this.listeners_) {
            try { listener(event); } catch (e) {
                log.error('lifecycle', 'Listener error', e);
            }
        }
    }

    removeAllListeners(): void {
        this.listeners_.length = 0;
    }
}

// =============================================================================
// Resource
// =============================================================================

export const Lifecycle = defineResource<LifecycleManager>(new LifecycleManager(), 'Lifecycle');

// =============================================================================
// Plugin
// =============================================================================

export interface LifecyclePluginOptions {
    autoPause?: boolean;
}

export const lifecyclePlugin = (options?: LifecyclePluginOptions): Plugin => {
    let cleanupFn_: (() => void) | null = null;

    return {
        name: 'Lifecycle',
        build(app) {
            const autoPause = options?.autoPause ?? true;
            const manager = new LifecycleManager(autoPause);
            app.insertResource(Lifecycle, manager);

            const platformType = getPlatformType();

            if (platformType === 'wechat') {
                setupWeChatLifecycle_(manager, app);
            } else {
                cleanupFn_ = setupWebLifecycle_(manager, app);
            }
        },
        cleanup() {
            cleanupFn_?.();
            cleanupFn_ = null;
        },
    };
};

// =============================================================================
// Web Platform
// =============================================================================

type AppLike = { setPaused(v: boolean): void; isPaused(): boolean };

function setupWebLifecycle_(manager: LifecycleManager, app: AppLike): () => void {
    let pausedByLifecycle = false;

    const onVisibilityChange = (): void => {
        const hidden = document.hidden;
        manager.setVisible_(!hidden);

        if (hidden) {
            if (manager.autoPause && !app.isPaused()) {
                app.setPaused(true);
                pausedByLifecycle = true;
                manager.emit_('pause');
            }
        } else {
            if (pausedByLifecycle) {
                app.setPaused(false);
                pausedByLifecycle = false;
                manager.emit_('resume');
            }
        }
    };

    const onFocus = (): void => { manager.setFocused_(true); };
    const onBlur = (): void => { manager.setFocused_(false); };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    return (): void => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        manager.removeAllListeners();
    };
}

// =============================================================================
// WeChat Platform
// =============================================================================

function setupWeChatLifecycle_(manager: LifecycleManager, app: AppLike): void {
    let pausedByLifecycle = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wx = (globalThis as any).wx;
    if (!wx) return;

    const onShow = (): void => {
        manager.setVisible_(true);
        if (pausedByLifecycle) {
            app.setPaused(false);
            pausedByLifecycle = false;
            manager.emit_('resume');
        }
    };

    const onHide = (): void => {
        manager.setVisible_(false);
        if (manager.autoPause && !app.isPaused()) {
            app.setPaused(true);
            pausedByLifecycle = true;
            manager.emit_('pause');
        }
    };

    wx.onShow(onShow);
    wx.onHide(onHide);
}
