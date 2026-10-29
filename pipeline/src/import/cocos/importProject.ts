// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Take a Cocos Creator 3.x project into an Estella project, without
 *        touching it.
 *
 *        The source is only ever read. Output goes under `<out>/assets/cocos/`,
 *        keeping the source's folder layout so a path in one is findable in the
 *        other. Only what the converted documents reference is copied.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildCocosAssetIndex, type CocosAssetEntry } from './assets';
import type { SliceBorder } from './components';
import { convertPrefab, convertScene, type ConvertContext } from './convert';
import { parseCocosDocument, type CocosDocument } from './document';
import { ImportReport, type ImportReportData } from './report';

export interface CocosImportOptions {
    /** The Cocos project folder (the one holding `assets/` and `settings/`). */
    source: string;
    /** The Estella project folder to write into. */
    out: string;
    /** Convert only documents whose path under `assets/` starts with one of these; prefabs they use follow. */
    only?: string[];
    /** Parse and convert but write nothing. */
    dryRun?: boolean;
    /** Folder under the project's `assets/` that receives everything. */
    into?: string;
}

const norm = (p: string): string => p.split(path.sep).join('/');

function* walk(dir: string): Generator<string> {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (e.isDirectory()) yield* walk(path.join(dir, e.name));
        else yield path.join(dir, e.name);
    }
}

function writeOut(file: string, text: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
}

/** A bitmap font is a .fnt that names its glyph pages; they sit beside it and must travel with it. */
function copyFontPages(fnt: string, dest: string): void {
    const text = readFileSync(fnt, 'utf8');
    for (const m of text.matchAll(/file="([^"]+)"/g)) {
        const page = path.join(path.dirname(fnt), m[1]!);
        if (existsSync(page)) copyFileSync(page, path.join(path.dirname(dest), m[1]!));
    }
}

export function importCocosProject(opts: CocosImportOptions): ImportReportData {
    const source = path.resolve(opts.source);
    const out = path.resolve(opts.out);
    const rel = path.relative(source, out);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        throw new Error('the output project must not be inside the Cocos project: the source is never written to');
    }
    const assetsDir = path.join(source, 'assets');
    if (!existsSync(assetsDir)) throw new Error(`no assets folder in ${source}: is this a Cocos Creator project?`);
    const into = opts.into ?? 'cocos';

    const report = new ImportReport();
    const index = buildCocosAssetIndex(assetsDir);

    const outRef = (assetRel: string): string => `assets/${into}/${assetRel}`;
    const esRel = (assetRel: string, ext: string): string => assetRel.replace(/\.[^./]+$/, ext);

    const textures = new Map<string, { entry: CocosAssetEntry; slice?: SliceBorder }>();
    const docs = new Map<string, CocosDocument | null>();
    const pending: string[] = [];
    const queued = new Set<string>();

    const prefabEntry = (uuid: string): CocosAssetEntry | null => {
        const e = index.byUuid.get(uuid);
        return e && e.rel.endsWith('.prefab') ? e : null;
    };
    const loadDoc = (e: CocosAssetEntry): CocosDocument | null => {
        if (docs.has(e.file)) return docs.get(e.file) ?? null;
        let doc: CocosDocument | null = null;
        try {
            doc = parseCocosDocument(JSON.parse(readFileSync(e.file, 'utf8')), path.basename(e.rel).replace(/\.[^.]+$/, ''));
        } catch (err) {
            report.documents.failed.push({ file: e.rel, error: (err as Error).message });
        }
        docs.set(e.file, doc);
        return doc;
    };

    const ctx: ConvertContext = {
        assets: index,
        report,
        where: '',
        assetRef(entry, slice) {
            const merged = slice ?? textures.get(entry.file)?.slice;
            textures.set(entry.file, merged ? { entry, slice: merged } : { entry });
            return outRef(entry.rel);
        },
        loadPrefab(uuid) {
            const e = prefabEntry(uuid);
            return e ? loadDoc(e) : null;
        },
        prefabRef(uuid) {
            const e = prefabEntry(uuid);
            if (!e) return null;
            if (!queued.has(e.rel)) {
                queued.add(e.rel);
                pending.push(e.rel);
            }
            return outRef(esRel(e.rel, '.esprefab'));
        },
    };

    const wanted = (relPath: string): boolean => !opts.only?.length || opts.only.some((p) => relPath.startsWith(p));
    const scenes: string[] = [];
    for (const f of walk(assetsDir)) {
        const r = norm(path.relative(assetsDir, f));
        if (!wanted(r)) continue;
        if (r.endsWith('.scene')) scenes.push(r);
        else if (r.endsWith('.prefab') && !queued.has(r)) {
            queued.add(r);
            pending.push(r);
        }
    }

    const write = (relPath: string, json: unknown): void => {
        if (!opts.dryRun) writeOut(path.join(out, relPath), `${JSON.stringify(json, null, 2)}\n`);
    };

    const byRel = new Map<string, CocosAssetEntry>();
    for (const e of index.byUuid.values()) byRel.set(e.rel, e);

    for (let i = 0; i < pending.length; i++) {
        const r = pending[i]!;
        const e = byRel.get(r);
        const doc = e ? loadDoc(e) : null;
        if (!e || !doc) continue;
        ctx.where = r;
        try {
            write(outRef(esRel(r, '.esprefab')), convertPrefab(doc, ctx));
        } catch (err) {
            report.documents.failed.push({ file: r, error: (err as Error).message });
        }
    }
    for (const r of scenes) {
        const e = byRel.get(r);
        const doc = e ? loadDoc(e) : null;
        if (!e || !doc) continue;
        ctx.where = r;
        try {
            write(outRef(esRel(r, '.esscene')), convertScene(doc, ctx));
        } catch (err) {
            report.documents.failed.push({ file: r, error: (err as Error).message });
        }
    }

    report.textures = textures.size;
    if (!opts.dryRun) {
        for (const { entry, slice } of textures.values()) {
            const dest = path.join(out, outRef(entry.rel));
            if (!existsSync(entry.file)) {
                report.missingAsset(entry.uuid);
                continue;
            }
            mkdirSync(path.dirname(dest), { recursive: true });
            copyFileSync(entry.file, dest);
            if (entry.file.endsWith('.fnt')) copyFontPages(entry.file, dest);
            if (slice) {
                // A slice border is a texture import setting here; the Cocos image keeps its uuid.
                writeOut(`${dest}.meta`, `${JSON.stringify({ uuid: entry.uuid, version: '2.0', type: 'texture', importer: { sliceBorder: slice } }, null, 2)}\n`);
            }
        }
        writeOut(path.join(out, 'assets', into, 'import-report.json'), `${JSON.stringify(report.toJSON(), null, 2)}\n`);
    }
    return report.toJSON();
}
