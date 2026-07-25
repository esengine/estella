// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   WeChat MiniGame platform (a profile of the mini-game family).
 *
 * The adapter, the polyfills and the platform install are the family's
 * (../minigame/); this file adds WeChat's one extra — the WXWebAssembly
 * polyfill — and preserves the public `wx*` helper surface.
 */

/// <reference types="minigame-api-typings" />

import { MiniGamePlatformAdapter, installMiniGamePlatform } from '../minigame';
import { polyfillWebAssembly } from './wasm';
import { wechatProfile } from './profile';

// =============================================================================
// Adapter
// =============================================================================

export const wechatAdapter = new MiniGamePlatformAdapter(wechatProfile);

// =============================================================================
// Initialization
// =============================================================================

let initialized = false;

/**
 * Initialize the WeChat platform (polyfills + adapter).
 * Call this at the entry point of your game (see index.wechat.ts).
 */
export function initWeChatPlatform(): void {
    if (initialized) return;
    initialized = true;

    // WeChat routes wasm through WXWebAssembly; the family install covers
    // performance/fetch/TextEncoder, which every vendor lacks. The exported
    // adapter instance is the one installed — the fs manager and input bindings
    // it holds must not be split across two.
    polyfillWebAssembly();
    installMiniGamePlatform(wechatProfile, wechatAdapter);
}

// =============================================================================
// Export
// =============================================================================

export { polyfillWebAssembly };
export { wechatProfile };
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
