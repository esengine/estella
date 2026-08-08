// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
/**
 * @file  The desktop assembler: a runtime template plus an editor export, out the
 *        other side a thing you can double-click.
 *
 * The three-layer shape iOS and Android already use (REARCH_NATIVE_DISTRIBUTION
 * §3) — the toolchain stays on the machine that built the template and this step
 * is pure Node. Desktop had no such step at all: it wrote an npm project and
 * asked the user to install electron-builder.
 */

import path from 'path';
import { existsSync } from 'fs';
import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { pngToIcns } from './icns.js';
import { desktopTemplateSources } from './nativeTemplate.js';
import { fillTemplate } from './nativeApp.js';

/** Everything a bundle's Info.plist needs that is not the host's own business. */
const PLIST_DEFAULT_MIN = '11.0';

/**
 * Assemble `<out>/<name>.app` from @p template and @p contentDir.
 *
 * The bundle's Resources hold ONE asset namespace — the game's exported files
 * plus the runtime's precompiled bytecode — because that is what the host reads
 * through Platform::readAsset, exactly as the APK's assets/ is one namespace.
 *
 * @param {object} options
 * @param {string} options.templateDir Installed runtime template.
 * @param {string} options.contentDir  The editor export to ship.
 * @param {string} options.outDir      Where the .app is written.
 * @param {{id: string, name: string, version: string, versionCode: number}} options.app
 * @param {string} [options.iconPng]   Project icon; the template's is used otherwise.
 * @param {string} [options.macosMin]  LSMinimumSystemVersion.
 * @returns {Promise<string>} the bundle's path.
 */
export async function assembleMacApp(options) {
    const { templateDir, contentDir, outDir, app } = options;
    const sources = desktopTemplateSources(templateDir);
    if (!existsSync(sources.executable)) {
        throw new Error(`runtime template has no executable at ${sources.executable}`);
    }
    if (!existsSync(path.join(contentDir, 'game.config.json'))) {
        throw new Error(`${contentDir} is not an editor export (no game.config.json)`);
    }

    // The bundle is named by the app, and so is the executable inside it: on
    // desktop the executable IS the identity, which is why the host reads its own
    // name rather than parsing a config (see desktop.cpp appName).
    const bundle = path.join(outDir, `${app.name}.app`);
    await rm(bundle, { recursive: true, force: true });
    const macos = path.join(bundle, 'Contents', 'MacOS');
    const resources = path.join(bundle, 'Contents', 'Resources');
    await mkdir(macos, { recursive: true });
    await mkdir(resources, { recursive: true });

    const executable = path.join(macos, app.name);
    await cp(sources.executable, executable);
    await chmod(executable, 0o755);

    // Entry by entry: the bundle usually lands INSIDE the export directory (the
    // layout Android has), and copying a directory into itself is refused before
    // any filter is consulted. Bundles are skipped as not-content.
    const content = path.join(resources, 'Content');
    await mkdir(content, { recursive: true });
    for (const entry of await readdir(contentDir)) {
        if (entry.endsWith('.app')) continue;
        await cp(path.join(contentDir, entry), path.join(content, entry), { recursive: true });
    }
    if (existsSync(sources.bytecode)) {
        await cp(sources.bytecode, path.join(content, path.basename(sources.bytecode)));
    }

    const iconPng = options.iconPng && existsSync(options.iconPng) ? options.iconPng : sources.icon;
    if (existsSync(iconPng)) {
        await writeFile(path.join(resources, 'AppIcon.icns'), pngToIcns(await readFile(iconPng)));
    }

    const template = await readFile(sources.infoPlistIn, 'utf8');
    await writeFile(path.join(bundle, 'Contents', 'Info.plist'), fillTemplate(template, {
        APP_NAME: app.name,
        APP_ID: app.id,
        VERSION_NAME: app.version,
        VERSION_CODE: String(app.versionCode),
        MACOS_MIN: options.macosMin || PLIST_DEFAULT_MIN,
    }));

    await signBundle(bundle, options);
    return bundle;
}

/**
 * Sign the assembled bundle ad-hoc, or say plainly that it is unsigned.
 *
 * The template's executable is signed AS A FILE; a bundle needs
 * `_CodeSignature/CodeResources` too, and without it the app still launches — so
 * nothing tells you until notarization. macOS only.
 */
async function signBundle(bundle, options) {
    if (process.platform !== 'darwin') {
        options.warn?.(`${path.basename(bundle)} is UNSIGNED — assembling on ${process.platform} `
            + 'cannot sign a macOS app. Run `codesign --force --sign - <app>` on a Mac before shipping it.');
        return;
    }
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const identity = options.signIdentity || '-';
    await promisify(execFile)('codesign', ['--force', '--sign', identity, bundle]);
}
