// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetPacks.ts — a network build's small assets, packed into a few files.
 *
 * A browser holds six connections to an origin, so a scene of a few thousand
 * assets loads at the pace of its requests: Bistro spent 43 s of load time
 * fetching 1505 meshes whose upload took 0.2 s. After the cook, this moves the
 * local assets that every read reaches through the asset server into packs, and
 * records in the cook manifest where each one sits (the runtime reads them back
 * through `packedBackend`).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleModeFor } from './addressableManifest';

/** The types read only through the asset server's backend, which is what reads a pack.
 *  Not prefabs: cutting a streamed world reads them off disk after the cook. */
const PACKABLE_TYPES = new Set([
    'mesh', 'material', 'timeline', 'anim-clip', 'animatorcontroller', 'avatar',
]);

export interface PackOptions {
    /** An asset bigger than this keeps its own file: packing it saves one request among thousands. */
    maxAssetBytes?: number;
    /** A pack is fetched whole, so none grows past this. */
    maxPackBytes?: number;
}

export interface PackReport { packs: number; assets: number; bytes: number }

interface CookEntry {
    path: string; type: string; group?: string; groupMode?: string; size?: number;
    atlas?: unknown;
    pack?: { file: string; offset: number; size: number };
}

function packable(e: CookEntry): boolean {
    if (bundleModeFor(e.group ?? 'main', e.groupMode) !== 'local') return false;
    if (e.atlas) return false;
    if (e.type === 'texture') return e.path.toLowerCase().endsWith('.ktx2');
    return PACKABLE_TYPES.has(e.type);
}

/** Pack a cook output dir's local assets; rewrites `assets.manifest.json` in place. */
export async function packAssets(absOut: string, opts: PackOptions = {}): Promise<PackReport> {
    const maxAsset = opts.maxAssetBytes ?? 4 * 1024 * 1024;
    const maxPack = opts.maxPackBytes ?? 16 * 1024 * 1024;
    const manifestPath = path.join(absOut, 'assets.manifest.json');
    const flat = JSON.parse(await readFile(manifestPath, 'utf8')) as { entries: CookEntry[] };

    // One file, one member: entries that share a path (content-deduplicated) share its slot.
    const byPath = new Map<string, CookEntry[]>();
    for (const e of flat.entries) {
        if (!packable(e) || !existsSync(path.join(absOut, e.path))) continue;
        const list = byPath.get(e.path) ?? [];
        list.push(e);
        byPath.set(e.path, list);
    }
    // A group's assets pack together, so a scene tends to read whole packs.
    const paths = [...byPath.keys()].sort((a, b) => {
        const ga = byPath.get(a)![0].group ?? 'main', gb = byPath.get(b)![0].group ?? 'main';
        return ga === gb ? a.localeCompare(b) : ga.localeCompare(gb);
    });

    const report: PackReport = { packs: 0, assets: 0, bytes: 0 };
    let parts: Uint8Array[] = [];
    let members: Array<{ path: string; offset: number; size: number }> = [];
    let length = 0;
    const flush = async (): Promise<void> => {
        if (members.length < 2) { parts = []; members = []; length = 0; return; }
        const bytes = Buffer.concat(parts);
        const file = `packs/${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.pack`;
        await mkdir(path.join(absOut, 'packs'), { recursive: true });
        await writeFile(path.join(absOut, file), bytes);
        for (const m of members) {
            for (const e of byPath.get(m.path)!) e.pack = { file, offset: m.offset, size: m.size };
            await rm(path.join(absOut, m.path), { force: true });
        }
        report.packs++;
        report.assets += members.length;
        report.bytes += bytes.byteLength;
        parts = []; members = []; length = 0;
    };
    for (const p of paths) {
        const data = await readFile(path.join(absOut, p));
        if (data.byteLength > maxAsset) continue;
        if (length + data.byteLength > maxPack) await flush();
        members.push({ path: p, offset: length, size: data.byteLength });
        parts.push(data);
        length += data.byteLength;
    }
    await flush();
    await writeFile(manifestPath, JSON.stringify(flat, null, 2));
    return report;
}
