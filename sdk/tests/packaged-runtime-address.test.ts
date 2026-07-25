// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    packaged-runtime-address.test.ts
 * @brief   addressOf / resolveAddress recovers the authored path a content-addressed
 *          build hid — the directory a Spine atlas names its page PNG relative to.
 */
import { describe, it, expect } from 'vitest';
import { indexPackagedManifest, createPackagedAssetSource } from '../src/packagedRuntime';
import type { AddressableManifest } from '../src/asset/AddressableManifest';

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
