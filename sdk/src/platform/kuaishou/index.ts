// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Kuaishou MiniGame platform (a profile of the mini-game family).
 *
 * Adapter, polyfills and install are the family's; Kuaishou adds nothing, which is
 * the point of the family existing.
 */
import { MiniGamePlatformAdapter, installMiniGamePlatform } from '../minigame';
import { kuaishouProfile } from './profile';

export const kuaishouAdapter = new MiniGamePlatformAdapter(kuaishouProfile);

let initialized = false;

/** Initialize the Kuaishou platform. */
export function initKuaishouPlatform(): void {
    if (initialized) return;
    initialized = true;
    installMiniGamePlatform(kuaishouProfile, kuaishouAdapter);
}

export { kuaishouProfile };
