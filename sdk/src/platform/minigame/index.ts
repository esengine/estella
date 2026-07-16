// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Mini-game platform family barrel. Vendors (wechat/, douyin/) import
 *          from here to build their profile + adapter.
 */

export type {
    MiniGameGlobal,
    MiniGameProfile,
    MiniGameVendor,
    MiniGameCanvas,
    MiniGameImage,
    MiniGameFileSystemManager,
    MiniGameRequestOptions,
    MiniGameSystemInfo,
    MiniGameTouch,
    MiniGameTouchEvent,
    MiniGameKeyEvent,
    MiniGameStorageInfo,
} from './api';

export { MiniGamePlatformAdapter } from './adapter';
export { polyfillFetch, mgFetch } from './fetch';
export { polyfillPerformance, polyfillTextEncoder } from './polyfills';
export {
    mgReadFile,
    mgReadTextFile,
    mgReadFileSync,
    mgReadTextFileSync,
    mgFileExists,
    mgFileExistsSync,
    mgWriteFile,
    formatReadError,
} from './fs';
export { mgLoadImage, mgGetImagePixels, mgLoadImagePixels } from './image';
