// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    packaged-runtime-address.test.ts
 * @brief   addressOf / resolveAddress recovers the authored path a content-addressed
 *          build hid — the directory a Spine atlas names its page PNG relative to.
 */
import { describe, it, expect } from 'vitest';
import { indexPackagedManifest, createPackagedAssetSource } from '../src/runtime/packagedRuntime';
import { ManifestModel, type AddressableManifest } from '../src/asset/AddressableManifest';
import { Catalog } from '../src/asset/Catalog';

// A content-addressed pack: the atlas and its page PNG are staged under hashed
// names, but each keeps `address` — the path it was authored at.
function manifest(): AddressableManifest {
    return {
        version: '2.0',
        groups: {
            main: {
                bundleMode: 'local',
                labels: [],
                assets: {
                    '11111111-1111-4111-8111-111111111111': { path: 'assets/aaa111.atlas', address: 'assets/spine/hero.atlas', type: 'binary', size: 10, labels: [] },
                    '22222222-2222-4222-8222-222222222222': { path: 'assets/bbb222.png', address: 'assets/spine/hero.png', type: 'texture', size: 20, labels: [] },
                },
            },
        },
    } as unknown as AddressableManifest;
}

describe('packaged addressOf / resolveAddress', () => {
    it('recovers the authored address from a staged (hashed) path', () => {
        const index = indexPackagedManifest(manifest());
        expect(index.addressOf('assets/aaa111.atlas')).toBe('assets/spine/hero.atlas');
    });

    it('recovers the authored address from a uuid ref', () => {
        const index = indexPackagedManifest(manifest());
        expect(index.addressOf('@uuid:11111111-1111-4111-8111-111111111111')).toBe('assets/spine/hero.atlas');
        expect(index.addressOf('11111111-1111-4111-8111-111111111111')).toBe('assets/spine/hero.atlas');
    });

    it('returns null for an unknown ref', () => {
        const index = indexPackagedManifest(manifest());
        expect(index.addressOf('assets/nope.atlas')).toBeNull();
    });

    it('resolves suffixed scene refs and keeps frames distinct on the same packed page', () => {
        const data = manifest();
        const entries = data.groups.main.assets;
        const image = entries['22222222-2222-4222-8222-222222222222'];
        image.metadata = { atlasFrame: { x: 0, y: 0, width: 2, height: 4 }, atlasPageWidth: 4, atlasPageHeight: 4 };
        entries.second = { ...image, address: 'assets/spine/other.png', metadata: {
            atlasFrame: { x: 2, y: 0, width: 2, height: 4 }, atlasPageWidth: 4, atlasPageHeight: 4,
        } };
        const index = indexPackagedManifest(data);
        const source = createPackagedAssetSource(index);
        for (const ref of ['assets/spine/other.png?v=2', '/assets/spine/other.png#detail', 'assets\\spine\\other.png?v=2']) {
            expect(source.resolveRef!(ref)).toBe(image.path);
            expect(source.resolveAddress!(ref)).toBe('assets/spine/other.png');
            expect(index.catalog?.getAtlasFrame(ref)?.uvOffset).toEqual([0.5, 0]);
        }
        const url = 'https://cdn.test/assets/spine/other.png?v=2';
        expect(source.resolveRef!(url)).toBe(url);
    });

    it('switches all lookups together and keeps separate sources independent', () => {
        const index = indexPackagedManifest(manifest());
        const first = createPackagedAssetSource(index);
        const second = createPackagedAssetSource(index);
        const next = manifest();
        const records = next.groups.main.assets;
        const [atlas, art] = Object.keys(records);
        records[art].path = 'assets/new.png';
        records[art].address = 'assets/art/hero.png';
        records[art].textureImport = { wrap: 'mirror' };
        records[art].metadata = { atlasFrame: { x: 2, y: 0, width: 2, height: 4 }, atlasPageWidth: 4, atlasPageHeight: 4 };
        const bounds = { x: 0, y: 0, width: 2, height: 4 };
        records[atlas].spineImport = { atlas: art, cullingBounds: bounds };
        const resolve = first.resolveRef!;
        const catalog = first.activateManifest!(ManifestModel.fromJson(next), index.catalog);
        expect(resolve(art)).toBe('assets/new.png');
        expect(first.resolveAddress!('assets/new.png')).toBe('assets/art/hero.png');
        expect(first.listAssetPaths!()).toContain('assets/art/hero.png');
        expect(first.textureImportSettings!(art)).toEqual({ wrap: 'mirror' });
        expect(first.spineCulling!(atlas, art)).toEqual(bounds);
        expect(catalog.getAtlasFrame(art)?.uvOffset).toEqual([0.5, 0]);
        expect(second.resolveRef!(art)).toBe('assets/bbb222.png');
        expect(index.resolvePath(art)).toBe('assets/bbb222.png');
        const custom = Catalog.empty();
        expect(second.activateManifest!(ManifestModel.fromJson(next), custom)).toBe(custom);
        expect(second.resolveRef!(art)).toBe('assets/new.png');

        expect(first.activateManifest!(null).getAtlasFrame(art)).toBeNull();
        expect(first.listAssetPaths!()).toEqual([]);
        expect(first.textureImportSettings!(art)).toBeUndefined();
    });

    it('the source exposes resolveAddress, so <atlasDir>/page resolves to the staged page', () => {
        const index = indexPackagedManifest(manifest());
        const source = createPackagedAssetSource(index, { backend: {} as never, decodePixels: (async () => ({ width: 0, height: 0, pixels: new Uint8Array() })) });
        // The atlas names its page "hero.png"; join it onto the atlas's authored dir,
        // then resolve — the way loadSpineScene does — and it lands on the staged file.
        const atlasAddr = source.resolveAddress!('assets/aaa111.atlas')!;
        const dir = atlasAddr.substring(0, atlasAddr.lastIndexOf('/'));
        expect(source.resolveRef!(`${dir}/hero.png`)).toBe('assets/bbb222.png');
    });
});
