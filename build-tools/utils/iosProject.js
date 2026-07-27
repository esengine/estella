// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Turning an iOS export into a project the user can open.
//
// An export that hands back a content folder plus two commands to type is not a
// build — every engine worth using gives you an Xcode project you can
// double-click. Generating one needs NO compiler: the engine is a prebuilt
// xcframework from the runtime template and the app shell is a `main.m` plus a
// plist, so the whole step is copy + write.
//
// Plain ESM, and the ONE implementation: the editor's export and
// `cli native --target ios --package` both call it, so a project written by the
// CLI and one written by the editor cannot differ.

import path from 'path';
import { cp, mkdir, readdir, rm, readFile, writeFile } from 'fs/promises';
import { renderPbxproj, renderScheme } from './xcodeProject.js';
import { iosInterfaceOrientations } from './nativeApp.js';

/** The asset catalog Xcode compiles the app icon out of. A single 1024×1024 image
 *  is all a modern catalog needs — Xcode derives every size the system asks for,
 *  so nothing here resizes anything. */
const ICON_CATALOG = 'Assets.xcassets';

async function writeIconCatalog(contentDir, iconPng) {
    const iconSet = path.join(contentDir, ICON_CATALOG, 'AppIcon.appiconset');
    await mkdir(iconSet, { recursive: true });
    await writeFile(path.join(iconSet, 'icon.png'), iconPng);
    await writeFile(path.join(iconSet, 'Contents.json'), `${JSON.stringify({
        images: [{ filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
        info: { author: 'estella', version: 1 },
    }, null, 2)}\n`);
    await writeFile(path.join(contentDir, ICON_CATALOG, 'Contents.json'), `${JSON.stringify({
        info: { author: 'estella', version: 1 },
    }, null, 2)}\n`);
}

/** A target/product name Xcode and the shell can both carry unquoted. */
function targetName(appName) {
    return appName.replace(/[^A-Za-z0-9]+/g, '') || 'EstellaGame';
}

/**
 * Write the Xcode project into an export, in place: the export directory BECOMES
 * the project. Its cooked files stay where they are and join the resources phase
 * directly — they land at the bundle root, which is where the host reads them.
 *
 * @param {string} contentDir  The export (cooked content + the two configs).
 * @param {{id: string, name: string, version: string, versionCode: number,
 *          orientation: 'landscape'|'portrait'}} app  From `app.config.json`.
 * @param {{xcframework: string, mainM: string, infoPlistIn: string, icon?: string}} sources
 *        The prebuilt pieces, out of the installed runtime template.
 * @param {string} [deploymentTarget]
 * @param {Buffer} [icon] The launcher icon; the template's default when absent.
 * @returns {Promise<string>} The `.xcodeproj` path, to reveal or open.
 */
export async function emitIosXcodeProject(contentDir, app, sources, deploymentTarget = '17.0', icon) {
    const name = targetName(app.name);
    const frameworkName = 'Estella.xcframework';
    const projectDir = path.join(contentDir, `${name}.xcodeproj`);
    const appDir = path.join(contentDir, 'App');
    const frameworkDest = path.join(contentDir, frameworkName);

    // Rewritten wholesale so a re-export never inherits the last one's stale
    // slices, plist or object graph.
    await rm(projectDir, { recursive: true, force: true });
    await rm(appDir, { recursive: true, force: true });
    await rm(frameworkDest, { recursive: true, force: true });
    await rm(path.join(contentDir, ICON_CATALOG), { recursive: true, force: true });

    await cp(sources.xcframework, frameworkDest, { recursive: true });
    await mkdir(appDir, { recursive: true });
    await cp(sources.mainM, path.join(appDir, 'main.m'));

    await writeIconCatalog(contentDir, icon ?? await readFile(sources.icon));

    const template = await readFile(sources.infoPlistIn, 'utf8');
    const orientations = iosInterfaceOrientations(app.orientation)
        .map((o) => `\t\t<string>${o}</string>`).join('\n');
    await writeFile(path.join(appDir, 'Info.plist'), template
        .replace(/@APP_NAME@/g, app.name)
        .replace(/@VERSION_NAME@/g, app.version)
        .replace(/@VERSION_CODE@/g, String(app.versionCode))
        .replace(/@ORIENTATIONS@/g, orientations));

    // Everything the export wrote, minus what this function just added. Dotfiles
    // stay out: a .DS_Store in a resources phase is a code-signing failure.
    const skip = new Set([`${name}.xcodeproj`, 'App', frameworkName]);
    const resources = (await readdir(contentDir, { withFileTypes: true }))
        .filter((e) => !skip.has(e.name) && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
        .sort((a, b) => a.name.localeCompare(b.name));

    await mkdir(path.join(projectDir, 'xcshareddata', 'xcschemes'), { recursive: true });
    await writeFile(path.join(projectDir, 'project.pbxproj'), renderPbxproj({
        name,
        bundleId: app.id,
        version: app.version,
        versionCode: app.versionCode,
        deploymentTarget,
        frameworkName,
        resources,
    }));
    await writeFile(
        path.join(projectDir, 'xcshareddata', 'xcschemes', `${name}.xcscheme`),
        renderScheme(name));

    return projectDir;
}
