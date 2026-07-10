// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-atlas-page-resolve.test.ts
 * @brief   Regression: a spine atlas names its pages by AUTHORED filename
 *          (`spineboy.png`), but a cook may re-encode the staged file (.ktx2)
 *          or content-address it. The page path must resolve through
 *          `source.resolveRef` like every other fetch, and a KTX2 page must
 *          transcode through the realm's basis provider instead of the image
 *          decoder (which cannot decode KTX2 on any platform).
 */
import { describe, it, expect, vi } from 'vitest';

const { rm, createTextureFromPixels } = vi.hoisted(() => ({
    rm: {
        registerTextureWithPath: vi.fn(),
        getTextureGLId: vi.fn(() => 7),
    },
    createTextureFromPixels: vi.fn(() => 11),
}));
vi.mock('../src/resourceManager', () => ({
    requireResourceManager: () => rm,
}));
vi.mock('../src/runtimeAssets', () => ({ createTextureFromPixels }));

import { loadSpineAssets } from '../src/spine/loadSpineScene';
import type { RuntimeAssetSource } from '../src/runtimeAssets';
import type { BasisTranscoder } from '../src/asset/compressed';

const ATLAS = 'spineboy.png\nsize: 4,4\nformat: RGBA8888\n';

function makeSource(resolved: Record<string, string>): RuntimeAssetSource & {
    decodePixels: ReturnType<typeof vi.fn>;
    fetchedBinaries: string[];
} {
    const fetchedBinaries: string[] = [];
    return {
        backend: {
            fetchText: vi.fn(async () => ATLAS),
            fetchBinary: vi.fn(async (p: string) => {
                fetchedBinaries.push(p);
                return new Uint8Array([1, 2, 3]).buffer;
            }),
        } as never,
        decodePixels: vi.fn(async () => ({ width: 4, height: 4, pixels: new Uint8Array(64) })),
        resolveRef: (r: string) => resolved[r] ?? r,
        fetchedBinaries,
    };
}

const PAIR = [{ skeleton: 'assets/spine/boy.skel', atlas: 'assets/spine/boy.atlas' }];

describe('loadSpineAssets resolves atlas page paths through the manifest', () => {
    it('transcodes a KTX2-staged page via the basis provider, keyed by logical path', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/spine/spineboy.ktx2' });
        const transcoder: BasisTranscoder = {
            transcode: vi.fn(() => null),
            transcodeToRgba: vi.fn(() => ({ width: 2, height: 2, data: new Uint8Array(16) })),
        };
        const info = await loadSpineAssets({} as never, source, null, PAIR, async () => transcoder);

        expect(source.decodePixels).not.toHaveBeenCalled();
        expect(source.fetchedBinaries).toContain('assets/spine/spineboy.ktx2');
        expect(transcoder.transcodeToRgba).toHaveBeenCalledTimes(1);
        // Registered under the LOGICAL path — the atlas's stable identity.
        expect(rm.registerTextureWithPath).toHaveBeenCalledWith(11, 'assets/spine/spineboy.png');
        const tex = info.get('assets/spine/boy.skel:assets/spine/boy.atlas')!.textures.get('spineboy.png');
        expect(tex).toEqual({ glId: 7, w: 2, h: 2 });
    });

    it('recognizes the WeChat .ktx2.bin staging spelling as KTX2', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/spine/spineboy.ktx2.bin' });
        const transcoder: BasisTranscoder = {
            transcode: vi.fn(() => null),
            transcodeToRgba: vi.fn(() => ({ width: 2, height: 2, data: new Uint8Array(16) })),
        };
        await loadSpineAssets({} as never, source, null, PAIR, async () => transcoder);
        expect(source.decodePixels).not.toHaveBeenCalled();
        expect(transcoder.transcodeToRgba).toHaveBeenCalledTimes(1);
    });

    it('decodes a content-addressed page from its STAGED path', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/1234abcd.png' });
        await loadSpineAssets({} as never, source, null, PAIR);
        expect(source.decodePixels).toHaveBeenCalledWith('assets/1234abcd.png', false);
    });

    it('a KTX2 page in a realm without basis warns and skips, not throws', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/spine/spineboy.ktx2' });
        const info = await loadSpineAssets({} as never, source, null, PAIR, async () => null);
        expect(info.get('assets/spine/boy.skel:assets/spine/boy.atlas')!.textures.size).toBe(0);
    });
});
