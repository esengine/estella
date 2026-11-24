// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A packed asset reads out of its pack, which is fetched once per round of reads.
 */
import { describe, it, expect, vi } from 'vitest';
import { manifestBackend } from '../src/asset/manifestBackend';
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
        const active = model();
        const backend = manifestBackend(net, () => active, async () => {});
        expect(await backend.fetchText('assets/a.esmaterial')).toBe('{"a":1}');
        expect([...new Uint8Array(await backend.fetchBinary('https://cdn.example/game/assets/b.esmesh'))]).toEqual([9, 8, 7]);
        expect([...new Uint8Array(await backend.fetchBinary('assets/c.png'))]).toEqual([42]);
        expect(net.fetched).toEqual(['packs/p1.pack', 'assets/c.png']);
    });

    it('lets go of a pack once every member was read, and fetches it again for a later read', async () => {
        const net = inner();
        const active = model();
        const backend = manifestBackend(net, () => active, async () => {});
        await Promise.all([backend.fetchBinary('assets/a.esmaterial'), backend.fetchBinary('assets/b.esmesh')]);
        await backend.fetchBinary('assets/a.esmaterial');
        expect(net.fetched).toEqual(['packs/p1.pack', 'packs/p1.pack']);
    });

    it('asks the manifest in force: once a manifest stops packing an asset, its own file is read', async () => {
        const net = inner();
        let current = model();
        const backend = manifestBackend(net, () => current, async () => {});
        await backend.fetchBinary('assets/b.esmesh');
        current = model(false);
        await backend.fetchBinary('assets/b.esmesh');
        expect(net.fetched).toEqual(['packs/p1.pack', 'assets/b.esmesh']);
    });

    it('keeps unread pack members across label edits and drops them when their byte ranges change', async () => {
        const net = inner();
        let current = model();
        const backend = manifestBackend(net, () => current, async () => {});
        await backend.fetchBinary('assets/a.esmaterial');
        const main = current.group('main')!;
        current = ManifestModel.fromJson({ version: '2.0', groups: { main: { ...main, labels: ['new'] } } });
        await backend.fetchBinary('assets/b.esmesh');
        expect(net.fetched).toEqual(['packs/p1.pack']);
        await backend.fetchBinary('assets/a.esmaterial');
        const b = main.assets.b;
        current = ManifestModel.fromJson({ version: '2.0', groups: { main: { ...main, assets: {
            ...main.assets, b: { ...b, pack: { ...b.pack!, offset: 8, size: 2 } },
        } } } });
        expect([...new Uint8Array(await backend.fetchBinary('assets/b.esmesh'))]).toEqual([8, 7]);
        expect(net.fetched).toHaveLength(3);
    });

    it('waits for the owning package for both a packed member and its separately staged preview', async () => {
        const net = inner();
        const asset = { path: 'hero.ktx2', type: 'texture' as const, size: 3, labels: [],
            pack: { file: 'packs/p1.pack', offset: 7, size: 3 },
            streamTail: { path: 'small.png', size: 1, width: 1, height: 1, fullWidth: 4, fullHeight: 4 } };
        const active = ManifestModel.fromJson({ version: '2.0', groups: { art: { bundleMode: 'lazy', labels: [], assets: { hero: asset } } } });
        let open!: () => void;
        const ready = new Promise<void>(resolve => { open = resolve; });
        const mount = vi.fn(() => ready);
        const backend = manifestBackend(net, () => active, mount);
        const packed = backend.fetchBinary(net.resolveUrl('hero.ktx2'));
        const preview = backend.fetchBinary(net.resolveUrl('small.png'));
        expect(backend.prepareFile!(net.resolveUrl('packs/p1.pack'))).toBe(ready);
        expect(mount.mock.calls).toEqual([['art'], ['art'], ['art']]);
        expect(net.fetched).toEqual([]);
        open();
        expect([...new Uint8Array(await packed)]).toEqual([9, 8, 7]);
        expect([...new Uint8Array(await preview)]).toEqual([42]);
        expect(net.fetched).toEqual(['packs/p1.pack', net.resolveUrl('small.png')]);
    });
});
