// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Alipay MiniGame platform (a profile of the mini-game family).
 *
 * Adapter, polyfills and install are the family's; Alipay adds only its profile, which is
 * the point of the family existing.
 */
import { MiniGamePlatformAdapter, installMiniGamePlatform } from '../minigame';
import { alipayProfile } from './profile';

export const alipayAdapter = new MiniGamePlatformAdapter(alipayProfile);

let initialized = false;

/** Initialize the Alipay platform. */
export function initAlipayPlatform(): void {
    if (initialized) return;
    initialized = true;
    installMiniGamePlatform(alipayProfile, alipayAdapter);
}

export { alipayProfile };
