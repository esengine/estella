// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   快游戏联盟 MiniGame platform (a profile of the mini-game family).
 *
 * Adapter, polyfills and install are the family's; the quick-game hosts add nothing, which is
 * the point of the family existing.
 */
import { MiniGamePlatformAdapter, installMiniGamePlatform } from '../minigame';
import { quickgameProfile } from './profile';

export const quickgameAdapter = new MiniGamePlatformAdapter(quickgameProfile);

let initialized = false;

/** Initialize the quick-game platform. */
export function initQuickGamePlatform(): void {
    if (initialized) return;
    initialized = true;
    installMiniGamePlatform(quickgameProfile, quickgameAdapter);
}

export { quickgameProfile };
