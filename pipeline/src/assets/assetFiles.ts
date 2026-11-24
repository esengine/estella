// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetPackRef, StreamTailInfo } from '../../../sdk/src/asset/AddressableManifest';

/** File references shared by cook entries and addressable manifest entries. */
export interface AssetFileRefs {
    path: string;
    pack?: Pick<AssetPackRef, 'file'>;
    streamTail?: Pick<StreamTailInfo, 'path'>;
}

interface PhysicalAssetFile {
    path: string;
    kind: 'asset' | 'pack' | 'streamTail';
}

/** A pack supplies the main bytes. A streaming preview is independently fetched at its own path. */
export function physicalAssetFiles(asset: AssetFileRefs): PhysicalAssetFile[] {
    const main = asset.pack?.file ?? asset.path;
    const files: PhysicalAssetFile[] = [];
    if (typeof main === 'string' && main) files.push({ path: main, kind: asset.pack?.file ? 'pack' : 'asset' });
    const preview = asset.streamTail?.path;
    if (typeof preview === 'string' && preview) files.push({ path: preview, kind: 'streamTail' });
    return files;
}
