// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for steamChannel.js, which is plain ESM so the CLI runs it unbuilt.

export const STEAM_DIR: string;

/** `appId + 1 + index` — the usual shape of what Valve assigns, never a fact. */
export function defaultDepotId(appId: number, index: number): number;

export function emitSteamBuild(options: {
    /** The export directory, which is also the depot's content root. */
    outDir: string;
    appId: number;
    /** Names the executable a depot maps and Steam launches. */
    appName: string;
    depots: { os: string; depotId: number }[];
    description?: string;
}): Promise<{ scripts: string[]; checklist: string }>;
