/**
 * @file    index.wechat.ts
 * @brief   ESEngine SDK - WeChat MiniGame entry point
 */

import { setPlatform } from './platform';
import { wechatAdapter, initWeChatPlatform } from './platform/wechat';

initWeChatPlatform();
setPlatform(wechatAdapter);

export * from './core';
export * from './webAppFactory';

export {
    wxReadFile,
    wxReadTextFile,
    wxFileExists,
    wxFileExistsSync,
    wxWriteFile,
    wxLoadImage,
    wxGetImagePixels,
    wxLoadImagePixels,
    type ImageLoadResult,
} from './platform/wechat';
