// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The runtime template contract — what a prebuilt native runtime IS, and where it
// lives once installed.
//
// A native app's binary carries no project data: the export is content only, and
// `native/CMakeLists.txt` takes no project input (every ES_ENABLE_* is on, and the
// optional runtimes are linked in). So the compiled half is the SAME for every
// game, and belongs in an artifact built once per release rather than on each
// user's machine. That artifact is a runtime template.
//
// This module is the ONE place that names the files in one: the emitter writes
// what the table says, the editor looks for what the table says, and a template
// that satisfies the table is usable by definition. Plain ESM because both halves
// read it — build-tools and the packaged editor.

import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

/** Bumped when the LAYOUT changes shape — an older template is then refused by
 *  name instead of failing halfway through an assembly. */
export const TEMPLATE_FORMAT = 1;

export const TEMPLATE_MANIFEST = 'template.json';

/** The shipped bytecode's filename. NOT `.bc`: that is LLVM bitcode's extension,
 *  and aapt2 treats a `.bc` asset as RenderScript output — which silently drops
 *  the APK's native-code declaration, so the package installs nowhere. */
export const BYTECODE_FILE = 'esengine.native.qjsbc';

/**
 * The launcher icon an app gets when the project does not set one.
 *
 * In the template rather than in the editor because the CLI packages without an
 * editor, and shipped at all because the alternative — the platform's default —
 * is a green robot on a published game.
 */
export const DEFAULT_ICON = 'icon.png';

/** A template's id: one per thing that must be compiled separately. */
export function templateId(platform, abi) {
    return `${platform}-${abi}`;
}

/** The default ABI a platform's template carries. iOS ships both slices inside
 *  one xcframework, so its id names the device architecture only. */
export const DEFAULT_ABI = { android: 'arm64-v8a', ios: 'arm64' };

/**
 * What a template holds, per platform.
 *
 * `from` resolves the file in a BUILD TREE (the emitter's input); `rel` is where
 * it sits inside the template (what every consumer sees). `strip` marks a binary
 * whose debug info an app does not need — the host's is most of its size, and
 * shipping it unstripped also broke installing onto a clean device.
 *
 * @param {'android'|'ios'} platform
 * @param {{abi?: string}} [options]
 */
export function templateLayout(platform, options = {}) {
    const abi = options.abi || DEFAULT_ABI[platform];
    if (platform === 'ios') {
        return [
            {
                rel: 'Estella.xcframework', kind: 'dir',
                from: (ctx) => path.join(ctx.root, 'build-native-ios', 'Estella.xcframework'),
            },
            { rel: 'App/main.m', from: (ctx) => path.join(ctx.root, 'native', 'ios', 'App', 'main.m') },
            { rel: 'App/Info.plist.in', from: (ctx) => path.join(ctx.root, 'native', 'ios', 'App', 'Info.plist.in') },
            { rel: DEFAULT_ICON, from: (ctx) => path.join(ctx.root, 'native', 'icon.png') },
        ];
    }
    if (platform === 'android') {
        return [
            {
                rel: `lib/${abi}/libestella_js_host.so`, strip: true,
                from: (ctx) => path.join(ctx.root, 'build-native', 'libestella_js_host.so'),
            },
            {
                rel: `lib/${abi}/libwebgpu_dawn.so`, strip: true,
                from: (ctx) => path.join(ctx.dawnBuild, 'src', 'dawn', 'native', 'libwebgpu_dawn.so'),
            },
            { rel: `lib/${abi}/libc++_shared.so`, from: (ctx) => ctx.libcxxShared },
            // Compiled by the emitter (javac + d8), not copied: the IME's own side
            // of an editable field has to be Java, and a template exists so that no
            // user needs a JDK to package.
            { rel: 'classes.dex', produced: true },
            // Absent is valid — the host falls back to compiling the bundle, at the
            // cost of a ~14 s black screen on first launch.
            {
                rel: `assets/${BYTECODE_FILE}`, optional: true,
                from: (ctx) => path.join(ctx.root, 'build-native', 'gen', BYTECODE_FILE),
            },
            {
                rel: 'AndroidManifest.xml.in',
                from: (ctx) => path.join(ctx.root, 'native', 'android', 'host', 'AndroidManifest.xml.in'),
            },
            { rel: DEFAULT_ICON, from: (ctx) => path.join(ctx.root, 'native', 'icon.png') },
        ];
    }
    throw new Error(`Unknown native platform "${platform}" (expected android or ios).`);
}

/** Template-relative paths that must be present for a template to be usable. */
export function requiredTemplateFiles(platform, options) {
    return templateLayout(platform, options).filter((e) => !e.optional).map((e) => e.rel);
}

/** What a template is missing, if anything — the one readiness test. */
export function missingTemplateFiles(dir, platform, options) {
    return requiredTemplateFiles(platform, options).filter((rel) => !existsSync(path.join(dir, rel)));
}

// =============================================================================
// The manifest
// =============================================================================

