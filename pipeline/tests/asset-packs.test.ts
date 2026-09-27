// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A cook output's small local assets end up in packs the manifest can find.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packAssets } from '../src/assets/assetPacks';

const work = mkdtempSync(path.join(tmpdir(), 'asset-packs-'));
afterAll(() => rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

type Entry = { uuid: string; path: string; type: string; group?: string; groupMode?: string; size?: number; atlas?: unknown; pack?: { file: string; offset: number; size: number } };

function cookDir(files: Array<{ path: string; type: string; bytes: number; group?: string; groupMode?: string; atlas?: boolean; dup?: string }>): string {
    const dir = mkdtempSync(path.join(work, 'out-'));
    const entries: Entry[] = [];
    files.forEach((f, i) => {
        mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
        writeFileSync(path.join(dir, f.path), Buffer.alloc(f.bytes, i + 1));
        entries.push({ uuid: `u${i}`, path: f.path, type: f.type, group: f.group, groupMode: f.groupMode, size: f.bytes, ...(f.atlas ? { atlas: {} } : {}) });
        if (f.dup) entries.push({ uuid: f.dup, path: f.path, type: f.type, size: f.bytes });
    });
    writeFileSync(path.join(dir, 'assets.manifest.json'), JSON.stringify({ entries }));
    return dir;
}

const entriesOf = (dir: string) => (JSON.parse(readFileSync(path.join(dir, 'assets.manifest.json'), 'utf8')) as { entries: Entry[] }).entries;

describe('packing a cook output', () => {
    it('packs what the asset server reads, and every packed byte reads back where the manifest says', async () => {
        const dir = cookDir([
            { path: 'assets/a.esmesh', type: 'mesh', bytes: 100, dup: 'twin' },
            { path: 'assets/b.esmaterial', type: 'material', bytes: 50 },
            { path: 'assets/c.ktx2', type: 'texture', bytes: 300 },
            { path: 'assets/d.png', type: 'texture', bytes: 70 },
            { path: 'assets/e.ktx2', type: 'texture', bytes: 80, atlas: true },
            { path: 'assets/f.esmesh', type: 'mesh', bytes: 40, group: 'far', groupMode: 'remote' },
            { path: 'assets/g.mp3', type: 'audio', bytes: 60 },
            { path: 'assets/h.esmesh', type: 'mesh', bytes: 5000 },
        ]);
        const report = await packAssets(dir, { maxAssetBytes: 1000 });
        expect(report).toMatchObject({ packs: 1, assets: 3 });

        const entries = entriesOf(dir);
        const packed = entries.filter((e) => e.pack);
        expect(packed.map((e) => e.path).sort()).toEqual(['assets/a.esmesh', 'assets/a.esmesh', 'assets/b.esmaterial', 'assets/c.ktx2']);
        for (const e of packed) {
            expect(existsSync(path.join(dir, e.path))).toBe(false);
            const pack = readFileSync(path.join(dir, e.pack!.file));
            const fill = entries.filter((x) => x.uuid.startsWith('u')).findIndex((x) => x.path === e.path) + 1;
            expect([...pack.subarray(e.pack!.offset, e.pack!.offset + e.pack!.size)].every((b) => b === fill)).toBe(true);
        }
        for (const kept of ['assets/d.png', 'assets/e.ktx2', 'assets/f.esmesh', 'assets/g.mp3', 'assets/h.esmesh']) {
            expect(existsSync(path.join(dir, kept)), kept).toBe(true);
            expect(entries.find((e) => e.path === kept)?.pack, kept).toBeUndefined();
        }
    });

    it('splits packs at the size limit and leaves a lone asset its own file', async () => {
        const dir = cookDir([
            { path: 'assets/1.esmesh', type: 'mesh', bytes: 400 },
            { path: 'assets/2.esmesh', type: 'mesh', bytes: 400 },
            { path: 'assets/3.esmesh', type: 'mesh', bytes: 400 },
        ]);
        const report = await packAssets(dir, { maxPackBytes: 900 });
        expect(report).toMatchObject({ packs: 1, assets: 2 });
        expect(existsSync(path.join(dir, 'assets/3.esmesh'))).toBe(true);
    });
});
