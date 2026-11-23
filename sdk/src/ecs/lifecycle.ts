// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lifecycle.ts
 * @brief   App lifecycle plugin - visibility/focus auto-pause and lifecycle events
 */

import { defineResource } from './resource';
import type { App, Plugin } from '../app/app';
import { getPlatformType, isMiniGame, platformOnAppShow, platformOnAppHide } from '../platform';
import { ListenerScope } from '../platform/listeners';
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
    private readonly subscriptions_ = new Map<App, ListenerScope>();

    constructor(private readonly options_?: LifecyclePluginOptions) {}

    build(app: App): void {
        this.cleanup(app);
        const manager = new LifecycleManager(this.options_?.autoPause ?? true);
        app.insertResource(Lifecycle, manager);

        const hostEvents = getPlatformType() === 'native' || isMiniGame();
        const page = typeof document !== 'undefined' && typeof document.addEventListener === 'function'
            && typeof window !== 'undefined' ? document : null;
        if (!hostEvents && !page) return;

        const scope = new ListenerScope();
        this.subscriptions_.set(app, scope);
        scope.add(() => manager.removeAllListeners());
        let pausedByLifecycle = false;
        const setVisible = (visible: boolean) => {
            manager.setVisible_(visible);
            if (this.subscriptions_.get(app) !== scope) return; // A hide/show listener can quit or rebuild.
            if (!visible && manager.autoPause && !app.isPaused()) {
                pausedByLifecycle = true;
                app.setPaused(true);
                manager.emit_('pause');
            } else if (visible && pausedByLifecycle) {
                pausedByLifecycle = false;
                app.setPaused(false);
                manager.emit_('resume');
            }
        };

        if (hostEvents) {
            scope.add(platformOnAppShow(() => setVisible(true)));
            scope.add(platformOnAppHide(() => setVisible(false)));
        } else if (page) {
            scope.listen(page, 'visibilitychange', () => setVisible(!page.hidden));
            scope.listen(window, 'focus', () => manager.setFocused_(true));
            scope.listen(window, 'blur', () => manager.setFocused_(false));
            // A page opened in a background tab receives no initial visibilitychange.
            if (page.hidden) setVisible(false);
        }
    }

    cleanup(app?: App): void {
        if (app) {
            const scope = this.subscriptions_.get(app);
            this.subscriptions_.delete(app);
            scope?.dispose();
        } else {
            const scopes = [...this.subscriptions_.values()];
            this.subscriptions_.clear();
            for (const scope of scopes) scope.dispose();
        }
    }
}

/** Default-config instance; `new LifecyclePlugin({ autoPause })` to configure. */
export const lifecyclePlugin = new LifecyclePlugin();
