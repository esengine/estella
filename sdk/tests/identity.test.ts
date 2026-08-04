// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Host sign-in, and the half the engine deliberately does not do.
 *
 * The code is not a session and the engine cannot make it one — the exchange
 * needs the app secret, which must never reach a client. So what is worth
 * pinning is that failure is loud and specific, that a platform without
 * sign-in says so instead of hanging, and that the result is shaped to be
 * called `code` at the call site.
 */
import { describe, it, expect } from 'vitest';
import { IdentityAPI } from '../src/services/identity';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import { setPlatform } from '../src/platform/base';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';
import type { PlatformAdapter } from '../src/platform/types';

function miniGame(patch: Partial<MiniGameGlobal>): IdentityAPI {
    const profile: MiniGameProfile = {
        id: 'wechat',
        hostLabel: 'Test',
        global: {
            getSystemInfoSync: () => ({ pixelRatio: 1, screenWidth: 1, screenHeight: 1, platform: 'devtools', language: 'zh_CN' }),
            ...patch,
        } as unknown as MiniGameGlobal,
    };
    setPlatform(new MiniGamePlatformAdapter(profile));
    return new IdentityAPI();
}

/** A platform with no mini-game host behind it at all — web, native, tests. */
function bare(): IdentityAPI {
    setPlatform({ name: 'web', devicePixelRatio: () => 1 } as unknown as PlatformAdapter);
    return new IdentityAPI();
}

describe('available', () => {
    it('is true on a host that can sign in', () => {
        expect(miniGame({ login: (o) => o.success?.({ code: 'c' }) }).available).toBe(true);
    });

    it('is false on a mini-game host without the call', () => {
        expect(miniGame({}).available).toBe(false);
    });

    it('is false off-platform', () => {
        expect(bare().available).toBe(false);
    });
});

describe('login', () => {
    it('resolves with the code, named as one', async () => {
        const id = miniGame({ login: (o) => o.success?.({ code: 'oc-123' }) });
        const { code } = await id.login();
        expect(code).toBe('oc-123');
    });

    it('rejects with the host\'s own words, because a round trip that failed for an unknown reason is unactionable', async () => {
        const id = miniGame({ login: (o) => o.fail?.({ errMsg: 'login:fail no network' }) });
        await expect(id.login()).rejects.toThrow(/no network/);
    });

    it('treats a success with no code as a failure — nobody was signed in', async () => {
        const id = miniGame({ login: (o) => (o.success as (r: { code: string }) => void)?.({} as { code: string }) });
        await expect(id.login()).rejects.toThrow(/no code/);
    });

    it('rejects rather than hanging where there is no sign-in', async () => {
        // A caller that skipped `available` has to hear about it: a promise that
        // never settles is a game stuck on its own loading screen.
        await expect(bare().login()).rejects.toThrow(/no sign-in/);
        await expect(miniGame({}).login()).rejects.toThrow(/no sign-in/);
    });
});

describe('sessionValid', () => {
    // The hosts answer by WHICH callback they call, not with a value — this is
    // the layer that turns that into a boolean.
    it('is true when the host calls success', async () => {
        const id = miniGame({ checkSession: (o) => o.success?.() });
        await expect(id.sessionValid()).resolves.toBe(true);
    });

    it('is false when the host calls fail', async () => {
        const id = miniGame({ checkSession: (o) => o.fail?.({}) });
        await expect(id.sessionValid()).resolves.toBe(false);
    });

    it('is false where there is no session to be current', async () => {
        await expect(miniGame({}).sessionValid()).resolves.toBe(false);
        await expect(bare().sessionValid()).resolves.toBe(false);
    });
});
