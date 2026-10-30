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
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideRoot } from '../../fs/pathSandbox';
import { buildScriptIndex } from './scripts';
import { buildCocosAssetIndex, cocosEditorAssets, type CocosAssetEntry, type CocosAssetIndex } from './assets';
import type { AssetHints, SliceBorder } from './components';
import { convertPrefab, convertScene, type ConvertContext } from './convert';
import { parseCocosDocument, type CocosDocument } from './document';
import { ImportReport, type ImportReportData } from './report';
import { CocosModels, clipOf, clipPlayOf, mintSidecar, retargetClip } from './models';
import { convertAnimationClip } from './animationClip';
import { convertAnimationGraph } from './animationGraph';
import type { MaterialInfo } from './components';

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
    /** Told how far along the import is, so a long one can show it. */
    onProgress?: (p: CocosImportProgress) => void;
}

/** Where an import is: the step it is in and how many of that step's items are done. */
export interface CocosImportProgress {
    stage: 'index' | 'prefabs' | 'scenes' | 'textures' | 'finish';
    done: number;
    total: number;
    /** The document or asset being worked on, when there is one. */
    item?: string;
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
        placeFile(page, to);
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

/**
 * A source file, in the project. Left alone when it is already there as it was, otherwise a hard link to it (instant, and a multi-gigabyte art
 * folder is not stored twice), and where the two folders are on different drives a copy that keeps the source's modification time, so the next
 * import can tell it is unchanged. Nothing here ever writes into the file: the project reads it, and writes its settings beside it.
 */
function placeFile(from: string, to: string): void {
    const source = statSync(from);
    const there = (() => { try { return statSync(to); } catch { return null; } })();
    if (there && there.ino !== 0 && there.ino === source.ino && there.dev === source.dev) return;
    // linked beside the destination and moved over it, so a file system that cannot link leaves what was there untouched
    const staged = `${to}.linking`;
    try {
        rmSync(staged, { force: true });
        linkSync(from, staged);
        renameSync(staged, to);
        return;
    } catch {
        rmSync(staged, { force: true });   // another drive, or a file system without links
    }
    if (there && there.size === source.size && Math.abs(there.mtimeMs - source.mtimeMs) < 2) return;
    copyFileSync(from, to);
    utimesSync(to, source.atime, source.mtime);
}

/**
 * The scripts whose class was given another name than it wrote (two scripts wrote the same `@ccclass` name) — all of them, not only the ones a scene
 * uses, since a script is loaded by whatever imports it — by the path the entry requires them
 * at. The bundler reads this beside the entry and writes the new name into the decorator, so the component a scene names is the class it means.
 */
function writeClassNames(out: string, entry: string, assetsDir: string, scripts: Map<string, { name: string; rel: string; wrote?: string }>): void {
    const names: Record<string, { from: string; to: string }> = {};
    for (const cls of scripts.values()) {
        if (!cls.wrote) continue;
        const target = path.join(assetsDir, cls.rel.replace(/\.(ts|js)$/, ''));
        names[path.relative(path.dirname(entry), target).split(path.sep).join('/')] = { from: cls.wrote, to: cls.name };
    }
    const file = path.join(out, 'src', 'cocos-class-names.json');
    if (Object.keys(names).length > 0) writeOut(file, JSON.stringify(names, null, 2) + '\n');
    else rmSync(file, { force: true });
}

/** The scene a Cocos game starts in: its launch scene when there is one, else a scene named main at the top. */
function startSceneOf(scenes: readonly string[]): string | undefined {
    const find = (re: RegExp): string | undefined => scenes.find((r) => re.test(r));
    return find(/(^|\/)launch\/main\.scene$/) ?? find(/(^|\/)launch\/[^/]+\.scene$/) ?? find(/^main\.scene$/);
}

/**
 * Make the converted project start where the Cocos game does: the starter project opens its own empty scene and an 800x600 design size, so
 * playing it shows nothing of the game. Only a manifest still carrying the starter's values is changed; one the creator edited is theirs.
 */
function wireManifest(out: string, source: string, into: string, scenes: readonly string[]): void {
    const file = path.join(out, 'project.esproject');
    let manifest: { defaultScene?: string; designResolution?: { width?: number; height?: number } };
    try {
        manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return;
    }
    let changed = false;
    const start = startSceneOf(scenes);
    if (start && manifest.defaultScene === 'assets/scenes/main.esscene') {
        manifest.defaultScene = `assets/${into}/${start.replace(/\.scene$/, '.esscene')}`;
        changed = true;
    }
    try {
        const settings = JSON.parse(readFileSync(path.join(source, 'settings', 'v2', 'packages', 'project.json'), 'utf8')) as { general?: { designResolution?: { width?: number; height?: number } } };
        const size = settings.general?.designResolution;
        const dr = manifest.designResolution;
        if (size?.width && size.height && (!dr || (dr.width === 800 && dr.height === 600))) {
            manifest.designResolution = { width: size.width, height: size.height };
            changed = true;
        }
    } catch { /* a project with no settings keeps the starter's size */ }
    if (changed) writeOut(file, JSON.stringify(manifest, null, 2) + '\n');
}

/** A top-level assignment to a global: `globalThis.x = …`, `window.x = …` or `window['x'] = …`. */
const GLOBAL_DEFINITION = /^(?:globalThis|window)(?:\.\w+|\[['"]\w+['"]\])\s*=/m;

/** The scripts that define globals at their top level, in path order. */
function globalDefiningScripts(assets: CocosAssetIndex): string[] {
    const found: string[] = [];
    for (const entry of assets.byUuid.values()) {
        if (!/\.(ts|js)$/.test(entry.rel) || entry.rel.endsWith('.d.ts')) continue;
        if (entry.importer !== 'typescript' && entry.importer !== 'javascript') continue;
        try {
            if (GLOBAL_DEFINITION.test(readFileSync(entry.file, 'utf8'))) found.push(entry.rel);
        } catch { /* unreadable: not one */ }
    }
    return found.sort();
}

const GENERATED = 'Generated by import-cocos';

/** A default for a field, of the kind its sample is: what the editor shows before anything is typed. */
function defaultLike(sample: unknown): unknown {
    if (typeof sample === 'number') return 0;
    if (typeof sample === 'string') return '';
    if (typeof sample === 'boolean') return false;
    if (Array.isArray(sample)) return [];
    return null;
}

/**
 * Make the converted project run and open in the editor as converted. `src/components.ts` is the entry the editor reads component schemas
 * from without running the project: it gets the compatibility layer's own components, and one declaration for each script class the
 * scenes use, with the fields they carry. `src/main.ts` starts the project, so it loads the scripts themselves (which declare the real
 * classes) and not those declarations. Both files are rewritten only while they are still what the starter project or this import wrote:
 * once the creator has edited one, it is theirs.
 */
function wireProjectEntries(out: string, scriptFields: Map<string, Map<string, unknown>>): void {
    const read = (file: string): string | null => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
    const components = path.join(out, 'src', 'components.ts');
    const current = read(components);
    if (current === null || current.includes(GENERATED) || /^(\s*\/\/[^\n]*\n)*\s*export \{\};?\s*$/.test(current)) {
        const lines = [
            `// ${GENERATED}. The editor reads component schemas from this file without running the project.`,
            "// The Cocos compatibility layer's own components, and the script classes the converted scenes use, with the fields they carry.",
            "// Running the project loads the scripts themselves (src/cocos-scripts.ts); these declarations are for the editor only.",
            "import { defineComponent } from 'esengine';",
            "import 'esengine/cocos';", '',
        ];
        for (const [name, fields] of [...scriptFields].sort((a, b) => a[0].localeCompare(b[0]))) {
            const body = ['enabled: true', ...[...fields].filter(([k]) => k !== 'enabled').sort((a, b) => a[0].localeCompare(b[0]))
                .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(defaultLike(v))}`)];
            lines.push(`defineComponent(${JSON.stringify(name)}, { ${body.join(', ')} });`);
        }
        writeOut(components, `${lines.join('\n')}\n`);
    }
    const main = path.join(out, 'src', 'main.ts');
    const text = read(main);
    if (text !== null && !text.includes('cocos-scripts') && /^import '\.\/components';\s*$/m.test(text)) {
        writeOut(main, text.replace(/^import '\.\/components';\s*$/m, "// The converted Cocos scripts (the editor reads src/components.ts instead).\nimport './cocos-scripts';"));
    }
}

export async function importCocosProject(opts: CocosImportOptions): Promise<ImportReportData> {
    const source = path.resolve(opts.source);
    const out = path.resolve(opts.out);
    if (out === source || isInsideRoot(source, out)) {
        throw new Error('the output project must not be inside the Cocos project: the source is never written to');
    }
    const assetsDir = path.join(source, 'assets');
    if (!existsSync(assetsDir)) throw new Error(`no assets folder in ${source}: is this a Cocos Creator project?`);
    const into = opts.into ?? 'cocos';

    const report = new ImportReport();
    const progress = (stage: CocosImportProgress['stage'], done: number, total: number, item?: string): void => opts.onProgress?.({ stage, done, total, ...(item ? { item } : {}) });
    progress('index', 0, 1);
    const version = (() => { try { return (JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')) as { creator?: { version?: string } }).creator?.version; } catch { return undefined; } })();
    const index = buildCocosAssetIndex(assetsDir, cocosEditorAssets(version));

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

    const models = new CocosModels(index, out, into, opts.dryRun === true);
    const clips = new Map<string, string | null>();
    const spines = new Map<string, { skeleton: string; atlas: string } | null>();
    const scripts = buildScriptIndex(index);
    /** The scripts a converted document refers to, which the project has to bundle for those components to exist. */
    const usedScripts = new Set<string>();
    /** The component each script class became, and the fields its instances carry: what the editor needs to show them without running the script. */
    const scriptFields = new Map<string, Map<string, unknown>>();
    const collectScriptFields = (doc: unknown): void => {
        const walk = (v: unknown): void => {
            if (Array.isArray(v)) { v.forEach(walk); return; }
            if (typeof v !== 'object' || v === null) return;
            const o = v as Record<string, unknown>;
            if (typeof o.type === 'string' && o.type.startsWith('Cocos.') && typeof o.data === 'object' && o.data !== null && scriptNames.has(o.type)) {
                const fields = scriptFields.get(o.type) ?? new Map<string, unknown>();
                for (const [k, x] of Object.entries(o.data as Record<string, unknown>)) if (!fields.has(k) || fields.get(k) == null) fields.set(k, x);
                scriptFields.set(o.type, fields);
            }
            Object.values(o).forEach(walk);
        };
        walk(doc);
    };
    const scriptNames = new Set<string>();
    const ctx: ConvertContext = {
        assets: index,
        scriptClass: (classId) => {
            const found = scripts.get(classId);
            if (found) { usedScripts.add(found.rel); scriptNames.add(`Cocos.${found.name}`); }
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
        material(materialUuid) {
            return materialInfo(materialUuid);
        },
        modelInstance(uuid) {
            const m = models.use(uuid);
            return m && m.use.prefab ? { prefab: m.use.prefab, rootId: m.use.rootId, name: path.basename(m.entry.rel).replace(/\.[^.]+$/, ''), paths: m.use.paths } : null;
        },
        modelSkin(meshUuid) {
            const m = models.use(meshUuid);
            if (!m) return null;
            const name = models.meshName(m.entry, meshUuid);
            const own = name ? m.use.skin.get(name) : undefined;
            if (own) return own;
            return m.use.skin.size === 1 ? [...m.use.skin.values()][0]! : null;
        },
        spineAssets(uuid) {
            const entry = index.byUuid.get(uuid);
            if (!entry || !/\.(skel|json)$/i.test(entry.rel)) return null;
            const key = entry.file;
            if (spines.has(key)) return spines.get(key) ?? null;
            let found: { skeleton: string; atlas: string } | null = null;
            try {
                const dir = path.dirname(entry.file);
                const stem = path.basename(entry.file).replace(/\.[^.]+$/, '');
                const atlasFile = readdirSync(dir).find((f) => f.toLowerCase() === `${stem.toLowerCase()}.atlas`) ?? readdirSync(dir).find((f) => f.toLowerCase().endsWith('.atlas'));
                if (atlasFile) {
                    const toRef = (name: string): string => outRef(norm(path.relative(assetsDir, path.join(dir, name))));
                    // the images the atlas names (a page is a line that ends in an image extension) travel with it
                    const pages = readFileSync(path.join(dir, atlasFile), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /\.(png|jpg|jpeg|webp)$/i.test(l));
                    if (!opts.dryRun) {
                        for (const name of [path.basename(entry.file), atlasFile, ...pages]) {
                            const from = path.join(dir, name);
                            if (!existsSync(from)) continue;
                            const to = path.join(out, toRef(name));
                            mkdirSync(path.dirname(to), { recursive: true });
                            placeFile(from, to);
                            mintSidecar(to);
                        }
                    }
                    found = { skeleton: toRef(path.basename(entry.file)), atlas: toRef(atlasFile) };
                }
            } catch {
                found = null;
            }
            spines.set(key, found);
            return found;
        },
        animationClip(clipUuid, where) {
            const entry = index.byUuid.get(clipUuid.split('@')[0]!);
            if (!entry || !entry.rel.endsWith('.anim')) return null;
            const rel = outRef(esRel(entry.rel, '.estimeline'));
            if (clips.has(entry.file)) return clips.get(entry.file) ?? null;
            let ref: string | null = null;
            try {
                const converted = convertAnimationClip(JSON.parse(readFileSync(entry.file, 'utf8')));
                for (const [what, count] of converted.skipped) report.note('animation-track-unsupported', `${entry.rel}: ${what} ×${count}`);
                if (converted.events > 0) report.note('animation-events-dropped', `${entry.rel}: ${converted.events}`);
                write(rel, converted.document);
                if (!opts.dryRun) mintSidecar(path.join(out, rel));
                ref = rel;
            } catch (err) {
                report.note('animation-clip-unreadable', `${where}: ${entry.rel}: ${(err as Error).message}`);
            }
            clips.set(entry.file, ref);
            return ref;
        },
        animatorController(graphUuid, paths, where) {
            const entry = index.byUuid.get(graphUuid.split('@')[0]!);
            if (!entry || !entry.rel.endsWith('.animgraph')) return null;
            let ref: string | null = null;
            let complete = true;
            try {
                let onModel = false;
                const converted = convertAnimationGraph(JSON.parse(readFileSync(entry.file, 'utf8')), {
                    clip: (uuid) => {
                        const own = ctx.animationClip?.(uuid, where);
                        if (own) return own;
                        onModel = true;
                        return ctx.clipOn?.(uuid, paths, where) ?? null;
                    },
                    note: (code) => {
                        report.note(code, `${where}: ${entry.rel}`);
                        if (code !== 'graph-transition-to-exit') complete = false;
                    },
                });
                // a graph that plays a model's clips is written for the skeleton it is put on
                const key = createHash('sha1').update(JSON.stringify([...paths].sort())).digest('hex').slice(0, 8);
                const rel = outRef(esRel(entry.rel, onModel ? `__${key}.esanimator` : '.esanimator'));
                write(rel, converted.document);
                if (!opts.dryRun) mintSidecar(path.join(out, rel));
                ref = rel;
            } catch (err) {
                report.note('animation-graph-unreadable', `${where}: ${entry.rel}: ${(err as Error).message}`);
            }
            return ref ? { ref, complete } : null;
        },
        clipOn(clipUuid, paths, where) {
            const clip = models.use(clipUuid);
            if (!clip) return null;
            const sub = clip.entry.subs.get(clipUuid);
            const ref = clipOf(clip.use, sub?.name);
            if (!ref) return null;
            if (opts.dryRun) return ref;
            const key = createHash('sha1').update(JSON.stringify([...paths].sort())).digest('hex').slice(0, 8);
            // a node with no bones of its own (a prefab that only holds a clip) gets the clip as it was written
            const copy = retargetClip(out, ref, paths, key, clipPlayOf(sub?.userData)) ?? (paths.size === 0 ? retargetClip(out, ref, null, 'free', clipPlayOf(sub?.userData)) : null);
            if (!copy) {
                report.note('animation-no-matching-bones', where);
                return null;
            }
            if (copy.dropped > 0) report.note('animation-tracks-dropped', `${where}: ${copy.dropped}`);
            return copy.ref;
        },
        modelMesh(uuid) {
            const m = models.use(uuid);
            if (!m) return null;
            const name = models.meshName(m.entry, uuid);
            const hit = name ? m.use.byEntity.get(name) : undefined;
            const renderers = (hit ?? []).filter((c) => c.type === 'MeshRenderer');
            if (renderers.length > 0) return { components: renderers.map((c) => structuredClone(c.data) as Record<string, unknown>), exact: true };
            // a mesh's name can be in any language and any state of repair, but its place in the file is a number: the engine names the parts of a
            // model with several meshes `<stem>_<mesh>_<primitive>`
            const gltfIndex = m.entry.subs.get(uuid)?.userData.gltfIndex;
            if (typeof gltfIndex === 'number') {
                const wanted = new RegExp(`_${gltfIndex}_\\d+\\.esmesh$`);
                const byIndex = [...m.use.byEntity.values()].flat().filter((c) => c.type === 'MeshRenderer' && typeof (c.data as { mesh?: unknown }).mesh === 'string' && wanted.test((c.data as { mesh: string }).mesh));
                if (byIndex.length > 0) return { components: byIndex.map((c) => structuredClone(c.data) as Record<string, unknown>), exact: true };
            }
            // a model with one drawn part has no other mesh a node could mean
            const all = [...m.use.byEntity.values()].flat().filter((c) => c.type === 'MeshRenderer');
            return all.length === 1 ? { components: [structuredClone(all[0]!.data) as Record<string, unknown>], exact: true } : null;
        },
        loadPrefab(uuid) {
            const e = prefabEntry(uuid);
            return e ? loadDoc(e) : null;
        },
        prefabRef(uuid) {
            const model = models.use(uuid);
            if (model?.use.prefab) return model.use.prefab;
            const e = prefabEntry(uuid);
            if (!e) return null;
            if (!queued.has(e.rel)) {
                queued.add(e.rel);
                pending.push(e.rel);
            }
            return outRef(esRel(e.rel, '.esprefab'));
        },
    };

    // What a material draws and how: its main texture (a sub-asset of an image), its tint, and the state it sets.
    const BUILTIN_EFFECTS = new Set(['a3cd009f-0ab0-420d-9278-b9fdab939bbc', '1baf0fc9-befa-459c-8bdd-af1a450a0319']); // builtin-standard, builtin-unlit
    const BUILTIN_UNLIT = '1baf0fc9-befa-459c-8bdd-af1a450a0319';
    const materials = new Map<string, MaterialInfo | null>();
    const colorOf = (v: unknown): { r: number; g: number; b: number; a: number } | undefined => {
        if (typeof v !== 'object' || v === null) return undefined;
        const o = v as Record<string, unknown>;
        const n = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
        // a Color is 0..255 by r g b a; a Vec4 is 0..1 by x y z w
        if ('r' in o) return { r: n(o.r, 255) / 255, g: n(o.g, 255) / 255, b: n(o.b, 255) / 255, a: n(o.a, 255) / 255 };
        if ('x' in o) return { r: n(o.x, 1), g: n(o.y, 1), b: n(o.z, 1), a: n(o.w, 1) };
        return undefined;
    };
    // What a project's own effect is, read from its source: whether its main pass lights the surface (it names the unlit or the standard fragment
    // stage), which is how the project's effects are built even when they add outlines, a toon light or a dissolve behind switches.
    const effectKinds = new Map<string, { unlit: boolean; known: boolean }>();
    const effectKind = (effect: CocosAssetEntry | undefined): { unlit: boolean; known: boolean } => {
        if (!effect) return { unlit: false, known: false };
        const hit = effectKinds.get(effect.file);
        if (hit) return hit;
        let kind = { unlit: /unlit/i.test(effect.rel), known: false };
        try {
            const text = readFileSync(effect.file, 'utf8');
            const frags = [...text.matchAll(/frag:\s*([A-Za-z0-9_-]+)-fs/g)].map((m) => m[1]!.toLowerCase());
            const main = frags.filter((f) => f !== 'outline');
            if (main.length > 0) kind = { unlit: main.every((f) => f.includes('unlit')), known: main.every((f) => f.includes('unlit') || f.includes('standard')) };
        } catch {
            // an effect that cannot be read is judged by its name
        }
        effectKinds.set(effect.file, kind);
        return kind;
    };
    const materialInfo = (materialUuid: string): MaterialInfo | null => {
        if (materials.has(materialUuid)) return materials.get(materialUuid) ?? null;
        let info: MaterialInfo | null = null;
        try {
            const mat = index.byUuid.get(materialUuid);
            if (mat) {
                const json = JSON.parse(readFileSync(mat.file, 'utf8')) as {
                    _effectAsset?: { __uuid__?: string };
                    _defines?: Array<Record<string, unknown>>;
                    _props?: Array<Record<string, unknown>>;
                    _states?: Array<{ blendState?: { targets?: Array<{ blend?: boolean; blendSrc?: number; blendDst?: number }> }; rasterizerState?: { cullMode?: number } }>;
                };
                const props = Object.assign({}, ...(json._props ?? [])) as Record<string, unknown>;
                const uuidIn = (v: unknown): string | undefined => (typeof v === 'object' && v !== null ? ((v as { __uuid__?: string }).__uuid__ ?? undefined) : undefined);
                const entryOf = (v: unknown): CocosAssetEntry | null => {
                    const u = uuidIn(v);
                    return u ? index.byUuid.get(u.split('@')[0]!) ?? null : null;
                };
                const target = json._states?.[0]?.blendState?.targets?.[0];
                const effectUuid = json._effectAsset?.__uuid__ ?? '';
                const effectEntry = index.byUuid.get(effectUuid);
                const effectName = (effectEntry ? path.basename(effectEntry.rel) : '').toLowerCase();
                const color = colorOf(props.mainColor) ?? colorOf(props.albedo);
                const kind = effectKind(effectEntry);
                // the optional features a material switches on (a toon light, an outline, a dissolve) are what a plain texture and tint do not say
                const switched = [...new Set((json._defines ?? []).flatMap((pass) => Object.entries(pass).filter(([, on]) => on === true).map(([name]) => name)))]
                    .filter((name) => !['USE_ALBEDO_MAP', 'USE_TEXTURE', 'USE_VERTEX_COLOR', 'USE_ALPHA_TEST', 'USE_INSTANCING', 'USE_BATCHING', 'CC_SUPPORT_CASCADED_SHADOW_MAP'].includes(name));
                info = {
                    texture: entryOf(props.mainTexture) ?? entryOf(props.albedoMap),
                    ...(color ? { color } : {}),
                    normal: entryOf(props.normalMap),
                    additive: target?.blend === true && target.blendDst === 1,
                    transparent: target?.blend === true,
                    unlit: effectUuid === BUILTIN_UNLIT || effectName.includes('unlit') || kind.unlit,
                    cullBack: (json._states?.[0]?.rasterizerState?.cullMode ?? 2) === 2,
                    builtinEffect: BUILTIN_EFFECTS.has(effectUuid) || (kind.known && switched.length === 0),
                };
            }
        } catch {
            info = null;
        }
        materials.set(materialUuid, info);
        return info;
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

    // A converted document is the project's own once it is written: the creator edits it here. A re-import brings the Cocos side's
    // changes into the documents nobody touched, and leaves an edited one alone — the state file holds what was written last.
    const stateFile = path.join(out, 'assets', into, '.import-state.json');
    const written: Record<string, string> = (() => {
        try {
            return (JSON.parse(readFileSync(stateFile, 'utf8')) as { documents?: Record<string, string> }).documents ?? {};
        } catch {
            return {};
        }
    })();
    const digest = (text: string): string => createHash('sha1').update(text).digest('hex');
    const write = (relPath: string, json: unknown): void => {
        const text = `${JSON.stringify(json, null, 2)}\n`;
        const file = path.join(out, relPath);
        const next = digest(text);
        const now = existsSync(file) ? digest(readFileSync(file, 'utf8')) : null;
        if (now === null) report.sync.added++;
        else if (now === next) report.sync.unchanged++;
        else if (written[relPath] === now) report.sync.updated++;
        else {
            report.sync.kept.push(relPath);
            return;
        }
        written[relPath] = next;
        if (!opts.dryRun && now !== next) writeOut(file, text);
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
        progress('prefabs', i, pending.length, r);
        await models.ensureFor(e.file);
        try {
            const converted = convertPrefab(doc, ctx);
            collectScriptFields(converted);
            write(outRef(esRel(r, '.esprefab')), converted);
        } catch (err) {
            report.documents.failed.push({ file: r, error: (err as Error).message });
        }
    }
    for (const [si, r] of scenes.entries()) {
        const e = byRel.get(r);
        const doc = e ? loadDoc(e) : null;
        if (!e || !doc) continue;
        ctx.where = r;
        progress('scenes', si, scenes.length, r);
        await models.ensureFor(e.file);
        try {
            const converted = convertScene(doc, ctx);
            collectScriptFields(converted);
            write(outRef(esRel(r, '.esscene')), converted);
        } catch (err) {
            report.documents.failed.push({ file: r, error: (err as Error).message });
        }
    }

    for (const f of models.failures) report.documents.failed.push(f);
    for (const w of models.warnings) report.note('model-import-warning', `${w.file}: ${w.warning}`);

    if (usedScripts.size > 0) {
        // The scripts stay where they are, unchanged; this file is how the new project's bundle reaches them.
        const entry = path.join(out, 'src', 'cocos-scripts.ts');
        // Cocos runs every script of the project when the game starts, and a game leans on that: a script that only defines globals (the game's
        // configuration, its helpers on `window`) is named by no scene, and what loads next reads them. Those run first.
        const starters = globalDefiningScripts(index).filter((rel) => !usedScripts.has(rel));
        const loads = [...starters, ...[...usedScripts].sort()].map((rel) => {
            const target = path.join(assetsDir, rel.replace(/\.(ts|js)$/, ''));
            // On another drive there is no relative path, only the absolute one, which a require takes just as well.
            const rel2 = path.relative(path.dirname(entry), target).split(path.sep).join('/');
            return "load(() => require('" + (path.isAbsolute(rel2) || /^[A-Za-z]:/.test(rel2) || rel2.startsWith('.') ? rel2 : "./" + rel2) + "'), '" + rel.replace(/'/g, "\\'") + "');";
        });
        // Each script is its own load: a project's scripts are evaluated together, and one whose module throws (a Cocos API this engine does not
        // have, a script that reaches for the page) must not take the others with it. Loaded in order, synchronously, so the components exist before the scene does.
        const text = [
            "// Generated by import-cocos. Brings the Cocos project's scripts into this project's bundle, read from where they are.",
            "// src/main.ts loads this file. Scripts resolve `cc` to the engine's compatibility layer.",
            "import 'esengine/cocos';",
            "declare const require: (id: string) => unknown;",
            "function load(script: () => unknown, name: string): void {",
            "    try {",
            "        script();",
            "    } catch (err) {",
            "        console.error('[cocos] the script ' + name + ' failed to load:', err);",
            "    }",
            "}",
            ...loads, '',
        ].join('\n');
        if (!opts.dryRun) writeOut(entry, text);
        if (!opts.dryRun) writeClassNames(out, entry, assetsDir, scripts);
        report.note('cocos-scripts-entry', `${path.relative(out, entry).split(path.sep).join('/')}: ${usedScripts.size} script(s)`);
        if (!opts.dryRun) wireProjectEntries(out, scriptFields);
    }
    if (!opts.dryRun) wireManifest(out, source, into, scenes);

    report.textures = textures.size;
    if (!opts.dryRun) {
        let copied = 0;
        for (const { entry, slice, hints } of textures.values()) {
            if (copied % 25 === 0) progress('textures', copied, textures.size, entry.rel);
            copied++;
            const dest = path.join(out, outRef(entry.rel));
            if (!existsSync(entry.file)) {
                report.missingAsset(entry.uuid);
                continue;
            }
            mkdirSync(path.dirname(dest), { recursive: true });
            if (entry.file.endsWith('.fnt') && hints?.bakedOutline) writeOut(dest, declareBakedOutline(readFileSync(entry.file, 'utf8')));
            else placeFile(entry.file, dest);
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
        progress('finish', 0, 1);
        writeOut(stateFile, `${JSON.stringify({ source, documents: written }, null, 2)}\n`);
        writeOut(path.join(out, 'assets', into, 'import-report.json'), `${JSON.stringify(report.toJSON(), null, 2)}\n`);
    }
    return report.toJSON();
}
