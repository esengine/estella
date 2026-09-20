// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Douyin MiniGame platform (a profile of the mini-game family).
 *
 * Adapter, polyfills and install are the family's; Douyin adds nothing, which is
 * the point of the family existing.
 */
import { MiniGamePlatformAdapter, installMiniGamePlatform } from '../minigame';
import { douyinProfile } from './profile';

export const douyinAdapter = new MiniGamePlatformAdapter(douyinProfile);

let initialized = false;

/** Initialize the Douyin platform. Call it at the entry point (see index.douyin.ts). */
export function initDouyinPlatform(): void {
    if (initialized) return;
    initialized = true;
    installMiniGamePlatform(douyinProfile, douyinAdapter);
}

export { douyinProfile };
