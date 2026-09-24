// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Huawei quick-game platform (a profile of the mini-game family).
 *
 * Adapter, polyfills and install are the family's; Huawei adds nothing, which is
 * the point of the family existing.
 */
import { MiniGamePlatformAdapter, installMiniGamePlatform } from '../minigame';
import { huaweiProfile } from './profile';

export const huaweiAdapter = new MiniGamePlatformAdapter(huaweiProfile);

let initialized = false;

/** Initialize the Huawei quick-game platform. */
export function initHuaweiPlatform(): void {
    if (initialized) return;
    initialized = true;
    installMiniGamePlatform(huaweiProfile, huaweiAdapter);
}

export { huaweiProfile };
