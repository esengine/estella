// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Bilibili MiniGame platform (a profile of the mini-game family).
 *
 * Adapter, polyfills and install are the family's; Bilibili adds nothing, which is
 * the point of the family existing.
 */
import { MiniGamePlatformAdapter, installMiniGamePlatform } from '../minigame';
import { bilibiliProfile } from './profile';

export const bilibiliAdapter = new MiniGamePlatformAdapter(bilibiliProfile);

let initialized = false;

/** Initialize the Bilibili platform. */
export function initBilibiliPlatform(): void {
    if (initialized) return;
    initialized = true;
    installMiniGamePlatform(bilibiliProfile, bilibiliAdapter);
}

export { bilibiliProfile };
