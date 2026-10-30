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
import { pathToFileURL } from 'node:url';
import { isInsideRoot } from '../../fs/pathSandbox';
import { buildScriptIndex } from './scripts';
import { buildCocosAssetIndex, cocosEditorAssets, INTERNAL_FOLDER, type CocosAssetEntry, type CocosAssetIndex } from './assets';
import type { AssetHints, SliceBorder } from './components';
import { convertPrefab, convertScene, type ConvertContext } from './convert';
import { parseCocosDocument, type CocosDocument } from './document';
import { ImportReport, type ImportReportData } from './report';
import { CocosModels, clipOf, clipPlayOf, mintSidecar, retargetClip } from './models';
import { convertAnimationClip } from './animationClip';
import { convertAnimationGraph } from './animationGraph';
import type { MaterialInfo } from './components';
import { parseEffect, type CocosEffect, type EffectPass } from './effects';
import { convertPass, isOutlinePass, type PassConversion } from './effectConvert';

/**
 * The revision of what an import writes. It is recorded in the state file; a converted project whose record is older was written by an
 * importer that made less (or differently), and is brought up to date when it is opened. Raise it when the converted output changes in a
 * way an existing project needs to pick up: a new generated file, a field a document or a manifest now carries.
 */
export const COCOS_IMPORT_REVISION = 12;

/** Whether the project at @p projectRoot was written by an importer of this revision. A project that was not converted has nothing to bring up. */
export function cocosImportIsCurrent(projectRoot: string): boolean {
    try {
        const state = JSON.parse(readFileSync(path.join(projectRoot, 'assets', 'cocos', '.import-state.json'), 'utf8')) as { revision?: unknown };
        return state.revision === COCOS_IMPORT_REVISION;
    } catch {
        return true;
    }
}

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
    stage: 'index' | 'shaders' | 'prefabs' | 'scenes' | 'textures' | 'finish';
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
 * The engine's shader tools as a check on one converted shader: it compiles every combination of what the shader leaves to toggle, in GLSL (glslang)
 * and as the WGSL twin the WebGPU backend runs. Null where the tools are not here (anywhere but a checkout of the engine with a built wasm), and the
 * conversion then goes unchecked. The module is named by a path held in a variable so that the bundlers leave it and its wasm alone.
 */
let shaderChecking: Promise<((source: string) => Promise<string | null>) | null> | undefined;
function shaderChecker(): Promise<((source: string) => Promise<string | null>) | null> {
    shaderChecking ??= (async () => {
        try {
            // Beside the package when it runs from source, or from the bin that started a bundled run of it (the command line bundles the importer into a
            // temporary folder), or where ESTELLA_TOOLS says.
            const candidates = [
                '../../../../tools/gen-shader-twins.mjs',
                ...(process.argv[1] ? [pathToFileURL(path.resolve(path.dirname(process.argv[1]), '..', '..', 'tools', 'gen-shader-twins.mjs')).href] : []),
                ...(process.env.ESTELLA_TOOLS ? [pathToFileURL(path.join(process.env.ESTELLA_TOOLS, 'gen-shader-twins.mjs')).href] : []),
            ];
            let loaded: unknown = null;
            for (const specifier of candidates) {
                try { loaded = await import(/* @vite-ignore */ specifier); break; } catch { /* the next */ }
            }
            if (!loaded) return null;
            const tool = loaded as {
                loadTwinModule(): Promise<unknown>;
                deriveTwin(module: unknown, source: string, opts: object): Promise<{ status: string }>;
            };
            const module = await tool.loadTwinModule();
            return async (source: string) => {
                try {
                    const derived = await tool.deriveTwin(module, source, {});
                    // More toggles than a twin may carry is no error of the shader's: it runs on WebGL.
                    return derived.status === 'generated' || derived.status === 'has-twin' || derived.status.startsWith('skipped') ? null : derived.status;
                } catch (err) {
                    return String((err as Error).message ?? err).split('\n').filter((l) => /ERROR|error|failed/.test(l)).slice(0, 2).join(' ').trim().slice(0, 240) || 'it could not be translated';
                }
            };
        } catch {
            return null;
        }
    })();
    return shaderChecking;
}

