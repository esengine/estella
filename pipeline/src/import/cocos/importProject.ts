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
import { buildScriptIndex } from './scripts';
import { buildCocosAssetIndex, type CocosAssetEntry } from './assets';
import type { AssetHints, SliceBorder } from './components';
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

/**
 * A bitmap font is a .fnt that names its glyph pages; they sit beside it and must travel with it. Each page gets a
 * `.meta` that keeps it at full size: the default cap (2048) would halve a 4096 page, and glyphs drawn from half the
 * pixels they were drawn with are soft and fringed. Glyph UVs are fractions of the page, so only the sharpness suffers,
 * never the placement — which is why nothing else notices.
 */
function copyFontPages(fnt: string, dest: string, uuidFor: (pageFile: string) => string | undefined): void {
    const text = readFileSync(fnt, 'utf8');
    const common = /\bcommon\b[^\n]*/.exec(text)?.[0] ?? '';
    const side = Math.max(Number(/\bscaleW=(\d+)/.exec(common)?.[1]) || 0, Number(/\bscaleH=(\d+)/.exec(common)?.[1]) || 0);
    let maxSize = 256;
    while (maxSize < side && maxSize < 8192) maxSize *= 2;
    for (const m of text.matchAll(/file="([^"]+)"/g)) {
        const page = path.join(path.dirname(fnt), m[1]!);
        if (!existsSync(page)) continue;
        const to = path.join(path.dirname(dest), m[1]!);
        copyFileSync(page, to);
        const uuid = uuidFor(page);
        if (uuid) {
            const meta = {
                uuid, version: '2.0', type: 'texture',
                importer: { maxSize: Math.max(2048, maxSize), filterMode: 'linear', wrapMode: 'clamp', premultiplyAlpha: false },
            };
            writeOut(`${to}.meta`, `${JSON.stringify(meta, null, 2)}\n`);
        }
    }
}

/**
 * The `.fnt`, with its `common` line saying what the page holds, in the channel flags BMFont defines for it: glyph in red (`redChnl=0`), glyph and
 * outline in alpha (`alphaChnl=2`). That is how the engine knows to draw it in two passes, and it is what a real BMFont export of such a page says.
 */
