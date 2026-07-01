// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { FileSystemBackend } from '../src/asset/Backend';
import { ManifestModel, type AddressableManifest } from '../src/asset/AddressableManifest';

describe('FileSystemBackend', () => {
    it('resolveUrl is identity — paths are already resolved build paths', () => {
        const be = new FileSystemBackend();
        expect(be.resolveUrl('assets/a1b2.ktx2')).toBe('assets/a1b2.ktx2');
        expect(be.resolveUrl('scenes/level.json')).toBe('scenes/level.json');
    });
});

describe('runtime resolveRef yields an extension-bearing path (KTX2 detection guard)', () => {
    // Regression guard for the class of bug where a runtime resolves a ref only at
    // fetch time (backend.resolveUrl), leaving TextureLoader to run its `.ktx2`
    // extension check on a bare uuid — which misses KTX2 and routes the container
    // through the image decoder. The manifest lookup must produce the extension
    // BEFORE the check, i.e. it belongs in resolveRef.
    it('manifest resolvePath maps a bare-uuid ref to its .ktx2 build path', () => {
        const manifest: AddressableManifest = {
            version: '2.0',
            groups: {
                main: {
                    bundleMode: 'local',
                    labels: [],
                    assets: {
                        'uuid-1': { path: 'assets/deadbeef.ktx2', type: 'texture', size: 0, labels: [] },
                    },
                },
            },
        };
        const resolved = ManifestModel.fromJson(manifest).resolvePath('uuid-1');
        expect(resolved).toBe('assets/deadbeef.ktx2');
        expect(resolved.toLowerCase().endsWith('.ktx2')).toBe(true);
    });
});
