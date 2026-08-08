// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The one ceremony for anything that covers the game.
 *
 * A fullscreen ad and a store overlay are the same event to a player, and they
 * OVERLAP: pressing Shift+Tab during an interstitial is ordinary. The rules that
 * a single caller never needed — ref counting, and restoring the state that was
 * found rather than asserting one — are what this pins.
 */
import { describe, it, expect } from 'vitest';
import { createTakeover, type TakeoverHost } from '../src/services/takeover';

function recordingHost(paused = false): TakeoverHost & { events: string[]; paused: boolean } {
    const h = {
        events: [] as string[],
        paused,
        setPaused(p: boolean) { h.paused = p; h.events.push(p ? 'pause' : 'unpause'); },
        isPaused() { return h.paused; },
        suspendAudio() { h.events.push('audio-off'); },
        resumeAudio() { h.events.push('audio-on'); },
    };
    return h;
}

describe('the takeover ceremony', () => {
    it('pauses and silences for exactly the span it covers', () => {
        const host = recordingHost();
        const takeover = createTakeover(host);
        takeover.begin();
        expect(takeover.active).toBe(true);
        takeover.end();
        expect(host.events).toEqual(['pause', 'audio-off', 'audio-on', 'unpause']);
        expect(takeover.active).toBe(false);
    });

    it('leaves a game the developer paused paused', () => {
        // It restores what it found; asserting a state would un-pause a pause
        // menu the moment an ad closed over it.
        const host = recordingHost(true);
        const takeover = createTakeover(host);
        takeover.begin();
        takeover.end();
        expect(host.paused).toBe(true);
        expect(host.events).toEqual(['audio-off', 'audio-on']);
    });

    it('an overlay opening during an ad does not resume the game when it closes', () => {
        // The reason this is ref-counted: the overlay's `end` arrives while the ad
        // is still on screen, and the game must stay covered until the ad ends.
        const host = recordingHost();
        const takeover = createTakeover(host);
        takeover.begin();                       // the ad
        takeover.begin();                       // Shift+Tab over it
        takeover.end();                         // the overlay closes
        expect(host.paused).toBe(true);
        expect(host.events).toEqual(['pause', 'audio-off']);
        takeover.end();                         // the ad ends
        expect(host.paused).toBe(false);
        expect(host.events).toEqual(['pause', 'audio-off', 'audio-on', 'unpause']);
    });

    it('ignores an end nobody began', () => {
        // A store reports that its overlay closed; nothing guarantees it reported
        // that it opened, and an unbalanced end would resume a paused game.
        const host = recordingHost(true);
        const takeover = createTakeover(host);
        takeover.end();
        takeover.end();
        expect(host.events).toEqual([]);
        expect(host.paused).toBe(true);
    });

    it('restores through a rejection, because a covered game must not stay covered', async () => {
        const host = recordingHost();
        const takeover = createTakeover(host);
        await expect(takeover.around(() => Promise.reject(new Error('no fill')))).rejects.toThrow('no fill');
        expect(host.paused).toBe(false);
        expect(takeover.active).toBe(false);
    });
});
