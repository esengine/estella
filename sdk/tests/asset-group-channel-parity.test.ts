// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every type loadGroup acquires, releaseGroup gives back.
 *
 * They were two switch statements. Load handled `font`; release listed only
 * `bitmap-font`, so a group carrying a font held its reference for the life of
 * the process — and nothing failed, because no test walked both halves for the
 * same type. Now one table drives both, and this walks every entry in it.
 *
 * A new addressable type is a new row here. That is the point: a row with a
 * loader and no release has to say so out loud (spine does), rather than being
 * a case somebody forgot to add to the second switch.
 */
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { AddressableManifest, AddressableAssetType } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';

vi.mock('../src/wasm/resourceManager', () => ({
    initResourceManager: vi.fn(),
    shutdownResourceManager: vi.fn(),
    getResourceManager: vi.fn(() => null),
    requireResourceManager: vi.fn(() => ({
        releaseTexture: vi.fn(),
        getTextureDimensions: vi.fn(() => null),
        setTextureMetadata: vi.fn(),
    })),
    evictTextureDimensions: vi.fn(),
    textureDimensions: vi.fn(() => null),
}));

const mockModule = { _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(8) } as never;

const backend = {
    fetchBinary: async () => new ArrayBuffer(8),
    fetchText: async () => '{}',
    resolveUrl: (p: string) => p,
} as unknown as Backend;

/**
 * One row per addressable type a group can carry, with the loader to stub and
 * the release the type is supposed to route to. `releasesVia: null` means the
 * type's lifetime is owned elsewhere and releaseGroup must NOT touch it.
 */
const TYPES: Array<{
    type: AddressableAssetType;
    loadMethod: keyof Assets;
    releasesVia: string | null;
}> = [
    { type: 'texture', loadMethod: 'loadTexture', releasesVia: 'texture' },
    { type: 'material', loadMethod: 'loadMaterial', releasesVia: 'material' },
    { type: 'font', loadMethod: 'loadFont', releasesVia: 'font' },
    { type: 'bitmap-font', loadMethod: 'loadFont', releasesVia: 'font' },
    { type: 'prefab', loadMethod: 'loadPrefab', releasesVia: 'prefab' },
    { type: 'audio', loadMethod: 'loadAudio', releasesVia: 'audio' },
    // Skeletons bind to spawned entities and belong to the SpineManager
    // lifecycle; releasing one here could yank it from under a live entity.
    { type: 'spine', loadMethod: 'loadSpine', releasesVia: null },
];

function manifestWith(type: AddressableAssetType): AddressableManifest {
    return {
        version: '2.0',
        groups: {
            dlc: {
                bundleMode: 'local',
                labels: [],
                assets: { 'a.bin': { path: 'a.bin', type, size: 0, labels: [] } },
            },
        },
    } as AddressableManifest;
}

describe.each(TYPES)('group channel: $type', (row) => {
    it('is loaded by loadGroup and released by releaseGroup', async () => {
        const assets = Assets.create({ backend, module: mockModule });
        assets.setManifest(manifestWith(row.type));

        const load = vi.spyOn(assets, row.loadMethod as 'loadTexture')
            .mockResolvedValue({ handle: 1, width: 1, height: 1 } as never);
        // releaseTexture and releaseTyped are the only two release doors; both
        // are watched so a row cannot pass by going through neither.
        const releaseTexture = vi.spyOn(assets, 'releaseTexture').mockImplementation(() => {});
        const releaseTyped = vi.spyOn(assets, 'releaseTyped').mockImplementation(() => {});

        await assets.loadGroup('dlc');
        expect(load, `loadGroup never loaded a ${row.type}`).toHaveBeenCalledWith('a.bin');

        assets.releaseGroup('dlc');

        if (row.releasesVia === null) {
            expect(releaseTexture, `releaseGroup released a ${row.type}, whose lifetime is owned elsewhere`).not.toHaveBeenCalled();
            expect(releaseTyped, `releaseGroup released a ${row.type}, whose lifetime is owned elsewhere`).not.toHaveBeenCalled();
            return;
        }
        if (row.releasesVia === 'texture') {
            expect(releaseTexture, 'a texture was loaded by the group and never released').toHaveBeenCalledWith('a.bin');
            return;
        }
        expect(
            releaseTyped.mock.calls.map((c) => c[0]),
            `a ${row.type} was loaded by the group and never released`,
        ).toContain(row.releasesVia);
    });
});

describe('group release addressing', () => {
    it('releases the same path it loaded', async () => {
        // A release that resolves the path differently frees a key nobody holds:
        // a leak that looks exactly like a working release.
        const assets = Assets.create({ backend, module: mockModule });
        assets.setManifest(manifestWith('texture'));
        const load = vi.spyOn(assets, 'loadTexture')
            .mockResolvedValue({ handle: 1, width: 1, height: 1 } as never);
        const release = vi.spyOn(assets, 'releaseTexture').mockImplementation(() => {});

        await assets.loadGroup('dlc');
        assets.releaseGroup('dlc');

        expect(release.mock.calls[0][0]).toBe(load.mock.calls[0][0]);
    });
});
