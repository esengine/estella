// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   WeChat MiniGame platform adapter (a profile of the mini-game family).
 *
 * The adapter is the shared family implementation (../minigame/adapter.ts) bound
 * to the WeChat profile (./profile.ts). This file only wires it up + installs
 * the WeChat boot polyfills, and preserves the public `wx*` helper surface.
 */

/// <reference types="minigame-api-typings" />

import type { MiniGameGlobal } from '../minigame';
import { MiniGamePlatformAdapter, polyfillFetch, polyfillPerformance, polyfillTextEncoder } from '../minigame';
import { polyfillWebAssembly } from './wasm';
import { wechatProfile } from './profile';
import { log } from '../../logger';

// =============================================================================
// Adapter
// =============================================================================

export const wechatAdapter = new MiniGamePlatformAdapter(wechatProfile);

// =============================================================================
// Initialization
// =============================================================================

let initialized = false;

/**
 * Initialize WeChat platform polyfills.
 * Call this at the entry point of your game (see index.wechat.ts).
 */
export function initWeChatPlatform(): void {
    if (initialized) return;
    initialized = true;

    polyfillPerformance();
    polyfillFetch(wx as unknown as MiniGameGlobal);
    polyfillWebAssembly();
    polyfillTextEncoder();

    log.info('wechat', 'WeChat platform initialized');
}

// =============================================================================
// Export
// =============================================================================

export { polyfillWebAssembly };
export {
    wxReadFile,
    wxReadTextFile,
    wxReadFileSync,
    wxReadTextFileSync,
    wxFileExists,
    wxFileExistsSync,
    wxWriteFile,
} from './fs';
export { wxLoadImage, wxGetImagePixels, wxLoadImagePixels, type ImageLoadResult } from './image';
