// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Steam as a CHANNEL on the desktop target: the depot scripts SteamPipe
 *        takes, and the values only the partner backend can be told.
 *
 * Not a platform (docs/REARCH_STEAM.md §1). Steam defines no runtime, no renderer
 * and no asset format — it defines where a desktop build goes. A second channel
 * (itch, a direct download) would be a sibling of this file, not a fork of the
 * export.
 */

import path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { writeVdf } from './vdf.js';

/** Where the scripts and steamcmd's own output live, inside the export. */
export const STEAM_DIR = 'steam';

/**
 * Where each OS keeps save data: as SDL_GetPrefPath answers it (see
 * native/host/platform/desktop.cpp) and as Auto-Cloud spells the same place.
 *
 * They have to agree or the cloud syncs nothing, and neither can be read off the
 * other, so both are written here.
 */
const CLOUD_ROOTS = {
    macos: { root: 'MacHome', prefix: 'Library/Application Support/Estella' },
    windows: { root: 'WinAppDataRoaming', prefix: 'Estella' },
    linux: { root: 'LinuxHome', prefix: '.local/share/Estella' },
};

/** What Steam launches, per OS, relative to the DEPOT root (which is not the
 *  export root — see depotMapping). */
function launchTarget(os, appName) {
    if (os === 'macos') return `${appName}.app`;
    return os === 'windows' ? `${appName}.exe` : appName;
}

/**
 * What the depot takes from the export directory.
 *
 * Always ANCHORED at the directory the assembler produced, never at the export
 * root — the root also holds the loose cooked content the app already contains,
 * so a `*` there would ship every asset twice and say nothing.
 */
function depotMapping(os, appName) {
    return os === 'macos'
        ? { LocalPath: `${appName}.app/*`, DepotPath: `${appName}.app/`, recursive: '1' }
        : { LocalPath: `${appName}/*`, DepotPath: '.', recursive: '1' };
}

/**
 * The depot id an OS gets when the project has not been told the real ones.
 *
 * Valve ASSIGNS depot ids; appid+1, appid+2 is only the usual shape of what it
 * assigns. So this is a starting point that the checklist tells you to check,
 * never a fact — an upload to a depot that is not yours simply fails.
 *
 * Keyed by OS rather than by position in the build, so installing a second
 * platform's template cannot renumber the first one's depot: a guess that moves
 * under an existing project is worse than a guess.
 */
const DEFAULT_DEPOT_OFFSET = { windows: 1, macos: 2, linux: 3 };

export function defaultDepotId(appId, os) {
    return appId + (DEFAULT_DEPOT_OFFSET[os] ?? 1);
}

/**
 * Write the SteamPipe build scripts and the checklist for @p oses.
 *
 * @param {object} options
 * @param {string} options.outDir    The export directory; also the content root.
 * @param {number} options.appId     The Steam application id.
 * @param {string} options.appName   The app's name, which names its executable.
 * @param {{os: string, depotId: number}[]} options.depots
 * @param {string} [options.description] Build description shown in the backend.
 * @param {string[]} [options.achievements] Ids the game unlocks — each has to
 *   exist in the backend, where it is created by hand.
 * @param {boolean} [options.steamLibrary] Whether the packages carry Steam's
 *   redistributable. Without it the game runs and reaches no store.
 * @returns {Promise<{scripts: string[], checklist: string}>}
 */
