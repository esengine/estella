// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a Cocos project's `.meta` files say about its assets.
 *
 *        A scene names its assets by uuid; the `.meta` beside each file is the
 *        only place that says which file a uuid is, and a sprite frame is a
 *        sub-asset (`<image uuid>@f9941`) of its image. This reads every meta
 *        once into a lookup. Read-only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface CocosAssetEntry {
    uuid: string;
    /** Absolute path of the asset file. */
    file: string;
    /** Path relative to the project's `assets` folder, forward slashes. */
    rel: string;
    importer: string;
    userData: Record<string, unknown>;
    /** Sub-assets by their full uuid (`<uuid>@<id>`). */
    subs: Map<string, { importer: string; userData: Record<string, unknown> }>;
}

export interface CocosAssetIndex {
    /** The project's `assets` folder. */
    root: string;
    /** Every asset and every sub-asset, by uuid. A sub-asset resolves to its parent file. */
    byUuid: Map<string, CocosAssetEntry>;
}

const SKIP = new Set(['node_modules', '.git']);

function* walk(dir: string): Generator<string> {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (e.isDirectory()) {
            if (!SKIP.has(e.name)) yield* walk(path.join(dir, e.name));
        } else if (e.name.endsWith('.meta')) {
            yield path.join(dir, e.name);
        }
    }
}

const asObj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function buildCocosAssetIndex(root: string): CocosAssetIndex {
    const byUuid = new Map<string, CocosAssetEntry>();
    for (const metaFile of walk(root)) {
        let meta: Record<string, unknown>;
        try {
            meta = asObj(JSON.parse(readFileSync(metaFile, 'utf8')));
        } catch {
            continue;
        }
        const uuid = meta.uuid;
        if (typeof uuid !== 'string' || meta.importer === 'directory') continue;
        const file = metaFile.slice(0, -'.meta'.length);
        const entry: CocosAssetEntry = {
            uuid,
            file,
            rel: path.relative(root, file).split(path.sep).join('/'),
            importer: typeof meta.importer === 'string' ? meta.importer : '',
            userData: asObj(meta.userData),
            subs: new Map(),
        };
        for (const sub of Object.values(asObj(meta.subMetas))) {
            const s = asObj(sub);
            if (typeof s.uuid !== 'string') continue;
            entry.subs.set(s.uuid, { importer: typeof s.importer === 'string' ? s.importer : '', userData: asObj(s.userData) });
            byUuid.set(s.uuid, entry);
        }
        byUuid.set(uuid, entry);
    }
    return { root, byUuid };
}
