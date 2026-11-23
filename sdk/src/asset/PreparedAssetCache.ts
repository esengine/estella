// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AsyncCache } from './AsyncCache';
import { AssetDependencyOwner, type PreparedLoad } from './dependencies';

/** Pending readers and readers of the published result acquire the same generation. */
export class PreparedAssetCache extends AsyncCache<PreparedLoad<unknown>> {
    private readonly pendingOwners_ = new WeakMap<Promise<PreparedLoad<unknown>>, AssetDependencyOwner>();

    constructor(private readonly type_: string, dispose: (era: PreparedLoad<unknown>) => void) {
        super(dispose);
    }

    acquire(
        key: string, parent: AssetDependencyOwner | undefined,
        prepare: (owner: AssetDependencyOwner) => Promise<PreparedLoad<unknown>>,
    ) {
        const pending = this.pendingRequest(key);
        const owner = this.get(key)?.owner ?? (pending && this.pendingOwners_.get(pending))
            ?? new AssetDependencyOwner(this.type_, key);
        const unclaim = parent?.claim(owner);
        const ready = this.getOrLoad(key, () => {
            // getOrLoad reserves this exact request before invoking the loader.
            this.pendingOwners_.set(this.pendingRequest(key)!, owner);
            return prepare(owner);
        });
        return { ready, unclaim };
    }
}
