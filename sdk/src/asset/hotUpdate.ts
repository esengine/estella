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
import { physicalAssetFiles, remoteAssetUrl, type PhysicalAssetFile } from './physicalAssetFiles';

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

/** One physical file the candidate requires, with its delivery group and expected byte count. */
export interface UpdateFile extends PhysicalAssetFile {
    group: string;
    size: number;
}

/** The result of comparing an active manifest to a candidate one. */
export interface UpdatePlan {
    /** True when the candidate changes the active manifest. */
    hasUpdate: boolean;
    fromRevision: string | null;
    toRevision: string | null;
    /** Groups with changes to their delivery settings, membership or assets. */
    changedGroups: string[];
    /** New assets and assets whose main payload or delivery location changed. */
    changedAssets: AssetChange[];
    /** Assets whose main payload can be reused with changed settings or previews. */
    reconfiguredAssets: AssetChange[];
    /** Assets present before but absent now — informational, for cache cleanup;
     *  never downloaded. */
    removedAssets: AssetChange[];
    /** Distinct files to verify, including independently fetched texture previews. */
    downloadFiles: UpdateFile[];
    /** Sum of `downloadFiles` sizes. */
    totalBytes: number;
}

function toChange(group: string, key: string, asset: AddressableManifestAsset): AssetChange {
    const change: AssetChange = {
        key, group, path: asset.path, type: asset.type, size: asset.size ?? 0,
    };
    if (asset.contentHash != null) change.contentHash = asset.contentHash;
    return change;
}

type DeliveryRoots = { current?: string | null; next?: string | null };

function fileIdentity(model: ManifestModel, group: string, file: PhysicalAssetFile, root: string | null | undefined,
    hash: string | null | undefined = file.contentHash): string {
    const mode = model.bundleMode(group);
    const path = mode === 'remote' ? remoteAssetUrl(file.path, root) : file.path;
    return JSON.stringify([mode, mode === 'lazy' ? group : '', path, hash ?? file.size ?? null]);
}

function planDownloads(current: ManifestModel | null, next: ManifestModel, changed: AssetChange[], reconfigured: AssetChange[], roots: DeliveryRoots): UpdateFile[] {
    if (!changed.length && !reconfigured.length) return [];
    const available = new Set<string>();
    if (current) {
        for (const { group, asset } of current.entries()) {
            for (const file of physicalAssetFiles(asset)) {
                available.add(fileIdentity(current, group, file, roots.current));
                // A legacy candidate can identify an existing file only by its location and length.
                if (file.contentHash) available.add(fileIdentity(current, group, file, roots.current, null));
            }
        }
    }
    const files = new Map<string, UpdateFile>();
    const changedMain = new Set(changed.map(asset => asset.key));
    for (const { group, key } of [...changed, ...reconfigured]) {
        const asset = next.group(group)!.assets[key];
        for (const file of physicalAssetFiles(asset)) {
            const id = fileIdentity(next, group, file, roots.next);
            if (file.kind === 'pack' ? !changedMain.has(key) : available.has(id)) continue;
            if (!files.has(id)) files.set(id, { ...file, size: file.size ?? 0, group });
        }
    }
    return [...files.values()];
}

/**
 * Compare the active manifest to `next` and produce the download plan.
 *
 * Assets match by record key across builds, including moves between groups.
 * Compare their settings even when a legacy cook supplied the same revision.
 */
export function diffManifests(current: ManifestModel | null, next: ManifestModel, roots: DeliveryRoots = {}): UpdatePlan {
    const changedAssets: AssetChange[] = [];
    const reconfiguredAssets: AssetChange[] = [];
    const changedGroups = new Set<string>();
    const previous = new Map(current?.entries().map(entry => [entry.key, entry]));
    const moved = (path: string) => remoteAssetUrl(path, roots.current) !== remoteAssetUrl(path, roots.next);

    for (const { group, key, asset } of next.entries()) {
        const prior = previous.get(key);
        previous.delete(key);
        const prev = prior?.asset;
        const rerouted = roots.current !== roots.next && next.bundleMode(group) === 'remote';
        const deliveryChanged = prior && current?.bundleMode(prior.group) !== next.bundleMode(group);
        if (!prev || deliveryChanged || asset.path !== prev.path || (rerouted && moved(asset.path))
            || (asset.contentHash != null && asset.contentHash !== prev.contentHash)
            || asset.pack?.file !== prev.pack?.file || asset.pack?.offset !== prev.pack?.offset
            || asset.pack?.size !== prev.pack?.size) {
            changedAssets.push(toChange(group, key, asset));
        } else if (prior.group !== group || (rerouted && asset.streamTail && moved(asset.streamTail.path))
            || assetManifestSignature(prev) !== assetManifestSignature(asset)) {
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
    const downloadFiles = planDownloads(current, next, changedAssets, reconfiguredAssets, roots);

    return {
        hasUpdate,
        fromRevision,
        toRevision,
        changedGroups: [...changedGroups],
        changedAssets,
        reconfiguredAssets,
        removedAssets,
        downloadFiles,
        totalBytes: downloadFiles.reduce((sum, file) => sum + file.size, 0),
    };
}
