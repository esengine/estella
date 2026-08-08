// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The desktop assembler: a runtime template plus an editor export, out the
 *        other side a thing you can double-click.
 *
 * The three-layer shape iOS and Android already use (REARCH_NATIVE_DISTRIBUTION
 * §3) — the toolchain stays on the machine that built the template and this step
 * is pure Node. Desktop had no such step at all: it wrote an npm project and
 * asked the user to install electron-builder.
 *
 * ONE function for every desktop OS, because they differ in less than they share:
 * a directory named for the app, the runtime renamed to it, one asset namespace,
 * an icon. Only the shape of that directory and how it is signed are per-OS.
 */

import path from 'path';
import { existsSync } from 'fs';
import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { pngToIcns } from './icns.js';
import { setExeIcon } from './peResource.js';
import { desktopTemplateSources, steamRedistIn } from './nativeTemplate.js';
import { fillTemplate } from './nativeApp.js';

/** Everything a bundle's Info.plist needs that is not the host's own business. */
const PLIST_DEFAULT_MIN = '11.0';

/**
 * Where each OS puts the pieces, relative to the directory the assembler produces.
 *
 * `root` is that directory's own name — it is what the Steam depot maps and what
 * a player drags, so it is the app's name on both.
 */
const LAYOUT = {
    macos: {
        root: (name) => `${name}.app`,
        executable: (name) => path.join('Contents', 'MacOS', name),
        content: path.join('Contents', 'Resources', 'Content'),
        beside: path.join('Contents', 'Resources'),
    },
    windows: {
        root: (name) => name,
        executable: (name) => `${name}.exe`,
        content: 'Content',
        beside: '.',
    },
};

/**
 * Assemble the app for @p platform from a runtime template and an export.
 *
 * The app's asset directory holds ONE namespace — the game's exported files plus
 * the runtime's precompiled bytecode — because that is what the host reads
 * through Platform::readAsset, exactly as the APK's assets/ is one namespace.
 *
 * @param {object} options
 * @param {'macos'|'windows'} options.platform
 * @param {string} options.templateDir Installed runtime template.
 * @param {string} options.contentDir  The editor export to ship.
 * @param {string} options.outDir      Where the app directory is written.
 * @param {{id: string, name: string, version: string, versionCode: number}} options.app
 * @param {string} [options.iconPng]   Project icon; the template's is used otherwise.
 * @param {string} [options.macosMin]  LSMinimumSystemVersion.
 * @param {string} [options.steamSdkDir] A Steamworks SDK on this machine; its
 *   redistributable rides along so the game can reach Steam.
 * @returns {Promise<{dir: string, steamLibrary: string | null}>} where the app is,
 *   and whether a store library went into it — a caller shipping to Steam has to
 *   be able to say so, because without it every achievement silently does nothing.
 */
