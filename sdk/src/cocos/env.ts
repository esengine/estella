// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/env.ts
 * @brief   The build-time flags a Cocos script imports from `cc/env`.
 *
 * Scripts guard editor-only and debug-only code with these (`if (EDITOR) ...`, `DEV && console.log(...)`). In the engine's runtime
 * none of the editor ones is true, which is what lets that code fall away. The platform flags say "browser", the closest honest
 * answer for a build that is not a Cocos one; a script that needs to know more asks the engine's own platform API.
 */
export const EDITOR = false;
export const EDITOR_NOT_IN_PREVIEW = false;
export const PREVIEW = false;
export const BUILD = true;
export const TEST = false;
export const DEBUG = false;
export const DEV = false;
export const SERVER_MODE = false;
export const HTML5 = true;
export const NATIVE = false;
export const JSB = false;
export const RUNTIME_BASED = false;
export const MINIGAME = false;
export const WECHAT = false;
export const WECHAT_MINI_PROGRAM = false;
export const BYTEDANCE = false;
export const ALIPAY = false;
export const XIAOMI = false;
export const HUAWEI = false;
export const OPPO = false;
export const VIVO = false;
export const COCOSPLAY = false;
export const ANDROID = false;
export const IOS = false;
export const WINDOWS = false;
export const MAC = false;
export const LINUX = false;
export const OHOS = false;
export const SUPPORT_JIT = true;
export const PHYSICS_BUILTIN = false;
export const PHYSICS_CANNON = false;
export const PHYSICS_AMMO = false;
export const PHYSICS_PHYSX = false;
export const NET_MODE = 0;
