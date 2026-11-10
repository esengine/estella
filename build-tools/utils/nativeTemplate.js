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
 * The HLSL compiler Dawn's D3D backend loads before it can create a device.
 *
 * It ships WITH the game rather than being taken from System32: Dawn's own note
 * says the OS copy has functionality and heap-corruption bugs on older Windows,
 * so a game carries the SDK's. Dawn looks beside the executable first.
 */
export const D3D_COMPILER = 'd3dcompiler_47.dll';

/**
 * What a V8 desktop host loads beside itself on Windows: V8 is a set of DLLs plus
 * the Intl data its build carries. All or none — a QuickJS host has none of them,
 * and a V8 host missing one does not start (see native/host/js/esjs_v8.cpp).
 */
export const V8_WINDOWS_RUNTIME = [
    'v8.dll', 'v8_libbase.dll', 'v8_libplatform.dll', 'icuuc.dll', 'icui18n.dll', 'zlib.dll', 'icudtl.dat',
];

/** The V8 an Android V8 host links, one per ABI beside the host library. */
export const V8_ANDROID_LIBRARY = 'libv8android.so';

/**
 * PhysX, as the Android host's optional library (native/CMakeLists.txt). The
 * template keeps it under `plugins/<abi>/`, outside the `lib/` every package
 * copies, so a package carries it only when its project's 3D solver is PhysX
 * ({@link androidPhysXLibs}); the host dlopens it by name when it is there.
 */
export const ANDROID_PHYSX_LIBRARY = 'libestella_physx.so';

/**
 * PhysX's library for each of `abis`, for a package's `lib/<abi>/` — or null when
 * the template carries none (a host built with -DESTELLA_PHYSX=OFF), in which case
 * a PhysX project runs on Jolt and its log says so.
 *
 * @param {string} dir  An installed android template.
 * @param {string[]} abis  The ABIs the package carries.
 * @returns {Record<string, string[]> | null}
 */
export function androidPhysXLibs(dir, abis) {
    const found = abis
        .map((abi) => [abi, path.join(dir, 'plugins', abi, ANDROID_PHYSX_LIBRARY)])
        .filter(([, file]) => existsSync(file));
    return found.length === 0 ? null : Object.fromEntries(found.map(([abi, file]) => [abi, [file]]));
}

/** Where an Android V8 host reads its startup snapshot from, inside the package's
 *  assets — the name native/CMakeLists.txt compiles in as ESJS_V8_SNAPSHOT_ASSET. */
export function v8SnapshotAsset(abi) {
    return `v8/${abi}/snapshot_blob.bin`;
}

/** The JS engine a template's host embeds, read off the files it carries: 'v8'
 *  when the V8 runtime is there, 'quickjs' otherwise. */
export function templateJsEngine(dir, platform) {
    if (platform === 'windows') return existsSync(path.join(dir, 'v8.dll')) ? 'v8' : 'quickjs';
    if (platform === 'android') {
        return ANDROID_ABIS.some((abi) => existsSync(path.join(dir, 'lib', abi, V8_ANDROID_LIBRARY)))
            ? 'v8' : 'quickjs';
    }
    return 'quickjs';
}

/** Steam's redistributable, per platform — the filename the host dlopens. */
export const STEAM_REDIST = {
    windows: 'steam_api64.dll',
    macos: 'libsteam_api.dylib',
    linux: 'libsteam_api.so',
};

/**
 * The redistributable inside a Steamworks SDK checkout, or null.
 *
 * The one place that knows an SDK's layout: the template build reads it here, and
 * so does the assembler, which is where a project's own SDK reaches a package.
 */
export function steamRedistIn(sdkDir, platform) {
    if (!sdkDir) return null;
    const sub = { windows: 'win64', macos: 'osx', linux: 'linux64' }[platform];
    const file = path.join(sdkDir, 'redistributable_bin', sub, STEAM_REDIST[platform]);
    return existsSync(file) ? file : null;
}

/** Where the Windows SDK keeps the redistributable D3D compiler, newest first. */
function windowsSdkD3DRedist() {
    const root = 'C:/Program Files (x86)/Windows Kits/10/Redist/D3D/x64';
    return existsSync(path.join(root, D3D_COMPILER)) ? path.join(root, D3D_COMPILER) : null;
}

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
 * Every platform a template is built and published for. One list, because the
 * alternative already failed: the release gate kept its own pair of names while
 * three desktop platforms landed in {@link templateLayout}, and the publish step
 * then rejected three archives it had just built correctly.
 */
export const TEMPLATE_PLATFORMS = ['android', 'ios', 'macos', 'windows', 'linux'];

