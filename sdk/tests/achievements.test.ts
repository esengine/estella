// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The achievements service.
 *
 * The one that matters is the unknown-id guard. On a store, unlocking an id the
 * backend does not have does nothing and reports nothing — it is a player who
 * finds out, months later, that an achievement never fires. Everything else here
 * is the ordinary contract: unlocks are idempotent, they survive a restart, and
 * a platform behind them changes `available` and nothing else.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AchievementsAPI, createLocalAchievements, type AchievementProvider } from '../src/services/achievements';
import { Storage } from '../src/util/storage';
import { log } from '../src/util/logger';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';

// The local provider persists through Storage, which is the platform's — so the
// tests run against a real one rather than a stub, and what they exercise is what
// a game gets.
beforeEach(() => {
    setPlatform(webAdapter);
    Storage.remove('achievements');
});

describe('the unknown-id guard', () => {
    it('refuses an id the project did not declare, loudly', async () => {
        const errors = vi.spyOn(log, 'error').mockImplementation(() => {});
        const api = new AchievementsAPI();
        api.setKnown(['FIRST_BLOOD', 'MARATHON']);

        await api.unlock('FIRST_BLODO');
        expect(api.unlocked('FIRST_BLODO')).toBe(false);
        expect(errors).toHaveBeenCalledTimes(1);
        // The message names what IS declared, because the mistake is nearly always
        // a typo and the fix is right there.
        expect(String(errors.mock.calls[0]?.[1])).toContain('FIRST_BLOOD');
        errors.mockRestore();
    });

    it('checks nothing when the project declared nothing', async () => {
        const api = new AchievementsAPI();
        await api.unlock('ANYTHING');
        expect(api.unlocked('ANYTHING')).toBe(true);
    });

    it('stops checking again when the declaration is cleared', async () => {
        const api = new AchievementsAPI();
        api.setKnown(['A']);
        api.setKnown(null);
        await api.unlock('B');
        expect(api.unlocked('B')).toBe(true);
    });
});

describe('the local provider', () => {
    it('records an unlock and survives a restart', async () => {
        const api = new AchievementsAPI();
        await api.unlock('FIRST_BLOOD');
        expect(api.unlocked('FIRST_BLOOD')).toBe(true);

        // A second API over the same storage is what a restart looks like.
        expect(new AchievementsAPI().unlocked('FIRST_BLOOD')).toBe(true);
    });

    it('is idempotent — re-unlocking is what a game does every frame it re-checks', async () => {
        const api = new AchievementsAPI();
        await api.unlock('A');
        await api.unlock('A');
        expect(Storage.getJSON<{ unlocked: string[] }>('achievements')?.unlocked).toEqual(['A']);
    });

    it('keeps stats and clears everything on reset', async () => {
        const api = new AchievementsAPI();
        api.setStat('kills', 41);
        api.setStat('kills', 42);
        expect(api.getStat('kills')).toBe(42);
        expect(api.getStat('never-set')).toBe(0);

        await api.unlock('A');
        await api.reset();
        expect(api.unlocked('A')).toBe(false);
        expect(api.getStat('kills')).toBe(0);
    });

    it('reports no store behind it — a game draws its own notification', () => {
        expect(new AchievementsAPI().available).toBe(false);
        expect(createLocalAchievements().platformBacked).toBe(false);
    });
});

describe('a platform provider', () => {
    const provider = (): AchievementProvider & { calls: string[] } => {
        const calls: string[] = [];
        const unlocked = new Set<string>();
        return {
            calls,
            platformBacked: true,
            unlock: async (id) => { calls.push(`unlock ${id}`); unlocked.add(id); },
            unlocked: (id) => unlocked.has(id),
            setStat: (n, v) => { calls.push(`stat ${n}=${v}`); },
            getStat: () => 0,
            store: async () => { calls.push('store'); },
            reset: async () => { calls.push('reset'); },
        };
    };

    it('answers instead of the local one, and says a store is there', async () => {
        const api = new AchievementsAPI();
        const p = provider();
        api.setProvider(p);
        expect(api.available).toBe(true);

        await api.unlock('A');
        api.setStat('kills', 7);
        await api.store();
        expect(p.calls).toEqual(['unlock A', 'stat kills=7', 'store']);
        // Nothing reached local storage: the platform owns the state now.
        expect(Storage.getJSON('achievements')).toBeUndefined();
    });

    it('still refuses an undeclared id before the platform ever sees it', async () => {
        const errors = vi.spyOn(log, 'error').mockImplementation(() => {});
        const api = new AchievementsAPI();
        const p = provider();
        api.setProvider(p);
        api.setKnown(['A']);
        await api.unlock('B');
        expect(p.calls).toEqual([]);
        errors.mockRestore();
    });

    it('falls back to the local provider when cleared', async () => {
        const api = new AchievementsAPI();
        api.setProvider(provider());
        api.setProvider(null);
        expect(api.available).toBe(false);
        await api.unlock('A');
        expect(api.unlocked('A')).toBe(true);
    });
});
