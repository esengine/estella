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

/**
 * A template's id: ONE per platform.
 *
 * Not per architecture. A platform's template carries every architecture that
 * platform needs — iOS already did, with the device and simulator slices inside
 * one xcframework — so naming an architecture in the id would make a second
 * architecture a second artifact the editor never asks for. Architectures are
 * data inside a template, not an axis of them.
 */
export function templateId(platform) {
    return platform;
}

/**
 * The Android ABIs a template can carry, in the order a package lists them.
 * `arm64-v8a` is every real device; `x86_64` is the emulator, which is how anyone
 * without a phone tries the game at all.
 *
 * The FIRST is required — a template with no device ABI packages nothing — and the
 * rest are optional, so a build machine that only did one still produces a usable
 * template.
 */
export const ANDROID_ABIS = ['arm64-v8a', 'x86_64'];

/**
 * What a template holds, per platform.
 *
 * `from` resolves the file in a BUILD TREE (the emitter's input); `rel` is where
 * it sits inside the template (what every consumer sees). `strip` marks a binary
 * whose debug info an app does not need — the host's is most of its size, and
 * shipping it unstripped also broke installing onto a clean device.
 *
 * @param {'android'|'ios'} platform
 * @param {{abis?: readonly string[]}} [options] Android ABIs to describe.
 */
