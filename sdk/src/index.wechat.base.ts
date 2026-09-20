// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.wechat.base.ts
 * @brief   ESEngine SDK - WeChat MiniGame entry, minus the optional subsystems
 */

import { setPlatform } from './platform';
import { wechatAdapter, initWeChatPlatform } from './platform/wechat';
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from './ecs/component';
import { ensureBuiltinAiRegistrations } from './ai/builtins';

initWeChatPlatform();
setPlatform(wechatAdapter);

// Register every engine component (COMPONENT_META) so scenes never silently drop
// a component that exists in the engine but lacks a typed const.
ensureBuiltinComponentsRegistered();
ensureBuiltinAiRegistrations();
markEngineComponentBaseline();

export * from './core';
export * from './runtime/webAppFactory';

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
} from './runtime/wechatRuntime';

// The host as data: spread it to keep everything but the one thing you replace.
export { wechatProfile } from './platform/wechat';

// A package installs the platform by CALLING this: the call above is a module
// side effect, and a bundler dropped it — a lean-entry WeChat package booted to
// "Platform not initialized". Idempotent.
export { initWeChatPlatform } from './platform/wechat';
