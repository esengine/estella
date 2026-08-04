// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Platform adapter exports
 */

// Re-export types
export type {
    PlatformAdapter,
    PlatformType,
    PlatformRequestOptions,
    PlatformResponse,
    WasmInstantiateResult,
    ImageLoadResult,
    PlatformCanvas,
    PlatformCanvas2DContext,
    PlatformImage,
    PlatformGlyph,
    PlatformGlyphRequest,
} from './types';

// Re-export base functions
export {
    setPlatform,
    getPlatform,
    getPlatformType,
    isPlatformInitialized,
    isWeChat,
    isMiniGame,
    isWeb,
    isNative,
    platformFetch,
    platformReadFile,
    platformReadTextFile,
    platformFileExists,
    platformLoadImagePixels,
    platformInstantiateWasm,
    platformCreateCanvas,
    platformCreateImage,
    platformHasGlyphRasterizer,
    platformRasterizeGlyph,
    platformCreateTextEditor,
    platformNow,
    platformUnbindInputEvents,
    platformCreateAudioBackend,
    platformLoadSubpackage,
    platformReadCacheFile,
    platformWriteCacheFile,
    platformOnMemoryWarning,
    platformOnAppShow,
    platformOnAppHide,
    platformGetStorageItem,
    platformSetStorageItem,
    platformDevicePixelRatio,
    platformLanguage,
    platformCanCreateAds,
    platformCreateRewardedAd,
    platformCreateInterstitialAd,
    platformCanShare,
    platformShare,
    platformOnShareRequest,
    platformCanSignIn,
    platformCanPay,
    platformRequestPayment,
    platformLogin,
    platformCheckSession,
    platformCanOpenData,
    platformOpenDataPostMessage,
    platformOpenDataCanvas,
    platformSetCloudKeyValues,
} from './base';

// Note: webAdapter is exported here for initialization
// wechatAdapter should be imported directly from './wechat' to avoid bundling in web builds

// Re-export web adapter
export { webAdapter } from './web';