/** Whether {@link templateLayout} can describe this platform. */
export function isTemplatePlatform(platform) {
    return TEMPLATE_PLATFORMS.includes(platform);
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
 * The ABIs a phone can run. A package carries only these unless it is asked for the
 * emulator's too: x86_64 is the other half of the engine's size, and no player's device
 * can use it.
 */
export const ANDROID_DEVICE_ABIS = ['arm64-v8a'];

/**
 * What a template holds, per platform.
 *
 * `from` resolves the file in a BUILD TREE (the emitter's input); `rel` is where
 * it sits inside the template (what every consumer sees). `strip` marks a binary
 * whose debug info an app does not need — the host's is most of its size, and
 * shipping it unstripped also broke installing onto a clean device.
 *
 * @param {'android'|'ios'|'macos'} platform
 * @param {{abis?: readonly string[]}} [options] Android ABIs to describe.
 */
export function templateLayout(platform, options = {}) {
    const abis = options.abis || ANDROID_ABIS;
    if (platform === 'ios') {
        return [
            {
                rel: 'Estella.xcframework', kind: 'dir',
                from: (ctx) => path.join(ctx.root, 'build/cmake/native-ios', 'Estella.xcframework'),
            },
            { rel: 'App/main.m', from: (ctx) => path.join(ctx.root, 'native', 'ios', 'App', 'main.m') },
            { rel: 'App/Info.plist.in', from: (ctx) => path.join(ctx.root, 'native', 'ios', 'App', 'Info.plist.in') },
            { rel: DEFAULT_ICON, from: (ctx) => path.join(ctx.root, 'native', 'icon.png') },
            // The same first-launch fix the Android template carries: without it the
            // host parses the ~700 KB SDK bundle on first run, which is seconds of
            // black screen after an install. A local build without it still works —
            // a PUBLISHED one may not ship that first launch to every game made with
            // it, so `release` requires what `optional` excuses.
            {
                rel: `assets/${BYTECODE_FILE}`, optional: true, releaseRequired: true,
                from: (ctx) => path.join(ctx.root, 'build/cmake/native-ios', 'gen', BYTECODE_FILE),
            },
        ];
    }
    if (platform === 'macos' || platform === 'windows' || platform === 'linux') {
        const exe = platform === 'windows' ? 'estella_desktop.exe' : 'estella_desktop';
        const buildDir = `build/cmake/native-${platform}`;
        // The shortest layout of the three, because a desktop build embeds
        // everything: Dawn and SDL are linked statically, so the runtime is one
        // executable and there is no second file to find at run time.
        return [
            {
                // MSVC leaves debug info in a separate .pdb, so there is nothing to
                // strip out of the executable — and no signature to invalidate.
                rel: exe, strip: platform === 'macos',
                from: (ctx) => path.join(ctx.root, buildDir, exe),
            },
            // Beside the game's own files, not in a directory of its own: the host
            // reads it through Platform::readAsset, which is one namespace — the
            // same one the APK's assets/ is.
            // QuickJS only: a V8 host compiles the bundle on the device (and caches
            // it), so its template carries the V8 runtime instead and owes no bytecode.
            {
                rel: BYTECODE_FILE, optional: true, releaseRequired: true,
                excusedBy: platform === 'windows' ? 'v8.dll' : undefined,
                from: (ctx) => path.join(ctx.root, buildDir, 'gen', BYTECODE_FILE),
            },
            ...(platform === 'windows' ? V8_WINDOWS_RUNTIME.map((rel) => ({
                rel, optional: true,
                from: (ctx) => path.join(ctx.root, buildDir, rel),
            })) : []),
            // The bundle description macOS wants; Windows has no counterpart, and
            // an entry every consumer would have to check for is worse than a
            // layout that differs where the platforms do.
            ...(platform === 'macos' ? [{
                rel: 'Info.plist.in',
                from: (ctx) => path.join(ctx.root, 'native', 'desktop', 'Info.plist.in'),
            }] : []),
            // Required to create a device at all, so a template without it produces
            // an app that opens and immediately reports a lost device.
            ...(platform === 'windows' ? [{
                rel: D3D_COMPILER, releaseRequired: true, optional: true,
                from: () => windowsSdkD3DRedist(),
            }] : []),
            // Steam's redistributable, from an SDK on the BUILD machine
            // (`--steam-sdk <dir>`) and never from this repository. Optional — a
            // template without it still packages every game.
            {
                rel: STEAM_REDIST[platform], optional: true,
                from: (ctx) => steamRedistIn(ctx.steamSdk, platform),
            },
            { rel: DEFAULT_ICON, from: (ctx) => path.join(ctx.root, 'native', 'icon.png') },
        ];
    }
    if (platform === 'android') {
        // Every ABI the build machine produced. Only the first is required: one
        // architecture is a working template, two is one package that installs on a
        // phone and in an emulator alike. A release builds both, so a release is
        // held to both — losing the emulator ABI costs everyone without a phone
        // their only way to run the game.
        const libs = abis.flatMap((abi, n) => [
            {
                rel: `lib/${abi}/libestella_js_host.so`, strip: true, abi, optional: n > 0, releaseRequired: true,
                from: (ctx) => path.join(ctx.root, 'build/cmake/native', abi, 'libestella_js_host.so'),
            },
            {
                rel: `lib/${abi}/libwebgpu_dawn.so`, strip: true, abi, optional: n > 0, releaseRequired: true,
                from: (ctx) => ctx.dawnLibrary?.(abi),
            },
            {
                // Stripped like the two above: the NDK's own copy carries 7.5 MB of debug
                // info per ABI, which is 8 of the 9.2 MB it weighs.
                rel: `lib/${abi}/libc++_shared.so`, strip: true, abi, optional: n > 0, releaseRequired: true,
                from: (ctx) => ctx.libcxxShared?.(abi),
            },
            {
                // The JIT a V8 host runs on — placed beside the host by its build
                // (native/CMakeLists.txt). Absent from a QuickJS build, which is why
                // it is optional: the host it belongs to cannot load without it.
                rel: `lib/${abi}/${V8_ANDROID_LIBRARY}`, strip: true, abi, optional: true,
                from: (ctx) => path.join(ctx.root, 'build/cmake/native', abi, V8_ANDROID_LIBRARY),
            },
            {
                // PhysX, the optional 3D solver: outside lib/ so that only a
                // package whose project picked it carries it (androidPhysXLibs).
                rel: `plugins/${abi}/${ANDROID_PHYSX_LIBRARY}`, strip: true, abi, optional: true,
                from: (ctx) => path.join(ctx.root, 'build/cmake/native', abi, ANDROID_PHYSX_LIBRARY),
            },
            {
                // Its startup snapshot, which this V8 keeps outside the library. An
                // asset, read by the host before the engine starts (Runtime.cpp).
                rel: `assets/${v8SnapshotAsset(abi)}`, abi, optional: true,
                from: (ctx) => path.join(ctx.root, 'build/cmake/native', abi, 'v8_snapshot_blob.bin'),
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
            // Absent is valid in a local build — the host falls back to compiling the
            // bundle, at the cost of a ~14 s black screen on first launch. Not valid
            // in a release: v0.36.0 shipped without it, and every Android package
            // built from that template opened black.
            {
                rel: `assets/${BYTECODE_FILE}`, optional: true, releaseRequired: true,
                excusedBy: `lib/${abis[0]}/${V8_ANDROID_LIBRARY}`,
                from: (ctx) => path.join(ctx.root, 'build/cmake/native', 'gen', BYTECODE_FILE),
            },
            {
                rel: 'AndroidManifest.xml.in',
                from: (ctx) => path.join(ctx.root, 'native', 'android', 'host', 'AndroidManifest.xml.in'),
            },
            { rel: DEFAULT_ICON, from: (ctx) => path.join(ctx.root, 'native', 'icon.png') },
        ];
    }
    throw new Error(`No template layout for "${platform}" — ${TEMPLATE_PLATFORMS.join(', ')} have one.`);
}

/**
 * The entries a template must carry, for one audience.
 *
 * `optional` is not one question but two, and conflating them is how a release
 * shipped an Android template with no precompiled bytecode: a contributor's local
 * build is fine without it (the host compiles on the device instead), and a
 * PUBLISHED template is not — every game packaged from it then opens on a black
 * screen the first time. `release: true` applies the stricter rule.
 */
function requiredTemplateEntries(platform, options = {}) {
    return templateLayout(platform, options)
        .filter((e) => !e.optional || (options.release && e.releaseRequired));
}

/** Template-relative paths that must be present for a template to be usable. */
export function requiredTemplateFiles(platform, options) {
    return requiredTemplateEntries(platform, options).map((e) => e.rel);
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
        /** A V8 host's startup snapshots, one per ABI; absent from a QuickJS template. */
        v8Snapshots: path.join(dir, 'assets', 'v8'),
    };
}

export function templateAbis(dir) {
    return ANDROID_ABIS.filter((abi) => existsSync(path.join(dir, 'lib', abi, 'libestella_js_host.so')));
}

/**
 * The ABIs one package carries: the template's device ABIs, and the emulator's as well
 * when `emulator` asks. Empty when the template has none of what was asked for, which the
 * assembler reports by name rather than writing an app that installs on nothing.
 *
 * @param {string} dir An installed android template.
 * @param {{emulator?: boolean}} [options]
 */
export function packageAbis(dir, options = {}) {
    return templateAbis(dir).filter((abi) => options.emulator || ANDROID_DEVICE_ABIS.includes(abi));
}

/** The message for a template that has nothing to package under the ABI choice made. */
export function noPackageAbisMessage(dir, options = {}) {
    const has = templateAbis(dir);
    if (has.length === 0) return 'The runtime template carries no native libraries.';
    return `The runtime template carries only ${has.join(', ')}, and ${options.emulator ? 'none of it' : 'no device ABI'} `
        + 'can be packaged. Install a template that includes arm64-v8a'
        + `${options.emulator ? '' : ', or ask for the emulator ABI (emulatorAbi / --emulator-abi) to package an emulator-only template'}.`;
}

/** What a template is missing, if anything — the one readiness test. An entry
 *  `excusedBy` another is not owed when that other is there: a V8 host's template
 *  owes no QuickJS bytecode. */
export function missingTemplateFiles(dir, platform, options) {
    const has = (rel) => existsSync(path.join(dir, rel));
    return requiredTemplateEntries(platform, options)
        .filter((e) => !has(e.rel) && !(e.excusedBy && has(e.excusedBy))).map((e) => e.rel);
}

/**
 * The same test over a LISTING rather than a directory — for an archive that has
 * not been unpacked, which is the form a template is published in and therefore
 * the form worth checking before anyone can install it.
 *
 * A directory entry is present when something inside it is: a zip stores the
 * files, not the folder.
 */
export function missingTemplateEntries(names, platform, options = {}) {
    const held = names.map((n) => n.split('\\').join('/').replace(/\/+$/, ''));
    const set = new Set(held);
    const has = (e) => (e.kind === 'dir'
        ? held.some((n) => n === e.rel || n.startsWith(`${e.rel}/`))
        : set.has(e.rel));
    return requiredTemplateEntries(platform, options)
        .filter((e) => !has(e) && !(e.excusedBy && set.has(e.excusedBy))).map((e) => e.rel);
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

/** What a host links when nobody chose: native/CMakeLists.txt's own default. */
export const DEFAULT_TEMPLATE_SPINE = '4.2';

/** The Spine runtime a template without the field was built with — every one
 *  published before the manifest recorded it took the CMake default. */
export function templateSpineVersion(manifest) {
    return manifest?.spineVersion || DEFAULT_TEMPLATE_SPINE;
}

/** The build directories a template for `platform` is packed from. */
function hostBuildDirs(root, platform, abis) {
    if (platform === 'ios') return [path.join(root, 'build/cmake/native-ios')];
    if (platform === 'android') return (abis ?? []).map((abi) => path.join(root, 'build/cmake/native', abi));
    return [path.join(root, `build/cmake/native-${platform}`)];
}

/**
 * The Spine runtime the host builds behind a template actually linked, read from
 * their CMake caches. A host links exactly one (every vendored runtime exports the
 * same symbols), and the manifest is what an export checks a project against, so
 * it records what the build DID — a cache set by hand included — not a default.
 * Null when no build dir has a cache to read.
 */
export function builtSpineVersion(root, platform, abis) {
    const seen = new Map();
    for (const dir of hostBuildDirs(root, platform, abis)) {
        const cache = path.join(dir, 'CMakeCache.txt');
        if (!existsSync(cache)) continue;
        const m = /^ESTELLA_SPINE_VERSION:[A-Z]+=(.*)$/m.exec(readFileSync(cache, 'utf8'));
        seen.set(dir, m ? m[1].trim() : DEFAULT_TEMPLATE_SPINE);
    }
    const versions = new Set(seen.values());
    if (versions.size > 1) {
        throw new Error(`The ${platform} builds link different Spine runtimes (${[...seen].map(([d, v]) => `${path.basename(d)}: ${v}`).join(', ')}): `
            + 'one template carries one. Rebuild them with the same --spine.');
    }
    return versions.size ? [...versions][0] : null;
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

/** The desktop equivalent — the runtime binary and the three files the assembler
 *  composes an app bundle from. */
export function desktopTemplateSources(dir, platform = 'macos') {
    return {
        executable: path.join(dir, platform === 'windows' ? 'estella_desktop.exe' : 'estella_desktop'),
        infoPlistIn: path.join(dir, 'Info.plist.in'),
        icon: path.join(dir, DEFAULT_ICON),
        bytecode: path.join(dir, BYTECODE_FILE),
        /** Windows only; absent elsewhere. */
        d3dCompiler: path.join(dir, D3D_COMPILER),
        /** A V8 host's runtime, beside the executable; none of it in a QuickJS template. */
        v8Runtime: platform === 'windows' ? V8_WINDOWS_RUNTIME.map((rel) => path.join(dir, rel)) : [],
        /** Steam's redistributable, when the template was emitted with an SDK. */
        steamRedist: path.join(dir, STEAM_REDIST[platform] ?? STEAM_REDIST.macos),
    };
}