/**
 * Read a template's `template.json`. Null when the directory holds no template,
 * or one this build cannot read — callers treat both as "not installed", which is
 * the only honest answer either way.
 */
export function readTemplateManifest(dir) {
    const file = path.join(dir, TEMPLATE_MANIFEST);
    if (!existsSync(file)) return null;
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed?.kind !== 'estella-native-template') return null;
        if (parsed.formatVersion !== TEMPLATE_FORMAT) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeTemplateManifest(dir, meta) {
    const manifest = {
        kind: 'estella-native-template',
        formatVersion: TEMPLATE_FORMAT,
        id: templateId(meta.platform, meta.abi),
        ...meta,
    };
    // No timestamp: two builds of the same commit must produce byte-identical
    // artifacts, or a published checksum means nothing.
    writeFileSync(path.join(dir, TEMPLATE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return manifest;
}

/**
 * Whether an installed template can run this editor's exports.
 *
 * The match is EXACT on version. The SDK bundle is compiled into the host binary,
 * and the cooked content, the scene format and the `es_*` surface all travel with
 * it — a near-miss is a crash on a device rather than a smaller problem.
 */
export function templateMatches(manifest, want) {
    return !!manifest
        && manifest.platform === want.platform
        && manifest.engineVersion === want.engineVersion
        && (!want.abi || manifest.abi === want.abi);
}

/** The distributed artifact's filename. */
export function templateZipName(platform, abi, engineVersion) {
    return `estella-native-${templateId(platform, abi)}-${engineVersion}.zip`;
}

// =============================================================================
// The published index
// =============================================================================

/** What a release publishes beside the archives: which templates exist for that
 *  version, and what each one must hash to. */
export const TEMPLATE_INDEX = 'native-templates.json';

/**
 * Where a release's assets live. Composed rather than stored in the index, so the
 * same index works from a mirror, a local directory or a company file share — the
 * editor is told a base, not a set of absolute URLs.
 */
export function releaseAssetBase(engineVersion) {
    return `https://github.com/esengine/estella/releases/download/v${engineVersion}`;
}

/**
 * Validate a published index. Returns its entries, or null when the document is
 * not one — a 404 page and a truncated download are both "no index", and neither
 * should reach the code that decides what to install.
 */
export function parseTemplateIndex(doc, engineVersion) {
    if (doc?.kind !== 'estella-native-templates' || doc.formatVersion !== TEMPLATE_FORMAT) return null;
    if (engineVersion && doc.engineVersion !== engineVersion) return null;
    if (!Array.isArray(doc.templates)) return null;
    const entries = doc.templates.filter((t) => typeof t?.id === 'string'
        && typeof t.platform === 'string' && typeof t.abi === 'string'
        && typeof t.file === 'string' && /^[\w.-]+$/.test(t.file)
        && typeof t.sha256 === 'string' && /^[0-9a-f]{64}$/.test(t.sha256)
        && Number.isInteger(t.bytes) && t.bytes > 0);
    return entries.length > 0 ? entries : null;
}

// =============================================================================
// Where templates live
// =============================================================================

/**
 * Estella's own data directory. Deliberately not Electron's `userData`: the CLI
 * emits templates and the editor consumes them, so the path has to be one both
 * can compute the same way, without importing Electron.
 */
export function estellaDataDir() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Estella');
    if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Estella');
    return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Estella');
}

/** The template store. `ESTELLA_NATIVE_TEMPLATES` overrides it — for CI, for a
 *  shared network location, and for tests. */
export function templateStoreDir() {
    return process.env.ESTELLA_NATIVE_TEMPLATES || path.join(estellaDataDir(), 'native-templates');
}

/** Where one template installs to. Versioned, so upgrading the editor never
 *  silently reuses the previous release's binary. */
export function installedTemplateDir(engineVersion, platform, abi, storeDir = templateStoreDir()) {
    return path.join(storeDir, engineVersion, templateId(platform, abi));
}

/**
 * The installed template for this platform, or null.
 *
 * @returns {{dir: string, manifest: object, missing: string[]}|null}
 */
export function findTemplate(want, storeDir = templateStoreDir()) {
    const abi = want.abi || DEFAULT_ABI[want.platform];
    const dir = installedTemplateDir(want.engineVersion, want.platform, abi, storeDir);
    const manifest = readTemplateManifest(dir);
    if (!templateMatches(manifest, { ...want, abi })) return null;
    return { dir, manifest, missing: missingTemplateFiles(dir, want.platform, { abi }) };
}

// =============================================================================
// Per-platform consumers
// =============================================================================

/**
 * The three pieces an iOS Xcode project is built around. Named here rather than
 * at the call site so the layout table stays the only thing that knows filenames.
 */
export function iosTemplateSources(dir) {
    return {
        xcframework: path.join(dir, 'Estella.xcframework'),
        mainM: path.join(dir, 'App', 'main.m'),
        infoPlistIn: path.join(dir, 'App', 'Info.plist.in'),
        icon: path.join(dir, DEFAULT_ICON),
    };
}
