// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    achievements.ts
 * @brief   Achievements and stats as an engine service — one API, whichever
 *          store the game is in.
 *
 * A store's achievement service is a NOTIFICATION on top of state the game
 * already owns: "the player has done this". So unlike ads, this always works —
 * without a platform behind it the unlock is recorded locally, which is the same
 * data a game's own achievements screen reads. {@link available} says whether a
 * STORE will also hear about it, which is what a UI reads to decide between
 * letting the platform draw its toast and drawing its own.
 *
 * ★ Unknown ids are the failure this file is shaped around. On a store, unlocking
 * an id the backend does not have does nothing at all and reports nothing — the
 * achievement simply never fires, and it is a player who finds out. So the game's
 * ids are declared (Project Settings → Packaging → Achievements), and an unlock
 * outside that set is an error the moment it happens.
 */
import { defineResource } from '../ecs/resource';
import { Storage } from '../util/storage';
import { log } from '../util/logger';

/**
 * What a platform answers. The same shape as {@link AdProvider} and
 * {@link LeaderboardProvider}: the engine orchestrates, the provider does the
 * platform's half, and the editor installs one to rehearse without a store.
 */
export interface AchievementProvider {
    /** Whether a real store is behind this, rather than a local stand-in. Decides
     *  {@link AchievementsAPI.available}. */
    readonly platformBacked: boolean;
    unlock(id: string): Promise<void>;
    unlocked(id: string): boolean;
    setStat(name: string, value: number): void;
    getStat(name: string): number;
    /** Push everything set since the last call. Stores batch; a local provider
     *  has already persisted and answers immediately. */
    store(): Promise<void>;
    /** Clear every achievement and stat. A development affordance — no shipped
     *  game calls it, and stores treat it as a test-only operation. */
    reset(): Promise<void>;
}

const STORAGE_KEY = 'achievements';

interface LocalState {
    unlocked: string[];
    stats: Record<string, number>;
}

/**
 * The stand-in every platform without a store gets, and what Play rehearses on.
 *
 * It persists — an achievement that forgets itself on restart rehearses nothing —
 * through {@link Storage}, which on desktop is the directory a store's cloud save
 * syncs.
 */
export function createLocalAchievements(): AchievementProvider {
    const read = (): LocalState => {
        const raw = Storage.getJSON<LocalState>(STORAGE_KEY);
        return { unlocked: raw?.unlocked ?? [], stats: raw?.stats ?? {} };
    };
    let state = read();
    const flush = () => Storage.setJSON(STORAGE_KEY, state);

    return {
        platformBacked: false,
        unlock: (id) => {
            if (!state.unlocked.includes(id)) {
                state.unlocked.push(id);
                flush();
            }
            return Promise.resolve();
        },
        unlocked: (id) => state.unlocked.includes(id),
        setStat: (name, value) => { state.stats[name] = value; flush(); },
        getStat: (name) => state.stats[name] ?? 0,
        store: () => Promise.resolve(),
        reset: () => {
            state = { unlocked: [], stats: {} };
            flush();
            return Promise.resolve();
        },
    };
}

export class AchievementsAPI {
    private provider_: AchievementProvider = createLocalAchievements();
    private known_: readonly string[] | null = null;

    /** Whether a STORE is behind this. False still records unlocks — it means the
     *  platform will not draw its own notification, so a game that wants one
     *  should draw it. */
    get available(): boolean {
        return this.provider_.platformBacked;
    }

    /** The ids this game declares, from the project's packaging settings. Absent
     *  ⇒ nothing is checked, which is what an older project gets. */
    setKnown(ids: readonly string[] | null): void {
        this.known_ = ids && ids.length > 0 ? [...ids] : null;
    }

    /** Install (or restore the local default with null) the provider that answers
     *  for this platform. */
    setProvider(provider: AchievementProvider | null): void {
        this.provider_ = provider ?? createLocalAchievements();
    }

    /**
     * Unlock @p id. Idempotent: re-unlocking is what a game does every time it
     * re-checks a condition, and no store treats it as an event.
     *
     * An id outside the declared set is REFUSED, not forwarded — a store would
     * accept it and do nothing.
     */
    async unlock(id: string): Promise<void> {
        if (!this.check_(id)) return;
        await this.provider_.unlock(id);
    }

    /** Whether @p id is unlocked, as the platform currently reports it. */
    unlocked(id: string): boolean {
        return this.provider_.unlocked(id);
    }

    /** Set a stat a store may track (and may unlock an achievement from). */
    setStat(name: string, value: number): void {
        this.provider_.setStat(name, value);
    }

    getStat(name: string): number {
        return this.provider_.getStat(name);
    }

    /** Push what has been set. Cheap to call often; stores batch behind it. */
    store(): Promise<void> {
        return this.provider_.store();
    }

    /** Development only: clear everything. */
    reset(): Promise<void> {
        return this.provider_.reset();
    }

    private check_(id: string): boolean {
        if (!this.known_ || this.known_.includes(id)) return true;
        log.error('achievements', `"${id}" is not one of this project's achievements `
            + `(${this.known_.join(', ')}) — a store would accept it and do nothing.`);
        return false;
    }
}

export const Achievements = defineResource<AchievementsAPI>(null!, 'Achievements');
