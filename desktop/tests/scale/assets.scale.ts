// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Asset-database budgets against the 50k-asset corpus.
 *
 * These are the costs a user meets before they have done anything: opening the
 * project, saving a file, deleting a folder's worth of sprites. Every one of
 * them was O(whole project) at some point in this repo's history, and the one
 * that shipped was found by someone whose project was big enough to notice —
 * 36k assets, 52 seconds to delete 22 files. The corpus is bigger than that.
 */
import { describe, it, beforeAll, expect } from 'vitest';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
    scanAssetDatabase,
    updateAssetIndex,
    readCachedAssetIndex,
    type AssetIndex,
} from '../../electron/assetDb';
import { collectAssetUsagesOfAll } from '../../src/project/assetRefs';
import { budgeted, calibrate, corpusDir } from './harness';

const GROUP = 'Asset database — 50,000 assets';

let root: string;
let index: AssetIndex;

beforeAll(async () => {
    root = corpusDir();
    await calibrate(root);
}, 300_000);

describe(GROUP, () => {
    it('cold scan', async () => {
        const res = await budgeted({
            name: 'assetdb: cold scan of the whole project',
            group: GROUP,
            unit: 'io',
            budget: 18,
            why: 'Every project open pays this once, and nothing is on screen until it lands. '
                + 'It walks the tree, reads every .meta and builds the dependency graph.',
            runs: 3,
        }, () => scanAssetDatabase(root, { write: true }));

        index = res.index;
        expect(res.ok).toBe(true);
        // The corpus is exact by construction; a scan that finds a different
        // number is measuring a tree nobody described.
        expect(index.entries.length).toBe(50_000);
    }, 600_000);

    it('reads the cached index', async () => {
        await budgeted({
            name: 'assetdb: read the cached index',
            group: GROUP,
            unit: 'parse',
            budget: 16,
            why: 'The warm path a second window or a reopened project takes instead of scanning. '
                + 'It is one JSON.parse of 50k entries plus the dep graph.',
            runs: 5,
        }, async () => {
            const cached = await readCachedAssetIndex(root);
            expect(cached?.entries.length).toBe(50_000);
            return cached;
        });
    }, 300_000);

    it('incremental scan after one file changes', async () => {
        const changed = ['assets/textures/_bulk/tex-00001.png'];
        await budgeted({
            name: 'assetdb: incremental scan, one file touched',
            group: GROUP,
            unit: 'io',
            budget: 0.25,
            why: 'What the watcher fires on every save. This exists so a keystroke does not re-walk '
                + 'the project — if it approaches the cold scan, the incremental path has stopped being one.',
            runs: 5,
        }, async () => {
            const res = await updateAssetIndex(root, index, changed, { write: false });
            expect(res.fullRescan).toBe(false);
            return res;
        });
    }, 300_000);

    it('usages of a 22-file selection', async () => {
        const paths = Array.from({ length: 22 }, (_, i) => `assets/textures/_bulk/tex-${String(100 + i).padStart(5, '0')}.png`);
        await budgeted({
            name: 'assetdb: usages of a 22-file selection',
            group: GROUP,
            unit: 'parse',
            budget: 9,
            why: 'The question the delete-confirm dialog asks before it can open. Asked once per '
                + 'selected asset over a freshly built map, 22 files took 52 seconds on a project '
                + 'smaller than this one. It must invert the index once for the batch, not once per file.',
            runs: 5,
        }, () => collectAssetUsagesOfAll(index, paths));
    }, 300_000);

    it('usages of one asset', async () => {
        await budgeted({
            name: 'assetdb: usages of one asset',
            group: GROUP,
            unit: 'parse',
            budget: 9,
            why: 'Find Usages on a single sprite — the interactive case, where the dialog is waiting.',
            runs: 5,
        }, () => collectAssetUsagesOfAll(index, ['assets/textures/_bulk/tex-00100.png']));
    }, 300_000);

    it('incremental scan after 22 files are deleted', async () => {
        // The reported case, restored afterwards so the corpus survives the run:
        // the removal is real (the scan reads the disk, not a list) and the exact
        // bytes go back.
        const rels = Array.from({ length: 22 }, (_, i) => `assets/textures/_bulk/tex-${String(200 + i).padStart(5, '0')}.png`);
        const saved: Array<[string, Buffer]> = [];
        for (const rel of rels) {
            for (const f of [rel, `${rel}.meta`]) {
                saved.push([f, await readFile(path.join(root, f))]);
                await rm(path.join(root, f));
            }
        }
        try {
            await budgeted({
                name: 'assetdb: incremental scan, 22 files deleted',
                group: GROUP,
                unit: 'io',
                budget: 2.6,
                why: 'Deleting a folder\'s worth. A removal cannot make a dangling reference resolve, '
                    + 'so only the documents that referenced something removed need re-reading — '
                    + 'recomputing the whole dependency graph here is the regression this pins.',
                runs: 3,
            }, async () => {
                const res = await updateAssetIndex(root, index, saved.map(([f]) => f), { write: false });
                expect(res.fullRescan).toBe(false);
                expect(res.index.entries.length).toBe(50_000 - rels.length);
                return res;
            });
        } finally {
            for (const [f, body] of saved) await writeFile(path.join(root, f), body);
        }
    }, 600_000);
});
