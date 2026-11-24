// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ManifestModel } from './AddressableManifest';
import { pathWithinRemoteRoot } from './physicalAssetFiles';
import { assetPairKey } from './assetPairKey';

// Internal cache and native pool names. Keep both the record and the exact file
// it acquired, so a held generation can still recover after either one moves.
const PREFIX = '@manifest:';

export function manifestBindingKey(record: string, file: string): string {
    return PREFIX + assetPairKey(record, file);
}

export function bindingRecord(key: string): string | undefined {
    if (!key.startsWith(PREFIX)) return;
    const end = key.indexOf(':', PREFIX.length);
    return end < 0 ? undefined : key.slice(PREFIX.length, end).replace(/%3A|%25/g, c => c === '%3A' ? ':' : '%');
}

export function bindingFile(key: string): string {
    if (!key.startsWith(PREFIX)) return key;
    const end = key.indexOf(':', PREFIX.length);
    return end < 0 ? key : key.slice(end + 1);
}

/** Share immutable inputs only while a read is in flight in this manifest. Each upload owns its native handle. */
export function manifestFileReads(model: ManifestModel, root: string | undefined) {
    const pending = new Map<string, Promise<unknown>>();
    return <T>(path: string, variant: string, read: () => Promise<T>): Promise<T> => {
        const file = pathWithinRemoteRoot(path, root);
        if (!model.sharesFile(file) || !model.assetByPath(file)?.contentHash) return read();
        const key = assetPairKey(variant, path);
        const existing = pending.get(key);
        if (existing) return existing as Promise<T>;
        const started = read().finally(() => pending.delete(key));
        pending.set(key, started);
        return started;
    };
}
