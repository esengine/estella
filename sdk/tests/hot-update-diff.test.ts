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
            ...a,
            path: a.path ?? `assets/${key}.png`,
            type: a.type ?? 'texture',
            size: a.size ?? 1,
            labels: a.labels ?? [],
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

    it('ignores member order in nested settings and membership order in labels and formats', () => {
        const a = manifest({ art: {
            labels: ['hero', 'intro'], compressedFormats: ['etc2', 'astc'],
            textureImport: { filter: 'nearest', sliceBorder: { top: 1, left: 2, right: 3, bottom: 4 } },
        } });
        const b = manifest({ art: {
            textureImport: { sliceBorder: { bottom: 4, right: 3, left: 2, top: 1 }, filter: 'nearest' },
            compressedFormats: ['astc', 'etc2'], labels: ['intro', 'hero'],
        } });
        a.groups.cdn.labels = ['art', 'ui'];
        b.groups.cdn.labels = ['ui', 'art'];
        expect(deriveManifestRevision(a)).toBe(deriveManifestRevision(b));
        expect(diffManifests(model(a), model(b)).hasUpdate).toBe(false);
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
        expect(dropped.hasUpdate).toBe(true);
        expect(dropped.totalBytes).toBe(0);
    });

    it.each<Partial<AddressableManifestAsset>>([
        { textureImport: { filter: 'nearest' } },
        { textureImport: { sliceBorder: { left: 2, right: 2, bottom: 1, top: 1 } } },
        { metadata: { atlasFrame: { x: 4, y: 0, width: 8, height: 8 }, atlasPageWidth: 32, atlasPageHeight: 32 } },
        { spineImport: { atlas: 'atlas-key', cullingBounds: { x: 0, y: 0, width: 5, height: 10 } } },
        { address: 'assets/renamed.png' },
    ])('detects changed settings on an unchanged payload even with a legacy revision', settings => {
        const before = manifest({ art: { contentHash: 'same' } }, 'legacy');
        const after = manifest({ art: { ...settings, contentHash: 'same' } }, 'legacy');
        expect(deriveManifestRevision(before)).not.toBe(deriveManifestRevision(after));
        for (const [from, to] of [[before, after], [after, before]]) {
            const plan = diffManifests(model(from), model(to));
            expect(plan).toMatchObject({ hasUpdate: true, changedAssets: [], changedGroups: ['cdn'], totalBytes: 0 });
            expect(plan.reconfiguredAssets.map(a => a.key)).toEqual(['art']);
        }
    });

    it('installs a label-only edit without downloading or invalidating a held resource', () => {
        const a = manifest({ art: { contentHash: 'same', labels: ['intro'] } }, 'legacy');
        const b = manifest({ art: { contentHash: 'same', labels: ['outro'] } }, 'legacy');
        expect(deriveManifestRevision(a)).not.toBe(deriveManifestRevision(b));
        for (const [before, after] of [[a, b], [b, a]]) {
            expect(diffManifests(model(before), model(after))).toMatchObject({
                hasUpdate: true, changedGroups: ['cdn'], downloadFiles: [], changedAssets: [], reconfiguredAssets: [],
            });
        }
    });

    it('charges for a new delivery location and detects changes to empty groups', () => {
        const before = manifest({ art: { contentHash: 'same', size: 64 } });
        const after = manifest({ art: { contentHash: 'same', size: 64 } });
        after.groups.cdn.bundleMode = 'local';
        expect(deriveManifestRevision(before)).not.toBe(deriveManifestRevision(after));
        expect(diffManifests(model(before), model(after))).toMatchObject({
            changedAssets: [{ key: 'art' }], reconfiguredAssets: [], totalBytes: 64,
        });
        const empty = manifest({});
        const noGroups: AddressableManifest = { version: '2.0', groups: {} };
        expect(deriveManifestRevision(empty)).not.toBe(deriveManifestRevision(noGroups));
        expect(diffManifests(model(empty), model(noGroups))).toMatchObject({
            hasUpdate: true, changedGroups: ['cdn'], totalBytes: 0,
        });
    });

    it('falls back to build-path comparison when contentHashes are absent', () => {
        const current = model(manifest({ 'uuid-1': { path: 'assets/a-old.png' } }));
        const next = model(manifest({ 'uuid-1': { path: 'assets/a-new.png' } }));
        const plan = diffManifests(current, next);
        expect(plan.changedAssets.map((c) => c.path)).toEqual(['assets/a-new.png']);
    });

    it('verifies a newly supplied hash for a legacy payload at the same path', () => {
        const current = model(manifest({ art: {} }));
        const next = model(manifest({ art: { contentHash: 'new' } }));
        expect(diffManifests(current, next)).toMatchObject({
            changedAssets: [{ key: 'art' }], reconfiguredAssets: [], totalBytes: 1,
        });
    });

    it('charges once for a new preview shared by two textures and leaves the full images in place', () => {
        const tail = { path: 'old.jpg', size: 23, width: 2, height: 2, fullWidth: 4, fullHeight: 4 };
        const before = manifest({ a: { streamTail: tail }, b: { streamTail: tail } });
        const preview = { ...tail, path: 'assets/0123456789abcdef.jpg', size: 19 };
        const after = manifest({ a: { streamTail: preview }, b: { streamTail: preview } });
        const plan = diffManifests(model(before), model(after));
        expect(plan.changedAssets).toEqual([]);
        expect(plan.reconfiguredAssets.map(a => a.key)).toEqual(['a', 'b']);
        expect(plan.downloadFiles).toEqual([{ group: 'cdn', kind: 'streamTail', path: preview.path, size: 19, contentHash: '0123456789abcdef' }]);
        expect(plan.totalBytes).toBe(19);

        after.groups.cdn.assets.b.streamTail = undefined;
        expect(diffManifests(model(before), model(after)).totalBytes).toBe(19);
        expect(diffManifests(model(after), model(manifest({ a: {}, b: {} }))).downloadFiles).toEqual([]);
    });

    it('reuses the same physical file across an existing sprite and a new mesh preview', () => {
        const sprite = { path: 'shared.png', contentHash: 'same', size: 16 };
        const before = manifest({ sprite });
        const after = manifest({ sprite, mesh: { path: 'full.png', size: 64, streamTail: {
            ...sprite, width: 2, height: 2, fullWidth: 4, fullHeight: 4,
        } } });
        expect(diffManifests(model(before), model(after))).toMatchObject({
            downloadFiles: [{ path: 'full.png' }], totalBytes: 64,
        });
        const install = diffManifests(null, model(after));
        expect(install.downloadFiles.map(file => file.path).sort()).toEqual(['full.png', 'shared.png']);
        expect(install.totalBytes).toBe(80);
    });

    it('charges for a CDN move only when the resolved file location changes', () => {
        const preview = { path: 'small.png', size: 16, width: 2, height: 2, fullWidth: 4, fullHeight: 4 };
        const m = model(manifest({ art: { path: 'https://shared.test/full.png', contentHash: 'same', streamTail: preview } }));
        const change = diffManifests(m, m, { current: 'https://cdn.test/v1', next: 'https://cdn.test/v2' });
        expect(change).toMatchObject({ hasUpdate: true, changedAssets: [], reconfiguredAssets: [{ key: 'art' }],
            downloadFiles: [{ path: 'small.png' }], totalBytes: 16 });
        expect(diffManifests(m, m, { current: 'https://cdn.test/v1/', next: 'https://cdn.test/v1' }).hasUpdate).toBe(false);
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