export async function assembleDesktopApp(options) {
    const { platform, templateDir, contentDir, outDir, app } = options;
    const layout = LAYOUT[platform];
    if (!layout) throw new Error(`no desktop layout for "${platform}" (macos, windows)`);

    const sources = desktopTemplateSources(templateDir, platform);
    if (!existsSync(sources.executable)) {
        throw new Error(`runtime template has no executable at ${sources.executable}`);
    }
    if (!existsSync(path.join(contentDir, 'game.config.json'))) {
        throw new Error(`${contentDir} is not an editor export (no game.config.json)`);
    }

    // The directory is named by the app, and so is the executable inside it: on
    // desktop the executable IS the identity, which is why the host reads its own
    // name rather than parsing a config (see desktop.cpp appName).
    const root = path.join(outDir, layout.root(app.name));
    await rm(root, { recursive: true, force: true });

    const executable = path.join(root, layout.executable(app.name));
    await mkdir(path.dirname(executable), { recursive: true });
    await cp(sources.executable, executable);
    await chmod(executable, 0o755);

    // Entry by entry: the app directory usually lands INSIDE the export directory
    // (the layout Android has), and copying a directory into itself is refused
    // before any filter is consulted. Previous packages are skipped as not-content.
    const content = path.join(root, layout.content);
    await mkdir(content, { recursive: true });
    const packaged = new Set(Object.values(LAYOUT).map((l) => l.root(app.name)));
    for (const entry of await readdir(contentDir)) {
        if (entry.endsWith('.app') || packaged.has(entry)) continue;
        await cp(path.join(contentDir, entry), path.join(content, entry), { recursive: true });
    }
    if (existsSync(sources.bytecode)) {
        await cp(sources.bytecode, path.join(content, path.basename(sources.bytecode)));
    }

    // What the runtime dlopens goes NEXT TO THE EXECUTABLE, the one directory the
    // host looks in — Contents/MacOS on macOS (Platform::executableDir).
    const besideExe = path.dirname(executable);
    // The project's own SDK beats whatever the template was built with: a template
    // published by CI can carry no Valve file at all.
    const steamLib = steamRedistIn(options.steamSdkDir, platform)
        ?? (existsSync(sources.steamRedist) ? sources.steamRedist : null);
    if (options.steamSdkDir && !steamLib) {
        options.warn?.(`No redistributable under ${options.steamSdkDir} — a Steamworks SDK keeps it `
            + 'at redistributable_bin/<os>/. This build reaches no store.');
    }
    let steamLibrary = null;
    for (const lib of [sources.d3dCompiler, steamLib]) {
        if (!lib || !existsSync(lib)) continue;
        const shipped = path.join(besideExe, path.basename(lib));
        await cp(lib, shipped);
        if (lib === steamLib) steamLibrary = shipped;
    }

    const iconPng = options.iconPng && existsSync(options.iconPng) ? options.iconPng : sources.icon;
    if (existsSync(iconPng)) {
        const png = await readFile(iconPng);
        // Where each OS keeps it: macOS beside the app's other resources, Windows
        // INSIDE the executable — which is why one is a file to write and the
        // other is a rewrite of the thing that was just copied.
        if (platform === 'macos') {
            await writeFile(path.join(root, layout.beside, 'AppIcon.icns'), pngToIcns(png));
        } else {
            await writeFile(executable, setExeIcon(await readFile(executable), png));
        }
    }

    if (platform === 'macos') {
        const template = await readFile(sources.infoPlistIn, 'utf8');
        await writeFile(path.join(root, 'Contents', 'Info.plist'), fillTemplate(template, {
            APP_NAME: app.name,
            APP_ID: app.id,
            VERSION_NAME: app.version,
            VERSION_CODE: String(app.versionCode),
            MACOS_MIN: options.macosMin || PLIST_DEFAULT_MIN,
        }));
        await signBundle(root, options, steamLibrary ? [steamLibrary] : []);
    }
    return { dir: root, steamLibrary };
}

/**
 * Sign the assembled bundle ad-hoc, or say plainly that it is unsigned.
 *
 * The template's executable is signed AS A FILE; a bundle needs
 * `_CodeSignature/CodeResources` too, and without it the app still launches — so
 * nothing tells you until notarization. macOS only.
 *
 * Inside out: a library shipped in the bundle is code, and a bundle whose nested
 * code is unsigned fails `--verify --deep --strict` even though the bundle itself
 * signed cleanly.
 */
async function signBundle(bundle, options, nested = []) {
    if (process.platform !== 'darwin') {
        options.warn?.(`${path.basename(bundle)} is UNSIGNED — assembling on ${process.platform} `
            + 'cannot sign a macOS app. Run `codesign --force --sign - <app>` on a Mac before shipping it.');
        return;
    }
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const identity = options.signIdentity || '-';
    const sign = (target) => promisify(execFile)('codesign', ['--force', '--sign', identity, target]);
    for (const item of nested) await sign(item);
    await sign(bundle);
}
