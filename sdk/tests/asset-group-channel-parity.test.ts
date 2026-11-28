// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every type loadGroup acquires, releaseGroup gives back.
 *
 * Groups acquire one receipt per supported asset and release those same receipts.
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
 * the matching release channel.
 */
const TYPES: Array<{
    type: AddressableAssetType;
    loadMethod: keyof Assets;
    /** The typed door's first argument; absent when the method takes the path first. */
    loadArg?: string;
}> = [
    // The group loads through the ACQUIRE doors, so what it takes out is
    // recorded as a receipt on the bundle rather than left to be guessed from
    // the manifest at release time.
    { type: 'texture', loadMethod: 'acquireTexture' },
    { type: 'material', loadMethod: 'acquireTyped', loadArg: 'material' },
    { type: 'font', loadMethod: 'acquireTyped', loadArg: 'font' },
    { type: 'mesh', loadMethod: 'acquireTyped', loadArg: 'mesh' },
    { type: 'environment', loadMethod: 'acquireTyped', loadArg: 'environment' },
    { type: 'probeVolume', loadMethod: 'acquireTyped', loadArg: 'probeVolume' },
    { type: 'prefab', loadMethod: 'acquireTyped', loadArg: 'prefab' },
    { type: 'audio', loadMethod: 'acquireTyped', loadArg: 'audio' },
    // Nothing is special about spine any more: the bundle holds a receipt for
    // the era it took, and gives back that one. What a live entity holds it
    // holds through a receipt of its own.
    { type: 'spine', loadMethod: 'acquireSpine' },
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

        const release = vi.fn();
        const load = vi.spyOn(assets, row.loadMethod as 'acquireTexture')
            .mockResolvedValue({
                key: `${row.type}:a.bin`, generation: 1,
                value: { handle: 1, width: 1, height: 1 }, release,
            } as never);

        const bundle = await assets.loadGroup('dlc');
        if (row.loadArg) {
            expect(load, `loadGroup never loaded a ${row.type}`).toHaveBeenCalledWith(row.loadArg, 'a.bin');
        } else {
            expect(load, `loadGroup never loaded a ${row.type}`).toHaveBeenCalledWith('a.bin');
        }

        assets.releaseGroup('dlc');
        expect(bundle.scope.size).toBe(0);
        bundle.release();
        expect(release).toHaveBeenCalledTimes(1);
    });
});

describe('group ownership', () => {
    it('releases the group receipt after a manifest change without touching a path-only owner', async () => {
        const assets = Assets.create({ backend, module: mockModule });
        const unload = vi.fn();
        assets.register({ type: 'probe', extensions: ['.bin'], load: async path => ({ path }), unload });
        assets.setManifest(manifestWith('probe'));
        try {
            const independent = await assets.load('probe', 'a.bin');
            const bundle = await assets.loadGroup('dlc');
            const next = manifestWith('probe');
            next.groups.dlc.assets = { 'b.bin': { ...next.groups.dlc.assets['a.bin'], path: 'b.bin' } };
            assets.setManifest(next);
            const newer = await assets.load('probe', 'b.bin');

            assets.releaseGroup('dlc');
            expect(bundle.scope.size).toBe(0);
            expect(unload).not.toHaveBeenCalled();
            bundle.release();
            assets.releaseGroup('dlc');
            expect(unload).not.toHaveBeenCalled();
            assets.releaseTyped('probe', 'a.bin');
            assets.releaseTyped('probe', 'b.bin');
            expect(unload.mock.calls.map(([value]) => value)).toEqual([independent, newer]);
        } finally { assets.releaseAll(); }
    });

    it.each(['bundle', 'scope'])('releases the next group bundle after releasing a %s directly', async method => {
        const assets = Assets.create({ backend, module: mockModule });
        assets.setManifest(manifestWith('texture'));
        const firstRelease = vi.fn(), secondRelease = vi.fn(), thirdRelease = vi.fn();
        const load = vi.spyOn(assets, 'acquireTexture');
        [firstRelease, secondRelease, thirdRelease].forEach((release, i) => load.mockResolvedValueOnce({
            key: 'texture:a.bin', generation: i + 1,
            value: { handle: i + 1, width: 1, height: 1 }, release,
        } as never));
        const first = await assets.loadGroup('dlc');
        const second = await assets.loadGroup('dlc');
        const third = await assets.loadGroup('dlc');
        if (method === 'bundle') first.release();
        else first.scope.releaseAll();
        assets.releaseGroup('dlc');
        expect(second.scope.size).toBe(0);
        expect(third.scope.size).toBe(1);
        expect(thirdRelease).not.toHaveBeenCalled();
        second.release();
        expect(firstRelease).toHaveBeenCalledTimes(1);
        expect(secondRelease).toHaveBeenCalledTimes(1);
        assets.releaseGroup('dlc');
        expect(thirdRelease).toHaveBeenCalledTimes(1);
    });

    it('drains the bundle on reset and stops a new batch retired by its initial progress callback', async () => {
        const assets = Assets.create({ backend, module: mockModule });
        assets.setManifest(manifestWith('probe'));
        const unload = vi.fn();
        const load = vi.fn(async (path: string) => ({ path }));
        assets.register({ type: 'probe', extensions: ['.bin'], load, unload });
        const bundle = await assets.loadGroup('dlc');
        await expect(assets.loadGroup('dlc', () => assets.releaseAll())).rejects.toThrow();
        expect(bundle.scope.size).toBe(0);
        assets.releaseGroup('dlc');
        bundle.release();
        expect(load).toHaveBeenCalledTimes(1);
        expect(unload).toHaveBeenCalledTimes(1);
    });
});
