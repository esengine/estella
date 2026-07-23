// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hotUpdate.ts
 * @brief   Pure manifest-diff core for content-addressed hot updates.
 *
 * The runtime hot-update flow is: fetch the remote manifest → {@link diffManifests}
 * it against the active one → download the changed (content-addressed) assets →
 * swap the active manifest. Because every asset url is `<contentHash>.<ext>`
 * (immutable), a changed asset is a NEW url: the diff is a pure comparison of
 * per-asset `contentHash`, and applying it never overwrites or invalidates a
 * cached file — the old url simply stops being referenced.
 *
 * This module is pure — no fetch, no platform, no Assets — so it unit-tests in
 * isolation and the SAME diff drives every platform (web / mini-game / native).
 */
import type { ManifestModel } from './AddressableManifest';
import type { AddressableAssetType, AddressableManifestAsset } from './AddressableManifest';

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
    /** True iff any asset is new / content-changed (or, absent contentHashes on
     *  both sides, the top-level revision moved). */
    hasUpdate: boolean;
    fromRevision: string | null;
    toRevision: string | null;
    /** Distinct groups owning ≥1 changed / added asset — the set to re-load. */
    changedGroups: string[];
    /** New or content-changed assets to download. */
    changedAssets: AssetChange[];
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
 * Matching is by group-record key (stable per asset across builds). An asset is
 * "changed" when it is brand-new, or its content differs — authoritatively by
 * `contentHash` when both sides carry one, else by build path. `current === null`
 * (no manifest yet, e.g. first launch off a persisted-manifest miss) treats every
 * asset as new — a full fetch.
 */
export function diffManifests(current: ManifestModel | null, next: ManifestModel): UpdatePlan {
    const changedAssets: AssetChange[] = [];
    const changedGroups = new Set<string>();
    let totalBytes = 0;

    for (const { group, key, asset } of next.entries()) {
        const prev = current?.assetByKey(key) ?? null;
        const changed = !prev
            || (asset.contentHash != null && prev.contentHash != null
                ? asset.contentHash !== prev.contentHash
                : asset.path !== prev.path);
        if (changed) {
            changedAssets.push(toChange(group, key, asset));
            changedGroups.add(group);
            totalBytes += asset.size ?? 0;
        }
    }

    const removedAssets: AssetChange[] = [];
    if (current) {
        const nextKeys = new Set(next.entries().map((e) => e.key));
        for (const { group, key, asset } of current.entries()) {
            if (!nextKeys.has(key)) removedAssets.push(toChange(group, key, asset));
        }
    }

    const fromRevision = current?.revision() ?? null;
    const toRevision = next.revision() ?? null;
    const hasUpdate = changedAssets.length > 0
        || (fromRevision != null && toRevision != null && fromRevision !== toRevision);

    return {
        hasUpdate,
        fromRevision,
        toRevision,
        changedGroups: [...changedGroups],
        changedAssets,
        removedAssets,
        totalBytes,
    };
}
