// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hotUpdate.ts
 * @brief   Pure manifest-diff core for content-addressed hot updates.
 *
 * The same plan tells each host which payloads to verify and which assets
 * need new runtime settings once verification succeeds.
 */
import type { ManifestModel } from './AddressableManifest';
import type { AddressableAssetType, AddressableManifestAsset } from './AddressableManifest';
import { assetManifestSignature, groupManifestSignature } from './AddressableManifest';

/** One asset the update touches, resolved to what the downloader needs. */
export interface AssetChange {
    /** Group-record key (uuid in cooked manifests, else path) — the stable
     *  cross-build identity the diff matches on. */
    key: string;
    /** Build path of the asset in the NEW manifest (content-addressed → the
     *  immutable url tail the downloader appends to the remote root). */
    path: string;
    /** Owning group in the new manifest. */
    group: string;
    type: AddressableAssetType;
    size: number;
    contentHash?: string;
}

/** The result of comparing an active manifest to a candidate one. */
export interface UpdatePlan {
    /** True when the candidate changes the active manifest. */
    hasUpdate: boolean;
    fromRevision: string | null;
    toRevision: string | null;
    /** Groups with changes to their delivery settings, membership or assets. */
    changedGroups: string[];
    /** Assets whose bytes must be verified at their new delivery location. */
    changedAssets: AssetChange[];
    /** Assets whose existing payload can be used with the candidate's settings. */
    reconfiguredAssets: AssetChange[];
    /** Assets present before but absent now — informational, for cache cleanup;
     *  never downloaded. */
    removedAssets: AssetChange[];
    /** Sum of `changedAssets` sizes: the download-size estimate for UI/progress. */
    totalBytes: number;
}

function toChange(group: string, key: string, asset: AddressableManifestAsset): AssetChange {
    const change: AssetChange = {
        key, group, path: asset.path, type: asset.type, size: asset.size ?? 0,
    };
    if (asset.contentHash != null) change.contentHash = asset.contentHash;
    return change;
}

/**
 * Compare the active manifest to `next` and produce the download plan.
 *
 * Assets match by record key across builds, including moves between groups.
 * Compare their settings even when a legacy cook supplied the same revision.
 */
export function diffManifests(current: ManifestModel | null, next: ManifestModel): UpdatePlan {
    const changedAssets: AssetChange[] = [];
    const reconfiguredAssets: AssetChange[] = [];
    const changedGroups = new Set<string>();
    const previous = new Map(current?.entries().map(entry => [entry.key, entry]));
    let totalBytes = 0;

    for (const { group, key, asset } of next.entries()) {
        const prior = previous.get(key);
        previous.delete(key);
        const prev = prior?.asset;
        const deliveryChanged = prior && current?.bundleMode(prior.group) !== next.bundleMode(group);
        if (!prev || deliveryChanged || asset.path !== prev.path
            || (asset.contentHash != null && asset.contentHash !== prev.contentHash)
            || asset.pack?.file !== prev.pack?.file || asset.pack?.offset !== prev.pack?.offset
            || asset.pack?.size !== prev.pack?.size) {
            changedAssets.push(toChange(group, key, asset));
            totalBytes += asset.size ?? 0;
        } else if (prior.group !== group || assetManifestSignature(prev) !== assetManifestSignature(asset)) {
            reconfiguredAssets.push(toChange(group, key, asset));
        } else {
            continue;
        }
        if (prior) changedGroups.add(prior.group);
        changedGroups.add(group);
    }

    const removedAssets: AssetChange[] = [];
    for (const { group, key, asset } of previous.values()) {
        removedAssets.push(toChange(group, key, asset));
        changedGroups.add(group);
    }
    for (const name of new Set([...(current?.groupNames() ?? []), ...next.groupNames()])) {
        const before = current?.group(name);
        const after = next.group(name);
        if (!before || !after || groupManifestSignature(before) !== groupManifestSignature(after)) changedGroups.add(name);
    }

    const fromRevision = current?.revision() ?? null;
    const toRevision = next.revision() ?? null;
    const hasUpdate = changedGroups.size > 0
        || (fromRevision != null && toRevision != null && fromRevision !== toRevision);

    return {
        hasUpdate,
        fromRevision,
        toRevision,
        changedGroups: [...changedGroups],
        changedAssets,
        reconfiguredAssets,
        removedAssets,
        totalBytes,
    };
}
