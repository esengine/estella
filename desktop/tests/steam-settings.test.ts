// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Steam packaging settings, and the merge that keeps them.
 *
 * `steam` is the one nested object in packaging, and setPlatformPackaging merges
 * exactly one level — so patching `{ steam: { appId } }` through it would drop
 * the depot ids the project had. That is the whole reason these setters exist.
 */
import { describe, it, expect } from 'vitest';
import type { SteamPackaging } from '@/project/format';

/** The merge, as the store performs it, over a plain object. */
function mergeSteam(prev: SteamPackaging | undefined, patch: Partial<SteamPackaging>): SteamPackaging | undefined {
    const steam = { ...prev, ...patch };
    for (const key of Object.keys(steam) as (keyof SteamPackaging)[]) {
        if (steam[key] === undefined) delete steam[key];
    }
    return Object.keys(steam).length > 0 ? steam : undefined;
}

function setDepot(prev: SteamPackaging | undefined, os: 'macos' | 'windows', id: number | undefined) {
    const depots = { ...prev?.depots };
    if (id === undefined) delete depots[os]; else depots[os] = id;
    return mergeSteam(prev, { depots: Object.keys(depots).length > 0 ? depots : undefined });
}

describe('the Steam packaging settings', () => {
    it('setting the App ID keeps depot ids the project already had', () => {
        const prev: SteamPackaging = { appId: 480, depots: { macos: 90210 } };
        expect(mergeSteam(prev, { appId: 500 })).toEqual({ appId: 500, depots: { macos: 90210 } });
    });

    it('setting one depot keeps the others and the App ID', () => {
        const prev: SteamPackaging = { appId: 480, depots: { macos: 1 } };
        expect(setDepot(prev, 'windows', 2)).toEqual({ appId: 480, depots: { macos: 1, windows: 2 } });
    });

    it('clearing the last value leaves nothing rather than an empty husk', () => {
        expect(mergeSteam({ appId: 480 }, { appId: undefined })).toBeUndefined();
        expect(setDepot({ depots: { macos: 1 } }, 'macos', undefined)).toBeUndefined();
    });

    it('keeps the SDK path across an App ID change, and drops a blank one', () => {
        // The SDK is where the redistributable comes from; losing it on an
        // unrelated edit turns achievements off with nothing said.
        const prev: SteamPackaging = { appId: 480, sdkPath: '/opt/steamworks_sdk' };
        expect(mergeSteam(prev, { appId: 500 })?.sdkPath).toBe('/opt/steamworks_sdk');
        expect(mergeSteam(prev, { sdkPath: undefined })).toEqual({ appId: 480 });
    });

    it('a zero App ID is absence, not a game id', () => {
        // The settings row maps 0 to undefined; a build with appId 0 would write
        // scripts naming an app that is not anyone's.
        expect(mergeSteam(undefined, { appId: undefined })).toBeUndefined();
    });
});
