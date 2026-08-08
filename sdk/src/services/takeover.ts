// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    takeover.ts
 * @brief   Something covered the game: pause it, silence it, and put back
 *          exactly what was found.
 *
 * A fullscreen ad and a store overlay are the same event as far as the game is
 * concerned — the player is no longer looking at it and no longer able to act.
 * The ceremony was written inside the ads service, which is where it was needed
 * first; the Steam overlay needs the same one, and a second copy would be a
 * second answer to "what happens when a game is covered".
 *
 * ★ Ref-counted, which a single caller never needed: a player can open the Steam
 * overlay DURING an interstitial ad, and the overlay closing must not resume a
 * game the ad is still covering.
 */

/** What a takeover asks of the app. Injected so this stays pure orchestration —
 *  and so a test can drive it without an App. */
export interface TakeoverHost {
    setPaused(paused: boolean): void;
    isPaused(): boolean;
    suspendAudio(): void;
    resumeAudio(): void;
}

export interface Takeover {
    /** Something is now covering the game. */
    begin(): void;
    /** …and is not any more. Unbalanced calls are ignored rather than trusted:
     *  a store tells you the overlay closed, and nothing guarantees it told you
     *  it opened. */
    end(): void;
    /** Whether anything is covering the game right now. */
    readonly active: boolean;
    /** The common case: cover the game for the length of one promise. */
    around<T>(show: () => Promise<T>): Promise<T>;
}

export function createTakeover(host: TakeoverHost): Takeover {
    let depth = 0;
    /** The state to restore. A game the DEVELOPER already paused stays paused
     *  afterwards — this restores what it found, it does not assert a state. */
    let wasPaused = false;

    const takeover: Takeover = {
        begin(): void {
            if (depth++ > 0) return;
            wasPaused = host.isPaused();
            if (!wasPaused) host.setPaused(true);
            host.suspendAudio();
        },
        end(): void {
            if (depth === 0 || --depth > 0) return;
            host.resumeAudio();
            if (!wasPaused) host.setPaused(false);
        },
        get active(): boolean {
            return depth > 0;
        },
        async around<T>(show: () => Promise<T>): Promise<T> {
            takeover.begin();
            try {
                return await show();
            } finally {
                takeover.end();
            }
        },
    };
    return takeover;
}
