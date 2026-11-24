// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetPackRef, StreamTailInfo } from './AddressableManifest';

/** File references carried by both cook entries and shipped manifest entries. */
export interface AssetFileRefs {
    path: string;
    size?: number;
    contentHash?: string;
    pack?: Pick<AssetPackRef, 'file'>;
    streamTail?: Pick<StreamTailInfo, 'path'> & Partial<Pick<StreamTailInfo, 'size' | 'contentHash'>>;
}

export interface PhysicalAssetFile {
    path: string;
    kind: 'asset' | 'pack' | 'streamTail';
    size?: number;
    contentHash?: string;
}

/** Delivery location of a remote file. Fully qualified paths carry their own origin. */
export function remoteAssetUrl(path: string, root?: string | null): string {
    if (!root || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
    return `${root.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Recover a relative manifest path from a loader URL under the active, normalized CDN root. */
export function pathWithinRemoteRoot(path: string, root: string | undefined): string {
    return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** A pack supplies the main bytes. A streaming preview has its own file and checksum. */
export function physicalAssetFiles(asset: AssetFileRefs): PhysicalAssetFile[] {
    const files: PhysicalAssetFile[] = [];
    const main = asset.pack?.file ?? asset.path;
    if (typeof main === 'string' && main) {
        files.push(asset.pack?.file
            ? { kind: 'pack', path: main }
            : { kind: 'asset', path: main, size: asset.size, contentHash: asset.contentHash });
    }
    const tail = asset.streamTail;
    if (typeof tail?.path === 'string' && tail.path) {
        // Older content-addressed cooks wrote the XXH64 only in the preview's filename.
        const hash = tail.contentHash ?? /(?:^|\/)([0-9a-f]{16})\.(?:ktx2(?:\.bin)?|png|jpe?g)$/i.exec(tail.path)?.[1].toLowerCase();
        files.push({ kind: 'streamTail', path: tail.path, size: tail.size, contentHash: hash });
    }
    return files;
}