export async function emitSteamBuild(options) {
    const { outDir, appId, appName, depots } = options;
    const steamDir = path.join(outDir, STEAM_DIR);
    await mkdir(path.join(steamDir, 'output'), { recursive: true });

    const scripts = [];
    const depotEntries = {};
    for (const { os, depotId } of depots) {
        const file = `depot_${depotId}_${os}.vdf`;
        await writeFile(path.join(steamDir, file), writeVdf('DepotBuildConfig', {
            DepotID: String(depotId),
            ContentRoot: outDir,
            FileMapping: depotMapping(os, appName),
        }));
        scripts.push(path.join(steamDir, file));
        depotEntries[String(depotId)] = file;
    }

    const appFile = path.join(steamDir, `app_build_${appId}.vdf`);
    await writeFile(appFile, writeVdf('AppBuild', {
        AppID: String(appId),
        Desc: options.description || `${appName} — built by Estella`,
        // A first run must not be able to publish. Uploading and going live are
        // two decisions, and only one of them can be undone by uploading again.
        Preview: '1',
        SetLive: '',
        ContentRoot: outDir,
        BuildOutput: path.join(steamDir, 'output'),
        Depots: depotEntries,
    }));
    scripts.push(appFile);

    const checklist = path.join(outDir, 'STEAM.md');
    await writeFile(checklist, checklistFor({ ...options, appFile }));
    return { scripts, checklist };
}

/**
 * The two ways achievements silently do nothing, said before they can happen.
 *
 * An id the backend does not have is accepted and dropped; a package with no
 * redistributable never reaches Steam at all. Neither reports anything, and both
 * end with a player noticing months later.
 */
function achievementSection(ids, steamLibrary) {
    const library = steamLibrary
        ? 'This build carries Steam\'s redistributable, so it can reach the store.'
        : '**This build carries no Steam library**, so nothing here reaches Steam: unlocks are '
        + 'recorded locally and `Achievements.available` is false. Point Project Settings → '
        + 'Packaging → Steamworks SDK at your own SDK download and export again.';
    if (ids.length === 0) {
        return `${library}\n\nThis project declares no achievements (Project Settings → Packaging).`;
    }
    return `${library}

Create each of these under **Achievements → Edit** with the SAME API name. Steam
accepts an unlock of an id it does not have and does nothing with it, so a name
that differs by one character is an achievement no player can ever get.

${ids.map((id) => `- \`${id}\``).join('\n')}`;
}

/**
 * The build's own values, for the settings only the partner backend holds.
 *
 * Generic instructions belong in the docs; what cannot be looked up is what THIS
 * build needs pasted where — the launch string, the depot ids, the cloud path.
 */
function checklistFor({ appId, appName, depots, appFile, achievements = [], steamLibrary = false }) {
    const rows = depots.map(({ os, depotId }) =>
        `| ${os} | \`${depotId}\` | \`${launchTarget(os, appName)}\` |`).join('\n');
    const cloud = depots.map(({ os }) => {
        const c = CLOUD_ROOTS[os];
        return `| ${os} | \`${c.root}\` | \`${c.prefix}/${appName}\` | \`*\` |`;
    }).join('\n');

    return `# Publishing ${appName} on Steam

Everything here lives in the partner backend, which no build can write to. These
are this build's values.

## App and depots

| OS | Depot ID | Launch executable |
|---|---|---|
${rows}

The depot ids above are a guess (\`appid + 1\`, …). Valve ASSIGNS them — check
them against **SteamPipe → Depots** and set \`packaging.platforms.desktop.steam.depots\`
if they differ. An upload to a depot that is not yours fails rather than going
somewhere wrong.

## Achievements

${achievementSection(achievements, steamLibrary)}

## Cloud saves

The game writes its saves where the OS says it should, which is a path Steam
Auto-Cloud can sync with no code in the game. Under **Steam Cloud → Auto-Cloud**:

| OS | Root | Subdirectory | Pattern |
|---|---|---|---|
${cloud}

## Upload

    steamcmd +login <your-account> +run_app_build "${appFile}" +quit

Log in once interactively first (\`steamcmd +login <your-account>\`) so Steam Guard
is satisfied and cached; nothing here stores a password.

The script is written with \`Preview "1"\`, so the first run uploads NOTHING — it
reports what it would do. Remove it to upload for real. \`SetLive\` is deliberately
empty: publishing to a branch is a separate decision, made in the backend.

## Before you ship

- \`steam_appid.txt\` is **not** in the depot, and this export never writes one.
  It exists only to run a build outside Steam; shipping it disables the check
  that the game was launched by Steam.
- The macOS app is signed ad-hoc. Notarize it with your own Developer ID before
  a public release.
`;
}
