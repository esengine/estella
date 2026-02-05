/**
 * @file    index.wechat.ts
 * @brief   ESEngine SDK - WeChat MiniGame entry point
 */

// Initialize WeChat platform
import { setPlatform } from './platform';
import { wechatAdapter, initWeChatPlatform } from './platform/wechat';

initWeChatPlatform();
setPlatform(wechatAdapter);

// Re-export everything from core
export * from './core';

// Export WeChat-specific utilities
export {
    wxReadFile,
    wxReadTextFile,
    wxFileExists,
    wxFileExistsSync,
    wxWriteFile,
} from './platform/wechat';
