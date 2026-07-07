// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The one primitive shared by every path-keyed runtime store (FSM, BT, tilemap,
 * timeline) to map an authored component ref to its resolved store key. The key
 * must equal what the loader registered under — resolver + addressable Catalog,
 * the two steps of every typed load. Resolver-only resolution diverges the
 * moment the Catalog carries an address mapping.
 */
import { describe, it, expect } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import { resolveAssetKey } from '../src/asset/resolveAssetKey';
import type { Backend } from '../src/asset/Backend';
import type { ESEngineModule } from '../src/wasm';

const UUID = 'e43a0ed9-50e9-46d8-b1db-da1c549590a8';

function buildAssets(catalog?: Catalog): Assets {
    const backend: Backend = {
        resolveUrl: (p: string) => p,
        fetchText: async () => '',
        fetchBinary: async () => new ArrayBuffer(0),
    } as unknown as Backend;
    return Assets.create({
        backend,
        catalog,
        module: { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule,
    });
}

describe('resolveAssetKey', () => {
    it('falls back to the raw ref when there is no Assets resource', () => {
        expect(resolveAssetKey(null, 'a/b.esbt')).toBe('a/b.esbt');
        expect(resolveAssetKey(undefined, `@uuid:${UUID}`)).toBe(`@uuid:${UUID}`);
    });

    it('returns the resolver output when it resolves', () => {
        const assets = buildAssets();
        assets.setAssetRefResolver(ref => `estella://project/${ref}`);

        expect(resolveAssetKey(assets, 'a/b.esfsm')).toBe('estella://project/a/b.esfsm');
    });

    it('falls back to the raw ref when the resolver returns null (code-registered name)', () => {
        const assets = buildAssets();
        assets.setAssetRefResolver(() => null);

        expect(resolveAssetKey(assets, 'myCodeFsm')).toBe('myCodeFsm');
    });

    it('applies the addressable Catalog after the resolver (registration-key parity)', () => {
        const catalog = Catalog.fromJson({
            version: 1,
            entries: { 'assets/ai/boss.esfsm': { type: 'statemachine' } },
            addresses: { 'ai/boss': 'assets/ai/boss.esfsm' },
        });
        const assets = buildAssets(catalog);
        assets.setAssetRefResolver(ref => (ref === `@uuid:${UUID}` ? 'ai/boss' : ref));

        // loadTyped resolves @uuid → 'ai/boss' → Catalog → 'assets/ai/boss.esfsm'
        // and the loader registers under that path; the tick-time lookup must
        // land on the same key.
        expect(resolveAssetKey(assets, `@uuid:${UUID}`)).toBe('assets/ai/boss.esfsm');
        expect(resolveAssetKey(assets, 'ai/boss')).toBe('assets/ai/boss.esfsm');
    });
});
