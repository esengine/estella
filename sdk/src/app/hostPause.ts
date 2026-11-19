// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from './app';

const hostPauseOwners = new WeakMap<App, Set<object>>();

export function setAppHostPaused(app: App, owner: object, paused: boolean): void {
    if (paused) {
        let owners = hostPauseOwners.get(app);
        if (!owners) hostPauseOwners.set(app, owners = new Set());
        owners.add(owner);
    } else {
        const owners = hostPauseOwners.get(app);
        owners?.delete(owner);
        if (!owners?.size) hostPauseOwners.delete(app);
    }
}

export function isAppHostPaused(app: App): boolean {
    return !!hostPauseOwners.get(app)?.size;
}
