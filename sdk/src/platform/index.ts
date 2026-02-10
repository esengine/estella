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
} from './types';

// Re-export base functions
export {
    setPlatform,
    getPlatform,
    getPlatformType,
    isPlatformInitialized,
    isWeChat,
    isWeb,
    platformFetch,
    platformReadFile,
    platformReadTextFile,
    platformFileExists,
    platformInstantiateWasm,
    platformCreateCanvas,
    platformCreateImage,
    platformNow,
} from './base';

// Note: webAdapter is exported here for initialization
// wechatAdapter should be imported directly from './wechat' to avoid bundling in web builds

// Re-export web adapter
export { webAdapter } from './web';
