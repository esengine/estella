// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for steamChannel.js, which is plain ESM so the CLI runs it unbuilt.

export const STEAM_DIR: string;

/** The OSes a Steam depot is written for — the desktop OSes, spelled as the
 *  runtime templates are. */
export type SteamDepotOs = 'windows' | 'macos' | 'linux';

/** `appId + 1` (windows), `+ 2` (macos), `+ 3` (linux) — the usual shape of what
 *  Valve assigns, never a fact. */
export function defaultDepotId(appId: number, os: SteamDepotOs): number;

export function emitSteamBuild(options: {
    /** The export directory, which is also the depot's content root. */
    outDir: string;
    appId: number;
    /** Names the executable a depot maps and Steam launches. */
    appName: string;
    depots: { os: SteamDepotOs; depotId: number }[];
    description?: string;
}): Promise<{ scripts: string[]; checklist: string }>;
