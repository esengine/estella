// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneLoadProgressCallback } from './scene';

/** One preparation or publication owns its counts and observers until it ends. */
export class SceneAssetProgress {
    private listeners_: Set<SceneLoadProgressCallback> | undefined = new Set();
    private loaded_ = 0;
    private total_?: number;

    observe(listener?: SceneLoadProgressCallback): void {
        const listeners = this.listeners_;
        if (!listener || !listeners || listeners.has(listener)) return;
        listeners.add(listener);
        if (this.total_ === undefined) return;
        try { listener(this.loaded_, this.total_); }
        catch (error) { listeners.delete(listener); throw error; }
    }

    readonly report: SceneLoadProgressCallback = (loaded, total) => {
        const listeners = this.listeners_;
        if (!listeners) return;
        this.loaded_ = loaded;
        this.total_ = total;
        if (!listeners.size) return;
        // A callback can join this same load or cancel it during delivery.
        for (const listener of [...listeners]) {
            if (!this.listeners_) break;
            listener(loaded, total);
        }
    };

    close(): void {
        this.listeners_?.clear();
        this.listeners_ = undefined;
    }
}
