// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ManifestModel } from './AddressableManifest';
import { pathWithinRemoteRoot } from './physicalAssetFiles';
import { assetPairKey } from './assetPairKey';
import { atlasTextureSettingsKey, type ParsedTextureImportSettings } from './textureImportSettings';

// Internal cache and native pool names. Keep both the record and the exact file
// it acquired, so a held generation can still recover after either one moves.
const PREFIX = '@manifest:';
const ATLAS = '@atlas-page:';

export function manifestBindingKey(record: string, file: string): string {
    return PREFIX + assetPairKey(record, file);
}

function bindingName(key: string, prefix: string): string | undefined {
    if (!key.startsWith(prefix)) return;
    const end = key.indexOf(':', prefix.length);
    return end < 0 ? undefined : key.slice(prefix.length, end).replace(/%3A|%25/g, c => c === '%3A' ? ':' : '%');
}

export function bindingRecord(key: string): string | undefined {
    return bindingName(key, PREFIX);
}

/** Default atlas pages keep the native pool's ordinary file key. Other uploads also identify their sampler and border. */
export function atlasPageBinding(file: string, settings?: ParsedTextureImportSettings): string {
    const profile = atlasTextureSettingsKey(settings);
    return profile === '{}' ? file : ATLAS + assetPairKey(profile, file);
}

/** Recover the options of a held upload even after its original manifest has been replaced. */
export function atlasBindingSettings(key: string): ParsedTextureImportSettings | undefined {
    const profile = bindingName(key, ATLAS);
    if (profile === undefined) return;
    try { return JSON.parse(profile); } catch { return undefined; }
}

export function bindingFile(key: string): string {
    const prefix = key.startsWith(PREFIX) ? PREFIX : key.startsWith(ATLAS) ? ATLAS : undefined;
    if (!prefix) return key;
    const end = key.indexOf(':', prefix.length);
    return end < 0 ? key : key.slice(end + 1);
}

/** Share immutable inputs only while a read is in flight in this manifest. Each upload owns its native handle. */
export function manifestFileReads(model: ManifestModel, root: string | undefined) {
    const pending = new Map<string, Promise<unknown>>();
    return <T>(path: string, variant: string, read: () => Promise<T>, copy?: (value: T) => T): Promise<T> => {
        const file = pathWithinRemoteRoot(path, root);
        if (!model.sharesFile(file) || !model.assetByPath(file)?.contentHash) return read();
        const key = assetPairKey(variant, path);
        let started = pending.get(key) as Promise<T> | undefined;
        if (!started) {
            started = read().finally(() => pending.delete(key));
            pending.set(key, started);
        }
        // A binary consumer can mutate or transfer its buffer while another is still decoding.
        return copy ? started.then(copy) : started;
    };
}