export function templateLayout(platform, options = {}) {
    const abis = options.abis || ANDROID_ABIS;
    if (platform === 'ios') {
        return [
            {
                rel: 'Estella.xcframework', kind: 'dir',
                from: (ctx) => path.join(ctx.root, 'build-native-ios', 'Estella.xcframework'),
            },
            { rel: 'App/main.m', from: (ctx) => path.join(ctx.root, 'native', 'ios', 'App', 'main.m') },
            { rel: 'App/Info.plist.in', from: (ctx) => path.join(ctx.root, 'native', 'ios', 'App', 'Info.plist.in') },
            { rel: DEFAULT_ICON, from: (ctx) => path.join(ctx.root, 'native', 'icon.png') },
            // The same first-launch fix the Android template carries: without it the
            // host parses the ~700 KB SDK bundle on first run, which is seconds of
            // black screen after an install. Absent is valid — the host compiles and
            // caches instead.
            {
                rel: `assets/${BYTECODE_FILE}`, optional: true,
                from: (ctx) => path.join(ctx.root, 'build-native-ios', 'gen', BYTECODE_FILE),
            },
        ];
    }
    if (platform === 'android') {
        // Every ABI the build machine produced. Only the first is required: one
        // architecture is a working template, two is one package that installs on a
        // phone and in an emulator alike.
        const libs = abis.flatMap((abi, n) => [
            {
                rel: `lib/${abi}/libestella_js_host.so`, strip: true, abi, optional: n > 0,
                from: (ctx) => path.join(ctx.root, 'build-native', abi, 'libestella_js_host.so'),
            },
            {
                rel: `lib/${abi}/libwebgpu_dawn.so`, strip: true, abi, optional: n > 0,
                from: (ctx) => ctx.dawnLibrary?.(abi),
            },
            {
                rel: `lib/${abi}/libc++_shared.so`, abi, optional: n > 0,
                from: (ctx) => ctx.libcxxShared?.(abi),
            },
        ]);
        return [
            ...libs,
            // Compiled by the emitter (javac + d8), not copied: the IME's own side
            // of an editable field has to be Java, and a template exists so that no
            // user needs a JDK to package.
            { rel: 'classes.dex', produced: true },
            // The same Java, as source. The dex above is what the one-click package
            // needs (no JDK on the user's machine); these are what an exported
            // Android Studio project compiles, and what a game adding its own SDK
            // extends. One template carries both because both are the same shim.
            {
                rel: 'java', kind: 'dir',
                from: (ctx) => path.join(ctx.root, 'native', 'android', 'java'),
            },
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

/**
 * The Android ABIs a template actually holds — what a package can offer.
 *
 * Read off the files rather than the manifest: a template is usable if its files
 * are there, and asking the directory is what makes that true by construction.
 */
/**
 * The pieces an exported Android Studio project is assembled from, out of an
 * installed template — the Android side of {@link iosTemplateSources}.
 */
export function androidTemplateSources(dir) {
    return {
        libs: path.join(dir, 'lib'),
        java: path.join(dir, 'java'),
        dex: path.join(dir, 'classes.dex'),
        manifestIn: path.join(dir, 'AndroidManifest.xml.in'),
        icon: path.join(dir, DEFAULT_ICON),
        bytecode: path.join(dir, 'assets', BYTECODE_FILE),
    };
}

export function templateAbis(dir) {
    return ANDROID_ABIS.filter((abi) => existsSync(path.join(dir, 'lib', abi, 'libestella_js_host.so')));
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
        && manifest.engineVersion === want.engineVersion;
}

/** The distributed artifact's filename. */
export function templateZipName(platform, engineVersion) {
    return `estella-native-${templateId(platform)}-${engineVersion}.zip`;
}

// =============================================================================
// The published index
// =============================================================================

/** What a release publishes beside the archives: which templates exist for that
 *  version, and what each one must hash to. */
export const TEMPLATE_INDEX = 'native-templates.json';

/**
 * The mirror a release is copied to, and the environment variable that overrides
 * it. Empty until one is configured — a build with no mirror simply has one source.
 *
 * A mirror is a convenience, never an authority: every archive is checked against
 * the size and SHA-256 the index states, so the worst a wrong or stale mirror can
 * do is fail and hand the download back to the origin.
 */
export const RELEASE_MIRROR_ENV = 'ESTELLA_RELEASE_MIRROR';
// The project's own mirror: an R2 bucket in APAC, which is where the reports of
// slow downloads come from, behind the project's domain rather than Cloudflare's
// built-in r2.dev hostname — that one is rate limited and meant for development.
export const DEFAULT_RELEASE_MIRROR = 'https://dl.estella.games';

/** The release origin: where a version is published, and the last word on it. */
export const RELEASE_ORIGIN = 'https://github.com/esengine/estella/releases/download';

/** Mirrors to try before the origin, fastest-first. `,`-separated in the env. */
export function releaseMirrors(env = process.env) {
    const configured = env[RELEASE_MIRROR_ENV] ?? DEFAULT_RELEASE_MIRROR;
    return configured.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

/**
 * Where a release's assets live. Composed rather than stored in the index, so the
 * same index works from a mirror, a local directory or a company file share — the
 * editor is told a base, not a set of absolute URLs.
 */
export function releaseAssetBase(engineVersion) {
    return `${RELEASE_ORIGIN}/v${engineVersion}`;
}

/**
 * Every base to try for one version, in order: the mirrors, then the origin.
 *
 * One list, so the download path cannot prefer a mirror the update check has never
 * heard of. A mirror lays its versions out exactly as the origin does — `v<version>`
 * holding that release's assets — so a base swap is the whole difference.
 */
export function releaseAssetBases(engineVersion, env = process.env) {
    return [
        ...releaseMirrors(env).map((base) => `${base}/v${engineVersion}`),
        releaseAssetBase(engineVersion),
    ];
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
        && typeof t.platform === 'string'
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
export function installedTemplateDir(engineVersion, platform, storeDir = templateStoreDir()) {
    return path.join(storeDir, engineVersion, templateId(platform));
}

/**
 * The installed template for this platform, or null.
 *
 * @returns {{dir: string, manifest: object, missing: string[]}|null}
 */
export function findTemplate(want, storeDir = templateStoreDir()) {
    const dir = installedTemplateDir(want.engineVersion, want.platform, storeDir);
    const manifest = readTemplateManifest(dir);
    if (!templateMatches(manifest, want)) return null;
    return { dir, manifest, missing: missingTemplateFiles(dir, want.platform) };
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
        bytecode: path.join(dir, 'assets', BYTECODE_FILE),
    };
}
