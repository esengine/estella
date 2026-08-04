// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    identity.ts
 * @brief   Host sign-in as an engine service — and the half the engine cannot do.
 *
 * A mini-game host signs a player in and hands back a one-time CODE. Turning
 * that code into an identity takes the app secret, and the app secret must
 * never be in anything a player can open, so the exchange belongs to the game's
 * own server. The engine's job ends at the code, and this API is shaped so that
 * is impossible to miss:
 *
 *   `login()` resolves with `{ code }`, not a string and not a user. Destructuring
 *   it makes the call site say the word `code`, which is the one thing that stops
 *   `if (await Identity.login())` from reading like "I am now logged in".
 *
 * There is deliberately NO local provider here, unlike ads and the leaderboard.
 * A pretend ad is still a real pause and a pretend board is still the real
 * renderer, so rehearsing them is worth something. A pretend code is a string no
 * server can exchange — rehearsing with it means rehearsing a request that is
 * going to fail. Off-platform, `available` is false and a game takes whatever
 * path it takes when there is no account.
 */
import { defineResource } from '../ecs/resource';
import { platformCanSignIn, platformCheckSession, platformLogin } from '../platform';

/** What a sign-in yields: the code, and nothing that resembles a session. */
export interface LoginResult {
    /**
     * The host's one-time code. Send it to YOUR server, which exchanges it for
     * a session using the app secret. Short-lived and single-use: cache the
     * session your server returns, never this.
     */
    code: string;
}

export class IdentityAPI {
    /** Whether this platform can sign a player in at all — what a menu reads to
     *  hide its sign-in button rather than offer one that cannot work. */
    get available(): boolean {
        return platformCanSignIn();
    }

    /**
     * Begin a sign-in.
     *
     * Rejects with the host's own words when it fails — this is a network round
     * trip, and "it failed" without a reason is not something a game can act on.
     * Rejects immediately where the platform has no sign-in, so a caller that
     * skipped {@link available} hears about it rather than hanging.
     */
    async login(): Promise<LoginResult> {
        return { code: await platformLogin() };
    }

    /**
     * Whether the host still regards the last sign-in as current.
     *
     * The reason to ask is to SKIP a login: if the session your server holds is
     * still good, exchanging a fresh code buys nothing. False where there is no
     * sign-in at all — there is nothing current about nothing.
     */
    sessionValid(): Promise<boolean> {
        return platformCheckSession();
    }
}

export const Identity = defineResource<IdentityAPI>(null!, 'Identity');
