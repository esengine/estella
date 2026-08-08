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

/** What Steam launches, per OS, relative to the depot root. */
function launchTarget(os, appName) {
    if (os === 'macos') return `${appName}.app`;
    return os === 'windows' ? `${appName}.exe` : appName;
}

/** What the depot takes from the export directory. Everything else that is there
 *  — the loose cooked content the app already carries — is excluded by not being
 *  mapped, rather than by a rule someone has to maintain. */
function depotMapping(os, appName) {
    const target = launchTarget(os, appName);
    return os === 'macos'
        ? { LocalPath: `${target}/*`, DepotPath: `${target}/`, recursive: '1' }
        : { LocalPath: '*', DepotPath: '.', recursive: '1' };
}

/**
 * The depot id an OS gets when the project has not been told the real ones.
 *
 * Valve ASSIGNS depot ids; appid+1, appid+2 is only the usual shape of what it
 * assigns. So this is a starting point that the checklist tells you to check,
 * never a fact — an upload to a depot that is not yours simply fails.
 */
export function defaultDepotId(appId, index) {
    return appId + 1 + index;
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
    await writeFile(checklist, checklistFor({ appId, appName, depots, appFile }));
    return { scripts, checklist };
}

/**
 * The build's own values, for the settings only the partner backend holds.
 *
 * Generic instructions belong in the docs; what cannot be looked up is what THIS
 * build needs pasted where — the launch string, the depot ids, the cloud path.
 */
function checklistFor({ appId, appName, depots, appFile }) {
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
