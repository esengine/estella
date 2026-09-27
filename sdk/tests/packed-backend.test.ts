// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A packed asset reads out of its pack, which is fetched once per round of reads.
 */
import { describe, it, expect } from 'vitest';
import { packedBackend } from '../src/asset/packedBackend';
import { ManifestModel, type AddressableManifest } from '../src/asset/AddressableManifest';
import type { Backend } from '../src/asset/Backend';

const PACK = new Uint8Array([...new TextEncoder().encode('{"a":1}'), 9, 8, 7]);

function inner(): Backend & { fetched: string[] } {
    const fetched: string[] = [];
    return {
        fetched,
        resolveUrl: (p: string) => `https://cdn.example/game/${p}`,
        async fetchBinary(p: string) {
            fetched.push(p);
            if (p === 'packs/p1.pack') return PACK.slice().buffer;
            return new Uint8Array([42]).buffer;
        },
        async fetchText(p: string) { fetched.push(p); return 'loose'; },
    };
}

function model(withPack = true): ManifestModel {
    const m: AddressableManifest = { version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets: {
        a: { path: 'assets/a.esmaterial', type: 'material', size: 7, labels: [], ...(withPack ? { pack: { file: 'packs/p1.pack', offset: 0, size: 7 } } : {}) },
        b: { path: 'assets/b.esmesh', type: 'binary', size: 3, labels: [], ...(withPack ? { pack: { file: 'packs/p1.pack', offset: 7, size: 3 } } : {}) },
        c: { path: 'assets/c.png', type: 'texture', size: 1, labels: [] },
    } } } };
    return ManifestModel.fromJson(m);
}

describe('reading a packed asset', () => {
    it('slices it out of its pack, by path or by the url it resolves to', async () => {
        const net = inner();
        const backend = packedBackend(net, () => model());
        expect(await backend.fetchText('assets/a.esmaterial')).toBe('{"a":1}');
        expect([...new Uint8Array(await backend.fetchBinary('https://cdn.example/game/assets/b.esmesh'))]).toEqual([9, 8, 7]);
        expect([...new Uint8Array(await backend.fetchBinary('assets/c.png'))]).toEqual([42]);
        expect(net.fetched).toEqual(['packs/p1.pack', 'assets/c.png']);
    });

    it('lets go of a pack once every member was read, and fetches it again for a later read', async () => {
        const net = inner();
        const backend = packedBackend(net, () => model());
        await Promise.all([backend.fetchBinary('assets/a.esmaterial'), backend.fetchBinary('assets/b.esmesh')]);
        await backend.fetchBinary('assets/a.esmaterial');
        expect(net.fetched).toEqual(['packs/p1.pack', 'packs/p1.pack']);
    });

    it('asks the manifest in force: once a manifest stops packing an asset, its own file is read', async () => {
        const net = inner();
        let current = model();
        const backend = packedBackend(net, () => current);
        await backend.fetchBinary('assets/b.esmesh');
        current = model(false);
        await backend.fetchBinary('assets/b.esmesh');
        expect(net.fetched).toEqual(['packs/p1.pack', 'assets/b.esmesh']);
    });
});
