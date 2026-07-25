// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    iosProject.ts
 * @brief   Turn an iOS export into a project the user can open.
 *
 * @details An export that hands back a content folder plus two commands to type is
 *          not a build — Unity and Godot both give you an Xcode project you can
 *          double-click, and so should this. Generating one needs no compiler: the
 *          engine is a prebuilt xcframework and the app shell is a `main.m` plus a
 *          plist, so the whole step is copy + write, which is why it belongs in the
 *          export rather than behind a separate "assemble" action.
 *
 *          The pbxproj writer is shared with `cli native --target ios --package`
 *          (build-tools/utils/xcodeProject.js) so the two paths cannot drift.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
// @ts-expect-error — plain ESM JS, shared with the CLI; bundled in by vite.
import { renderPbxproj, renderScheme } from '../../build-tools/utils/xcodeProject.js';

export interface IosProjectSources {
    /** The engine, built for device + simulator (`cli native --target ios`). */
    xcframework: string;
    /** Holds `main.m` and `Info.plist.in` — the signing/packaging shell. */
    appShell: string;
}

export interface IosAppIdentity {
    id: string;
    name: string;
    version: string;
    versionCode: number;
    orientation: 'landscape' | 'portrait';
}

/**
 * Where the pieces live, or null when this install cannot finish an iOS export.
 *
 * A dev checkout builds the xcframework into `build-native-ios/`; a shipped editor
 * carries it as a resource. Absent means the engine was never built for iOS here —
 * the export still writes its content, it just cannot wrap a project around it.
 */
export function iosProjectSources(candidates: {
    resourcesPath?: string;
    repoRoot?: string;
}): IosProjectSources | null {
    const roots = [
        ...(candidates.resourcesPath ? [path.join(candidates.resourcesPath, 'ios')] : []),
        ...(candidates.repoRoot ? [candidates.repoRoot] : []),
    ];
    for (const root of roots) {
        const xcframework = path.join(root, 'build-native-ios', 'Estella.xcframework');
        const appShell = path.join(root, 'native', 'ios', 'App');
        if (existsSync(xcframework) && existsSync(path.join(appShell, 'main.m'))) {
            return { xcframework, appShell };
        }
        // A shipped editor stages them flat, without the checkout's directory shape.
        const flatFramework = path.join(root, 'Estella.xcframework');
        const flatShell = path.join(root, 'App');
        if (existsSync(flatFramework) && existsSync(path.join(flatShell, 'main.m'))) {
            return { xcframework: flatFramework, appShell: flatShell };
        }
    }
    return null;
}

/** A target/product name Xcode and the shell can both carry unquoted. */
function targetName(appName: string): string {
    return appName.replace(/[^A-Za-z0-9]+/g, '') || 'EstellaGame';
}

/** The orientations the OS may rotate among; mirrors nativeApp.js's iOS mapping. */
function interfaceOrientations(orientation: 'landscape' | 'portrait'): string[] {
    return orientation === 'portrait'
        ? ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown']
        : ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
}

/**
 * Write the Xcode project into an export, in place: the export directory BECOMES
 * the project. Its cooked files stay where they are and join the resources phase
 * directly — they land at the bundle root, which is where the host reads them.
 *
 * @returns The `.xcodeproj` path, for the editor to reveal or open.
 */
export async function emitIosXcodeProject(
    contentDir: string,
    app: IosAppIdentity,
    sources: IosProjectSources,
    deploymentTarget = '17.0',
): Promise<string> {
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

    await cp(sources.xcframework, frameworkDest, { recursive: true });
    await mkdir(appDir, { recursive: true });
    await cp(path.join(sources.appShell, 'main.m'), path.join(appDir, 'main.m'));

    const template = await readFile(path.join(sources.appShell, 'Info.plist.in'), 'utf8');
    const orientations = interfaceOrientations(app.orientation)
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
