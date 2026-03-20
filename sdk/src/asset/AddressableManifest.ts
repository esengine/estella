import type { AddressableAssetType } from '../assetTypes';

export type { AddressableAssetType };

export interface AddressableManifestAsset {
    path: string;
    address?: string;
    type: AddressableAssetType;
    size: number;
    labels: string[];
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