function declareBakedOutline(fnt: string): string {
    return fnt.replace(/^(\s*common\b[^\r\n]*?)(\r?\n|$)/m, (line, head: string, eol: string) => (
        /\balphaChnl=/.test(head) ? line : `${head} alphaChnl=2 redChnl=0 greenChnl=0 blueChnl=0${eol}`
    ));
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

    const textures = new Map<string, { entry: CocosAssetEntry; slice?: SliceBorder; hints?: AssetHints }>();
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

    const scripts = buildScriptIndex(index);
    /** The scripts a converted document refers to, which the project has to bundle for those components to exist. */
    const usedScripts = new Set<string>();
    const ctx: ConvertContext = {
        assets: index,
        scriptClass: (classId) => {
            const found = scripts.get(classId);
            if (found) usedScripts.add(found.rel);
            return found;
        },
        prefabAssetRef: (uuid) => ctx.prefabRef(uuid),
        report,
        where: '',
        assetRef(entry, slice, hints) {
            const prev = textures.get(entry.file);
            const merged = slice ?? prev?.slice;
            // A font any label draws as two layers is declared so; the declaration is about the page, not the label.
            const bakedOutline = hints?.bakedOutline === true || prev?.hints?.bakedOutline === true;
            textures.set(entry.file, {
                entry,
                ...(merged ? { slice: merged } : {}),
                ...(bakedOutline ? { hints: { bakedOutline: true } } : {}),
            });
            return outRef(entry.rel);
        },
        drawsBakedOutline(materialUuid) {
            return materialBakesOutline(materialUuid);
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

    // A material says how its font page is read through the effect it uses; the outline effect mixes an outline colour in by the red channel.
    const bakes = new Map<string, boolean>();
    const materialBakesOutline = (materialUuid: string): boolean => {
        const known = bakes.get(materialUuid);
        if (known !== undefined) return known;
        let result = false;
        try {
            const mat = index.byUuid.get(materialUuid);
            const effectUuid = mat && JSON.parse(readFileSync(mat.file, 'utf8'))?._effectAsset?.__uuid__;
            const effect = typeof effectUuid === 'string' ? index.byUuid.get(effectUuid) : undefined;
            result = !!effect && /alphaLerp\s*=\s*o\.r/.test(readFileSync(effect.file, 'utf8'));
        } catch {
            result = false;
        }
        bakes.set(materialUuid, result);
        return result;
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

    // Assets scripts load by path at run time (`resources.load('ui/icon')`) are named by no scene, so nothing above would bring them
    // across. They are copied, and listed by bundle in a manifest the runtime layer resolves those paths through.
    const manifest: Record<string, Record<string, { path: string; kind: string }>> = {};
    if (index.bundles.length > 0) {
        const files = new Set(index.byUuid.values());
        for (const bundle of index.bundles) {
            const entries = (manifest[bundle.name] ??= {});
            for (const entry of files) {
                if (!entry.rel.startsWith(`${bundle.rel}/`) || !wanted(entry.rel)) continue;
                const key = entry.rel.slice(bundle.rel.length + 1).replace(/\.[^./]+$/, '');
                const ext = /\.([^./]+)$/.exec(entry.rel)?.[1]?.toLowerCase() ?? '';
                if (ext === 'prefab') {
                    const ref = ctx.prefabRef(entry.uuid);
                    if (ref) entries[key] = { path: ref, kind: 'prefab' };
                } else if (ext === 'json') {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'json' };
                } else if (['txt', 'text', 'xml', 'csv', 'atlas'].includes(ext)) {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'text' };
                } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'texture' };
                } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'audio' };
                } else if (ext !== 'meta' && ext !== 'ts' && ext !== 'js' && ext !== 'scene') {
                    entries[key] = { path: '', kind: ext || 'other' };
                }
            }
        }
        write(outRef('resources.json'), manifest);
    }

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

    if (usedScripts.size > 0) {
        // The scripts stay where they are, unchanged; this file is how the new project's bundle reaches them.
        const entry = path.join(out, 'src', 'cocos-scripts.ts');
        const imports = [...usedScripts].sort().map((rel) => {
            const target = path.join(assetsDir, rel.replace(/\.(ts|js)$/, ''));
            // On another drive there is no relative path, only the absolute one, which an import takes just as well.
            const rel2 = path.relative(path.dirname(entry), target).split(path.sep).join('/');
            return `import '${path.isAbsolute(rel2) || /^[A-Za-z]:/.test(rel2) || rel2.startsWith('.') ? rel2 : `./${rel2}`}';`;
        });
        const text = [
            "// Generated by import-cocos. Brings the Cocos project's scripts into this project's bundle, read from where they are.",
            "// Import this file from src/main.ts. Scripts resolve `cc` to the engine's compatibility layer.",
            "import 'esengine/cocos';",
            ...imports, '',
        ].join('\n');
        if (!opts.dryRun) writeOut(entry, text);
        report.note('cocos-scripts-entry', `${path.relative(out, entry).split(path.sep).join('/')}: ${usedScripts.size} script(s)`);
    }

    report.textures = textures.size;
    if (!opts.dryRun) {
        for (const { entry, slice, hints } of textures.values()) {
            const dest = path.join(out, outRef(entry.rel));
            if (!existsSync(entry.file)) {
                report.missingAsset(entry.uuid);
                continue;
            }
            mkdirSync(path.dirname(dest), { recursive: true });
            if (entry.file.endsWith('.fnt') && hints?.bakedOutline) writeOut(dest, declareBakedOutline(readFileSync(entry.file, 'utf8')));
            else copyFileSync(entry.file, dest);
            if (entry.file.endsWith('.fnt')) {
                copyFontPages(entry.file, dest, (page) => byRel.get(norm(path.relative(assetsDir, page)))?.uuid);
                // The asset database ships a font's page image only for a `bitmapfont`, since nothing else names it.
                writeOut(`${dest}.meta`, `${JSON.stringify({ uuid: entry.uuid, version: '2.0', type: 'bitmapfont', importer: {} }, null, 2)}
`);
            }
            if (slice) {
                // A slice border is a texture import setting here; the Cocos image keeps its uuid.
                writeOut(`${dest}.meta`, `${JSON.stringify({ uuid: entry.uuid, version: '2.0', type: 'texture', importer: { sliceBorder: slice } }, null, 2)}\n`);
            }
        }
        writeOut(path.join(out, 'assets', into, 'import-report.json'), `${JSON.stringify(report.toJSON(), null, 2)}\n`);
    }
    return report.toJSON();
}
