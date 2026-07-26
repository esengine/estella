// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The built-in packaging targets, named once.
 *
 *        Three surfaces used to carry their own copy of this list — the build
 *        dialog's descriptors, the main process's readiness catalog, and the
 *        Inspector's per-platform Import Settings tabs — and the third had drifted
 *        (it never offered the mobile targets at all, so a texture could not be
 *        tuned for the platform where memory is tightest). The ids live here; each
 *        surface adds only what is genuinely its own (icons and copy in the
 *        renderer, filesystem probes in the main process).
 *
 *        Deliberately free of node and React imports: the electron export, the
 *        renderer and the tests all read it.
 */

/**
 * The targets the editor ships. `android` and `ios` are two platforms, not one
 * "native": they package through different toolchains (aapt2 + apksigner vs
 * Xcode), so a single row could not tell you what to run, whether this machine
 * can run it, or where the package comes out.
 */
export type BuiltinPlatform = 'web' | 'desktop' | 'wechat' | 'playable' | 'android' | 'ios';

/** Built-ins, in the order they are offered. */
export const BUILTIN_PLATFORMS: readonly BuiltinPlatform[] = [
    'web', 'desktop', 'wechat', 'playable', 'android', 'ios',
];

/**
 * A packaging target. The editor's built-ins are named for completion, but the
 * type is OPEN: a project can add its own platform by dropping a profile in
 * `.esengine/platforms/<id>.mjs`, and that id flows through packaging settings,
 * the export result and the cook's per-platform Import Settings key exactly like
 * a built-in one.
 */
export type ExportPlatform = BuiltinPlatform | (string & {});

/**
 * The targets that ship as a real native app (embedded Dawn + QuickJS, see
 * `native/README.md`). They share ONE runtime and ONE export payload — content
 * only, since the engine, the SDK and the game runtime live in the app binary —
 * and differ in how that content is assembled into an installable app.
 */
export const NATIVE_PLATFORMS = ['android', 'ios'] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

/** Whether this target's export is app CONTENT rather than a runnable payload. */
export function isNativePlatform(platform: ExportPlatform): platform is NativePlatform {
    return platform === 'android' || platform === 'ios';
}

/**
 * Platform ids written by an older editor, and what they are today. `native` was
 * one row covering both mobile targets; a project that selected it re-opens on
 * Android — the target whose toolchain runs on every desktop OS.
 */
export const LEGACY_PLATFORM_IDS: Readonly<Record<string, BuiltinPlatform>> = {
    native: 'android',
};

/** A persisted platform id, as this editor spells it. Unknown ids pass through —
 *  they belong to the project's own platforms. */
export function normalizePlatform(id: string): string {
    return LEGACY_PLATFORM_IDS[id] ?? id;
}

/** The default output directory for a built-in target. */
export function defaultOutDir(platform: ExportPlatform): string {
    return `dist-${platform}`;
}

/**
 * Why a target is not ready to produce a package. STRUCTURED, not prose: the main
 * process probes the filesystem but has no locale, so it reports the facts and
 * the build dialog writes the sentence.
 *
 * The two kinds are not the same severity, and the dialog says so. A missing
 * ENGINE RUNTIME means the package cannot be produced at all. A missing native
 * TOOLCHAIN does not: the export writes the app's content either way — only the
 * final assembly into an installable app needs the toolchain, and that step can
 * run on another machine (an iOS build always does, when the editor is on
 * Windows).
 */
export type PlatformPrereq =
    | {
        kind: 'runtime-missing';
        /** Display path that was searched (project-relative where possible). */
        dir: string;
        /** Glue filenames looked for in it. */
        looked: string[];
        /** The build command that produces it — only when the editor ships that target. */
        command?: string;
    }
    | {
        kind: 'toolchain-missing';
        /** Which piece is absent — the dialog maps it to a localized sentence. */
        tool: NativeToolchain;
    }
    | {
        /**
         * No RUNTIME TEMPLATE for this target: the prebuilt engine a native app is
         * assembled around (see `build-tools/utils/nativeTemplate.js`). Its own kind
         * because the fix is neither "build the engine" nor "install a toolchain" —
         * it is an artifact this editor release ships, installed once.
         */
        kind: 'template-missing';
        /** The template looked for (`ios-arm64`). */
        id: string;
        /** The version it must carry — this editor's. A template is matched exactly:
         *  the SDK bundle is compiled into the app binary. */
        version: string;
    };

/** The native toolchain pieces the editor probes for. */
export type NativeToolchain = 'xcode' | 'macos';
