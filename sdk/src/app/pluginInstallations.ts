// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from './app';

/** State owned by each App that installed a shared plugin. A parameterless call addresses its latest installation. */
export class PluginInstallations<T> {
    private readonly byApp_ = new WeakMap<App, T>();
    private latest_?: App;

    set(app: App, state: T): void {
        this.byApp_.set(app, state);
        this.latest_ = app;
    }

    get(app = this.latest_): T | undefined {
        return app && this.byApp_.get(app);
    }

    /** Detach before running cleanup so a repeated or reentrant call cannot release the same state twice. */
    take(app = this.latest_): T | undefined {
        if (!app) return undefined;
        const state = this.byApp_.get(app);
        this.byApp_.delete(app);
        if (app === this.latest_) this.latest_ = undefined;
        return state;
    }
}
