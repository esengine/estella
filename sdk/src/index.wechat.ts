// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.wechat.ts
 * @brief   ESEngine SDK - WeChat MiniGame entry point
 */

import { setPlatform } from './platform';
import { wechatAdapter, initWeChatPlatform } from './platform/wechat';
import { ensureBuiltinComponentsRegistered } from './component';

initWeChatPlatform();
setPlatform(wechatAdapter);

// Register every engine component (COMPONENT_META) so scenes never silently drop
// a component that exists in the engine but lacks a typed const.
ensureBuiltinComponentsRegistered();

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

export {
    initWeChatRuntime,
    type WeChatRuntimeConfig,
} from './wechatRuntime';
