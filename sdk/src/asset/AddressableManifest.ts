// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AddressableAssetType } from '../assetTypes';

export type { AddressableAssetType };

export interface AddressableManifestAsset {
    path: string;
    address?: string;
    type: AddressableAssetType;
    size: number;
    labels: string[];
    /**
     * Content hash of the built bytes (xxh3), the asset's *physical* identity.
     * Populated by the import pipeline. Lets the runtime dedupe by content and
     * treat `<contentHash>.<ext>` as an immutable, permanently-cacheable URL
     * (changing a file yields a new hash → a new URL, never a stale cache).
     */
    contentHash?: string;
    /** GPU compressed formats this asset was encoded for (e.g. ['astc-4x4','etc2-rgba8']). */
    compressedFormats?: string[];
    metadata?: {
        atlas?: string;
        atlasPage?: number;
        atlasFrame?: { x: number; y: number; width: number; height: number };
    };
}

export interface AddressableManifestGroup {
    bundleMode: string;
    labels: string[];
    assets: Record<string, AddressableManifestAsset>;
}

export interface AddressableManifest {
    version: '2.0';
    groups: Record<string, AddressableManifestGroup>;
}