/** The design resolution a Cocos project declares, which is the box its screen-pinned roots are placed in. */
function designSizeOf(source: string): { width: number; height: number } | undefined {
    try {
        const settings = JSON.parse(readFileSync(path.join(source, 'settings', 'v2', 'packages', 'project.json'), 'utf8')) as { general?: { designResolution?: { width?: number; height?: number } } };
        const size = settings.general?.designResolution;
        return size?.width && size.height ? { width: size.width, height: size.height } : undefined;
    } catch { return undefined; }
}

/**
 * Make the converted project start where the Cocos game does: the starter project opens its own empty scene and an 800x600 design size, so
 * playing it shows nothing of the game. Only a manifest still carrying the starter's values is changed; one the creator edited is theirs.
 */
function wireManifest(out: string, source: string, into: string, scenes: readonly string[]): void {
    const file = path.join(out, 'project.esproject');
    let manifest: { defaultScene?: string; designResolution?: { width?: number; height?: number }; features?: { rendering?: { cameraScaleMode?: string } } };
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
        const settings = JSON.parse(readFileSync(path.join(source, 'settings', 'v2', 'packages', 'project.json'), 'utf8')) as { general?: { designResolution?: { width?: number; height?: number; fitWidth?: boolean; fitHeight?: boolean } } };
        const size = settings.general?.designResolution;
        // Fit width (and not height) keeps the design width across the screen and lets the height follow the window: Cocos's FIXED_WIDTH, which is what
        // a UI laid out in design units needs to come out the same size on every screen.
        const fit = size?.fitWidth && !size.fitHeight ? 'fixed-width' : size?.fitHeight && !size.fitWidth ? 'fixed-height' : undefined;
        if (fit && !manifest.features?.rendering?.cameraScaleMode) {
            manifest.features = { ...manifest.features, rendering: { ...manifest.features?.rendering, cameraScaleMode: fit } };
            changed = true;
        }
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

/**
 * A document the creator edited is left as it is, but it was written when a Cocos widget was a component of the compatibility layer
 * (`Cocos.Widget`), and is now the engine's `RectAnchors`: the same fields, under the engine's name. Only that name changes, in place;
 * everything the creator did to the document stays. Answers whether the document held one.
 */
function migrateWidgets(file: string): boolean {
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { return false; }
    if (!text.includes('"Cocos.Widget"')) return false;
    let changed = false;
    const walk = (v: unknown): void => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (typeof v !== 'object' || v === null) return;
        const o = v as Record<string, unknown>;
        if (o.type === 'Cocos.Widget') {
            o.type = 'RectAnchors';
            if (typeof o.data === 'object' && o.data !== null) delete (o.data as Record<string, unknown>).target;
            changed = true;
        }
        Object.values(o).forEach(walk);
    };
    let doc: unknown;
    try { doc = JSON.parse(text); } catch { return false; }
    walk(doc);
    if (changed) writeOut(file, JSON.stringify(doc, null, 2) + '\n');
    return changed;
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
    const editorAssets = cocosEditorAssets(version);
    const index = buildCocosAssetIndex(assetsDir, editorAssets);

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
        design: designSizeOf(source),
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
        convertedMaterial(materialUuid) {
            return convertedMaterial(materialUuid);
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

    // A material of the project's own effect, taken across: the effect's pass becomes a shader of the project, the material's settings become a
    // material of it, and the renderers that wore the Cocos material wear that one. Null when the pass cannot be given the engine's vertex stage.
    // The chunks an effect includes: the project's own (by their path under the assets folder, or just their name), then the Creator install's.
    const projectChunks = [...index.byUuid.values()].filter((e) => e.rel.endsWith('.chunk') && !e.rel.startsWith(`${INTERNAL_FOLDER}/`));
    const chunkText = (name: string): string | null => {
        const own = projectChunks.find((e) => { const rel = e.rel.replace(/\.chunk$/, ''); return rel === name || rel.endsWith(`/${name}`); });
        if (own) return readFileSync(own.file, 'utf8');
        // A bare name is one of the install's own, which Cocos finds by where it keeps them.
        const places = name.includes('/') ? [''] : ['', 'builtin/internal/', 'builtin/', 'common/', 'legacy/'];
        for (const place of places) {
            const installed = editorAssets ? path.join(editorAssets, 'chunks', `${place}${name}.chunk`) : null;
            if (installed && existsSync(installed)) return readFileSync(installed, 'utf8');
        }
        return null;
    };
    type EffectTechnique = { name: string; passes: EffectPass[]; outline: boolean[] };
    type ParsedEffect = { effect: CocosEffect; techniques: EffectTechnique[] };
    const effects = new Map<string, ParsedEffect | null>();
    const convertedMaterials = new Map<string, { ref: string } | null>();
    const effectOf = (entry: CocosAssetEntry): ParsedEffect | null => {
        if (effects.has(entry.file)) return effects.get(entry.file) ?? null;
        let result: ParsedEffect | null = null;
        try {
            const effect = parseEffect(readFileSync(entry.file, 'utf8'));
            result = { effect, techniques: effect.techniques.map((t) => ({ name: t.name, passes: t.passes, outline: t.passes.map(isOutlinePass) })) };
        } catch (err) {
            report.note('effect-unreadable', `${entry.rel}: ${(err as Error).message.split('\n')[0]}`);
        }
        effects.set(entry.file, result);
        return result;
    };
    // One shader for each combination of macros a project's materials use of a pass: the macros are baked in, so a shader has nothing left to switch.
    const shaders = new Map<string, PassConversion & { rel: string }>();
    const shaderFor = (entry: CocosAssetEntry, parsed: ParsedEffect, techIndex: number, passIndex: number, defines: Record<string, number | boolean | string>): PassConversion & { rel: string } => {
        const key = `${entry.file}|${techIndex}|${passIndex}|${JSON.stringify(Object.entries(defines).sort())}`;
        const hit = shaders.get(key);
        if (hit) return hit;
        const technique = parsed.techniques[techIndex]!;
        const stem = entry.rel.replace(/^assets\//, '').replace(/\.effect$/, '');
        const variant = Object.keys(defines).length === 0 ? '' : `.${createHash('sha1').update(JSON.stringify(Object.entries(defines).sort())).digest('hex').slice(0, 8)}`;
        const rel = outRef(`effects/${stem}.${technique.name}.${passIndex}${variant}.esshader`);
        const converted = convertPass(parsed.effect, technique.passes[passIndex]!, `${stem}.${technique.name}.${passIndex}${variant}`, { chunk: chunkText }, defines);
        const error = refused.get(rel);
        const result = error ? { shader: null, unsupported: `the converted shader does not compile: ${error}`, state: converted.state, rel } : { ...converted, rel };
        shaders.set(key, result);
        return result;
    };
    const FACTORS: Record<number, string> = { 0: 'zero', 1: 'one', 2: 'src_alpha', 3: 'dst_alpha', 4: 'one_minus_src_alpha', 5: 'one_minus_dst_alpha', 6: 'src_color', 7: 'dst_color', 8: 'one_minus_src_color', 9: 'one_minus_dst_color' };
    const numberOf = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
    type MaterialJson = {
        _effectAsset?: { __uuid__?: string }; _techIdx?: number;
        _defines?: Array<Record<string, unknown>>; _props?: Array<Record<string, unknown>>;
        _states?: Array<{ blendState?: { targets?: Array<{ blend?: boolean; blendSrc?: number; blendDst?: number }> }; rasterizerState?: { cullMode?: number }; depthStencilState?: { depthTest?: boolean; depthWrite?: boolean } }>;
    };
    /** Which pass of which effect a material is drawn with, and the macros it fixes for it; null for a material of a built-in effect or of none. */
    const planOf = (mat: CocosAssetEntry) => {
        const json = JSON.parse(readFileSync(mat.file, 'utf8')) as MaterialJson;
        // the engine's own look-alikes of Cocos's built-in effects are what a built-in effect becomes, as before
        const effectEntry = BUILTIN_EFFECTS.has(json._effectAsset?.__uuid__ ?? '') ? undefined : index.byUuid.get(json._effectAsset?.__uuid__ ?? '');
        const parsed = effectEntry && effectEntry.rel.endsWith('.effect') ? effectOf(effectEntry) : null;
        const techIndex = json._techIdx ?? 0;
        const technique = parsed?.techniques[techIndex];
        // The pass that is the surface: the first that is not an outline, which is where a material's own settings are (its arrays run by pass).
        const passIndex = technique ? Math.max(0, technique.outline.findIndex((o) => !o)) : 0;
        const defines: Record<string, number | boolean | string> = {};
        for (const [name, v] of Object.entries(json._defines?.[passIndex] ?? json._defines?.[0] ?? {})) {
            if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') defines[name] = v;
        }
        return { json, effectEntry, parsed, techIndex, technique, passIndex, defines };
    };
    /**
     * Whether each converted shader compiles, found out ahead of the conversion where the engine's shader tools are here (a checkout of the engine, which
     * the cook uses as well): glslang reads every combination the shader can take. A pass whose converted fragment does not is reported as not converted, so
     * that no material is written that names a shader the engine would refuse.
     */
    const refused = new Map<string, string>();
    const checkShaders = async (): Promise<void> => {
        const check = await shaderChecker();
        if (!check) return;
        const seen = new Set<string>();
        for (const mat of index.byUuid.values()) {
            if (!mat.rel.endsWith('.mtl') || !wanted(mat.rel)) continue;
            try {
                const plan = planOf(mat);
                if (!plan.effectEntry || !plan.parsed || !plan.technique?.passes[plan.passIndex]) continue;
                const shader = shaderFor(plan.effectEntry, plan.parsed, plan.techIndex, plan.passIndex, plan.defines);
                if (!shader.shader || seen.has(shader.rel)) continue;
                seen.add(shader.rel);
                const error = await check(shader.shader.source);
                if (error) {
                    refused.set(shader.rel, error);
                    if (process.env.COCOS_IMPORT_TRACE_DIR) writeOut(path.join(process.env.COCOS_IMPORT_TRACE_DIR, path.basename(shader.rel)), shader.shader.source);
                }
            } catch { /* a material that cannot be read is dealt with when it is converted */ }
        }
        // what was converted before the check is converted again with its answer
        shaders.clear();
    };
    const convertedMaterial = (materialUuid: string): { ref: string } | null => {
        if (convertedMaterials.has(materialUuid)) return convertedMaterials.get(materialUuid) ?? null;
        let result: { ref: string } | null = null;
        try {
            const mat = index.byUuid.get(materialUuid);
            if (mat && mat.rel.endsWith('.mtl')) {
                const { json, effectEntry, parsed, techIndex, technique, passIndex, defines } = planOf(mat);
                const pass = parsed && technique?.passes[passIndex] ? shaderFor(effectEntry!, parsed, techIndex, passIndex, defines) : null;
                if (effectEntry && technique && pass) {
                    if (!pass.shader) {
                        report.note('effect-not-converted', `${effectEntry.rel}: ${pass.unsupported}`);
                        if (process.env.COCOS_IMPORT_TRACE) console.log(`[effect] ${effectEntry.rel} (${technique.name}): ${pass.unsupported}`);
                    } else {
                        if (technique.passes.length > 1) report.note('effect-extra-passes', `${effectEntry.rel} (${technique.name}): only pass ${passIndex} is drawn${technique.outline.some(Boolean) ? ' (its outline is not)' : ''}`);
                        for (const a of pass.shader.approximations) report.note('effect-approximated', `${effectEntry.rel}: ${a}`);
                        const shaderRel = pass.rel;
                        writeText(shaderRel, pass.shader.source);
                        const materialRel = outRef(`materials/${mat.rel.replace(/^assets\//, '').replace(/\.mtl$/, '')}.esmaterial`);
                        const props = (json._props?.[passIndex] ?? json._props?.[0] ?? {}) as Record<string, unknown>;
                        const properties: Record<string, unknown> = {};
                        for (const param of pass.shader.params) {
                            const v = props[param.name];
                            if (v === undefined || v === null) continue;
                            if (param.type === 'texture') {
                                const u = typeof v === 'object' ? (v as { __uuid__?: string }).__uuid__ : undefined;
                                const entry = u ? index.byUuid.get(u.split('@')[0]!) : undefined;
                                if (entry) properties[param.name] = ctx.assetRef(entry);
                            } else if (typeof v === 'number') {
                                properties[param.name] = v;
                            } else if (typeof v === 'object') {
                                const o = v as Record<string, unknown>;
                                if ('r' in o) {
                                    const c = { r: numberOf(o.r, 255) / 255, g: numberOf(o.g, 255) / 255, b: numberOf(o.b, 255) / 255, a: numberOf(o.a, 255) / 255 };
                                    properties[param.name] = param.type === 'color' ? c : { x: c.r, y: c.g, z: c.b, w: c.a };
                                } else if ('x' in o) {
                                    properties[param.name] = param.type === 'color'
                                        ? { r: numberOf(o.x, 1), g: numberOf(o.y, 1), b: numberOf(o.z, 1), a: numberOf(o.w, 1) }
                                        : { x: numberOf(o.x, 0), y: numberOf(o.y, 0), z: numberOf(o.z, 0), w: numberOf(o.w, 0) };
                                }
                            }
                        }
                        const state = json._states?.[passIndex] ?? json._states?.[0];
                        const target = state?.blendState?.targets?.[0];
                        let blendMode = pass.state.blendMode;
                        if (target && target.blend !== undefined) {
                            const src = FACTORS[target.blendSrc ?? 1], dst = FACTORS[target.blendDst ?? 0];
                            blendMode = target.blend !== true ? 9 : src === 'src_alpha' && dst === 'one' ? 1 : src === 'one' && dst === 'one_minus_src_alpha' ? 4 : src === 'one' && dst === 'one' ? 5 : 0;
                        }
                        const cull = state?.rasterizerState?.cullMode;
                        write(materialRel, {
                            version: '1.0',
                            type: 'material',
                            shader: path.posix.relative(path.posix.dirname(materialRel), shaderRel),
                            blendMode,
                            depthTest: state?.depthStencilState?.depthTest ?? pass.state.depthTest,
                            depthWrite: state?.depthStencilState?.depthWrite ?? pass.state.depthWrite,
                            cull: cull === undefined ? pass.state.cull : cull === 0 ? 0 : cull === 1 ? 2 : 1,
                            properties,
                        });
                        report.note('effect-converted', `${effectEntry.rel} (${technique.name})`);
                        result = { ref: materialRel };
                    }
                }
            }
        } catch {
            result = null;
        }
        convertedMaterials.set(materialUuid, result);
        return result;
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
    const write = (relPath: string, json: unknown): void => writeText(relPath, `${JSON.stringify(json, null, 2)}\n`);
    const touched = new Set<string>();
    function writeText(relPath: string, text: string): void {
        touched.add(relPath);
        const file = path.join(out, relPath);
        const next = digest(text);
        const now = existsSync(file) ? digest(readFileSync(file, 'utf8')) : null;
        if (now === null) report.sync.added++;
        else if (now === next) report.sync.unchanged++;
        else if (written[relPath] === now) report.sync.updated++;
        else {
            report.sync.kept.push(relPath);
            if (!opts.dryRun && migrateWidgets(file)) report.note('widget-migrated', relPath);
            return;
        }
        written[relPath] = next;
        if (!opts.dryRun && now !== next) writeOut(file, text);
    }

    const byRel = new Map<string, CocosAssetEntry>();
    for (const e of index.byUuid.values()) byRel.set(e.rel, e);

    // Assets scripts load by path at run time (`resources.load('ui/icon')`) are named by no scene, so nothing above would bring them
    // across. They are copied, and listed by bundle in a manifest the runtime layer resolves those paths through.
    const manifest: Record<string, Record<string, { path: string; kind: string; uuid: string }>> = {};
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
                    if (ref) entries[key] = { path: ref, kind: 'prefab', uuid: entry.uuid };
                } else if (ext === 'json') {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'json', uuid: entry.uuid };
                } else if (['txt', 'text', 'xml', 'csv', 'atlas'].includes(ext)) {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'text', uuid: entry.uuid };
                } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'texture', uuid: entry.uuid };
                } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
                    entries[key] = { path: ctx.assetRef(entry), kind: 'audio', uuid: entry.uuid };
                } else if (ext === 'scene') {
                    // a scene is run by its name (`director.loadScene('scene_level_003')`), which is the file's, wherever its bundle puts it
                    entries[key] = { path: outRef(esRel(entry.rel, '.esscene')), kind: 'scene', uuid: entry.uuid };
                } else if (ext !== 'meta' && ext !== 'ts' && ext !== 'js') {
                    entries[key] = { path: '', kind: ext || 'other', uuid: entry.uuid };
                }
            }
        }
        write(outRef('resources.json'), manifest);
    }

    progress('shaders', 0, 1);
    await checkShaders();
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
        // And every script that declares a component class: a game finds its classes by name too (a view is opened by its class's name), and a
        // class no scene names is still there in Cocos.
        // The editor's own scripts (its debug tools) are not the project's and are not on disk beside it.
        const ours = (rel: string): boolean => !rel.startsWith(`${INTERNAL_FOLDER}/`);
        const everyClass = new Set([...usedScripts, ...[...scripts.values()].map((c) => c.rel)].filter(ours));
        const starters = globalDefiningScripts(index).filter((rel) => ours(rel) && !everyClass.has(rel));
        const loads = [...starters, ...[...everyClass].sort()].map((rel) => {
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
        report.note('cocos-scripts-entry', `${path.relative(out, entry).split(path.sep).join('/')}: ${everyClass.size} script(s)`);
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
        // The shaders and materials of an earlier import that this one did not write are the effects' own leftovers (a combination of macros no material
        // uses now, a material that was deleted): taken away while they are still what the importer wrote, kept once the creator has edited them.
        for (const rel of Object.keys(written)) {
            if (touched.has(rel) || !new RegExp(`^assets/${into}/(?:effects|materials)/`).test(rel)) continue;
            const file = path.join(out, rel);
            if (existsSync(file) && digest(readFileSync(file, 'utf8')) === written[rel]) {
                rmSync(file, { force: true });
                rmSync(`${file}.meta`, { force: true });
                report.note('effect-stale-removed', rel);
                delete written[rel];
            } else if (!existsSync(file)) {
                delete written[rel];
            }
        }
        progress('finish', 0, 1);
        writeOut(stateFile, `${JSON.stringify({ revision: COCOS_IMPORT_REVISION, source, documents: written }, null, 2)}\n`);
        writeOut(path.join(out, 'assets', into, 'import-report.json'), `${JSON.stringify(report.toJSON(), null, 2)}\n`);
    }
    return report.toJSON();
}
