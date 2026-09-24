// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lifecycle.ts
 * @brief   App lifecycle plugin - visibility/focus auto-pause and lifecycle events
 */

import { defineResource } from './resource';
import type { App, Plugin } from '../app/app';
import { getPlatformType, isMiniGame, platformOnAppShow, platformOnAppHide } from '../platform';
import { log } from '../util/logger';

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

export class LifecyclePlugin implements Plugin {
    name = 'Lifecycle';
    private cleanupFn_: (() => void) | null = null;

    constructor(private readonly options_?: LifecyclePluginOptions) {}

    build(app: App): void {
        const autoPause = this.options_?.autoPause ?? true;
        const manager = new LifecycleManager(autoPause);
        app.insertResource(Lifecycle, manager);

        const platformType = getPlatformType();

        // A mini-game host and the native shell both push foreground/background
        // through the adapter. Every mini-game runs with a `document` stub that has
        // no addEventListener, so the web branch must not be reached from one.
        if (platformType === 'native' || isMiniGame()) {
            this.cleanupFn_ = setupHostLifecycle_(manager, app);
        } else if (typeof document !== 'undefined' && typeof document.addEventListener === 'function'
            && typeof window !== 'undefined') {
            this.cleanupFn_ = setupWebLifecycle_(manager, app);
        }
        // Headless hosts (node server, workers) keep the Lifecycle resource and
        // stay always-visible; a native shell that never wired the show/hide
        // signal degrades to the same (setupNativeLifecycle_ just never fires).
    }

    cleanup(): void {
        this.cleanupFn_?.();
        this.cleanupFn_ = null;
    }
}

/** Default-config instance; `new LifecyclePlugin({ autoPause })` to configure. */
export const lifecyclePlugin = new LifecyclePlugin();

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
// Hosts that push foreground/background (mini-game vendors, the native shell)
// =============================================================================

/**
 * The host pushes foreground/background through the adapter (a mini-game's
 * onShow/onHide, the native bridge). Native suspends audio itself on background,
 * so this only drives the game tick and the lifecycle events.
 */
function setupHostLifecycle_(manager: LifecycleManager, app: AppLike): () => void {
    let pausedByLifecycle = false;

    const offShow = platformOnAppShow(() => {
        manager.setVisible_(true);
        if (pausedByLifecycle) {
            app.setPaused(false);
            pausedByLifecycle = false;
            manager.emit_('resume');
        }
    });

    const offHide = platformOnAppHide(() => {
        manager.setVisible_(false);
        if (manager.autoPause && !app.isPaused()) {
            app.setPaused(true);
            pausedByLifecycle = true;
            manager.emit_('pause');
        }
    });

    return (): void => {
        offShow();
        offHide();
        manager.removeAllListeners();
    };
}
