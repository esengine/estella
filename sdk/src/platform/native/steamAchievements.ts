// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    steamAchievements.ts
 * @brief   Steam behind the achievements service — one provider, not a second API.
 *
 * A game calls `Achievements.unlock('X')` and this forwards it. What changes when
 * Steam is there is `available`, which is what a UI reads to decide between the
 * platform's own notification and drawing its own.
 */
import type { AchievementProvider } from '../../services/achievements';
import type { NativeSteamBridge } from './bridge';

/**
 * Wrap a live Steam client as an {@link AchievementProvider}.
 *
 * `store()` is what actually reaches Steam's servers; unlock and setStat are
 * local to the client until then. The service calls it, so no game has to know.
 */
export function createSteamAchievements(steam: NativeSteamBridge): AchievementProvider {
    return {
        platformBacked: true,
        unlock: (id) => { steam.unlock(id); return Promise.resolve(); },
        unlocked: (id) => steam.unlocked(id),
        setStat: (name, value) => { steam.setStat(name, value); },
        getStat: (name) => steam.getStat(name),
        store: () => { steam.store(); return Promise.resolve(); },
        reset: () => { steam.reset(); return Promise.resolve(); },
    };
}
