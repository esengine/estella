// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    ManifestModel,
    deriveManifestRevision,
    type AddressableManifest,
    type AddressableManifestAsset,
} from '../src/asset/AddressableManifest';
import { diffManifests } from '../src/asset/hotUpdate';

/** A one-`remote`-group manifest keyed by uuid, as a cooked build emits. Each
 *  call site overrides individual assets to model a re-cook. */
function manifest(
    assets: Record<string, Partial<AddressableManifestAsset>>,
    revision?: string,
): AddressableManifest {
    const full: Record<string, AddressableManifestAsset> = {};
    for (const [key, a] of Object.entries(assets)) {
        full[key] = {
            path: a.path ?? `assets/${key}.png`,
            type: a.type ?? 'texture',
            size: a.size ?? 1,
            labels: a.labels ?? [],
            ...(a.contentHash != null ? { contentHash: a.contentHash } : {}),
        };
    }
    const m: AddressableManifest = {
        version: '2.0',
        groups: { cdn: { bundleMode: 'remote', labels: [], assets: full } },
    };
    if (revision != null) m.revision = revision;
    return m;
}

const model = (m: AddressableManifest) => ManifestModel.fromJson(m);

describe('deriveManifestRevision', () => {
    it('is stable across group/asset ordering', () => {
        const a = deriveManifestRevision(manifest({
            'uuid-1': { contentHash: 'aaaa' }, 'uuid-2': { contentHash: 'bbbb' },
        }));
        const b = deriveManifestRevision(manifest({
            'uuid-2': { contentHash: 'bbbb' }, 'uuid-1': { contentHash: 'aaaa' },
        }));
        expect(a).toBe(b);
    });

    it('changes when any asset content changes', () => {
        const a = deriveManifestRevision(manifest({ 'uuid-1': { contentHash: 'aaaa' } }));
        const b = deriveManifestRevision(manifest({ 'uuid-1': { contentHash: 'cccc' } }));
        expect(a).not.toBe(b);
    });

    it('changes when the asset set changes', () => {
        const a = deriveManifestRevision(manifest({ 'uuid-1': { contentHash: 'aaaa' } }));
        const b = deriveManifestRevision(manifest({
            'uuid-1': { contentHash: 'aaaa' }, 'uuid-2': { contentHash: 'bbbb' },
        }));
        expect(a).not.toBe(b);
    });
});

describe('diffManifests', () => {
    it('treats a null current manifest as a full update (first install)', () => {
        const next = model(manifest({
            'uuid-1': { contentHash: 'aaaa', size: 10 },
            'uuid-2': { contentHash: 'bbbb', size: 20 },
        }));
        const plan = diffManifests(null, next);
        expect(plan.hasUpdate).toBe(true);
        expect(plan.changedAssets).toHaveLength(2);
        expect(plan.changedGroups).toEqual(['cdn']);
        expect(plan.totalBytes).toBe(30);
        expect(plan.removedAssets).toEqual([]);
    });

    it('reports no update for identical manifests', () => {
        const m = () => model(manifest(
            { 'uuid-1': { contentHash: 'aaaa' } }, 'rev-1',
        ));
        const plan = diffManifests(m(), m());
        expect(plan.hasUpdate).toBe(false);
        expect(plan.changedAssets).toEqual([]);
        expect(plan.changedGroups).toEqual([]);
        expect(plan.totalBytes).toBe(0);
    });

    it('detects a single content-changed asset by contentHash (path unchanged)', () => {
        const current = model(manifest({
            'uuid-1': { contentHash: 'aaaa', path: 'assets/logo.png', size: 5 },
            'uuid-2': { contentHash: 'bbbb', size: 7 },
        }));
        // Re-cook: uuid-1's bytes changed. Content addressing would rename the
        // file, but even a fixed-path (non-CA) asset is caught via contentHash.
        const next = model(manifest({
            'uuid-1': { contentHash: 'zzzz', path: 'assets/logo.png', size: 6 },
            'uuid-2': { contentHash: 'bbbb', size: 7 },
        }));
        const plan = diffManifests(current, next);
        expect(plan.hasUpdate).toBe(true);
        expect(plan.changedAssets.map((c) => c.key)).toEqual(['uuid-1']);
        expect(plan.changedAssets[0].contentHash).toBe('zzzz');
        expect(plan.totalBytes).toBe(6);
    });

    it('reports an added asset as changed and a dropped asset as removed', () => {
        const current = model(manifest({ 'uuid-1': { contentHash: 'aaaa' } }));
        const next = model(manifest({
            'uuid-1': { contentHash: 'aaaa' }, 'uuid-3': { contentHash: 'dddd', size: 4 },
        }));
        const added = diffManifests(current, next);
        expect(added.changedAssets.map((c) => c.key)).toEqual(['uuid-3']);
        expect(added.removedAssets).toEqual([]);

        const dropped = diffManifests(next, current);
        expect(dropped.changedAssets).toEqual([]);
        expect(dropped.removedAssets.map((c) => c.key)).toEqual(['uuid-3']);
        expect(dropped.hasUpdate).toBe(false); // nothing to download
    });

    it('falls back to build-path comparison when contentHashes are absent', () => {
        const current = model(manifest({ 'uuid-1': { path: 'assets/a-old.png' } }));
        const next = model(manifest({ 'uuid-1': { path: 'assets/a-new.png' } }));
        const plan = diffManifests(current, next);
        expect(plan.changedAssets.map((c) => c.path)).toEqual(['assets/a-new.png']);
    });

    it('signals hasUpdate on a revision move even if per-asset detection is blind', () => {
        // No contentHashes and identical paths → per-asset diff sees nothing, but
        // a moved top-level revision still flags that content shifted.
        const current = model(manifest({ 'uuid-1': { path: 'assets/a.png' } }, 'rev-1'));
        const next = model(manifest({ 'uuid-1': { path: 'assets/a.png' } }, 'rev-2'));
        const plan = diffManifests(current, next);
        expect(plan.changedAssets).toEqual([]);
        expect(plan.hasUpdate).toBe(true);
        expect(plan.fromRevision).toBe('rev-1');
        expect(plan.toRevision).toBe('rev-2');
    });
});
