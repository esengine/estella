// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wechatRuntime.ts
 * @brief   WeChat's binding of the mini-game family runtime.
 *
 *          The boot sequence lives in ./miniGameRuntime.ts and is vendor-neutral.
 *          All WeChat adds is the wasm name its own build target stages, for a
 *          caller that did not pass one (the exporter always does — it is the
 *          only party that knows which glue it shipped).
 */

import { initMiniGameRuntime, type MiniGameRuntimeConfig } from './miniGameRuntime';

/** The wasm emitted by `build -t wechat` (esengine.wxgame.js's binary twin). */
const WECHAT_ENGINE_WASM = 'wasm/esengine.wxgame.wasm';

export interface WeChatRuntimeConfig extends Omit<MiniGameRuntimeConfig, 'engineWasmPath'> {
    /** Package-relative path of the engine wasm binary; defaults to the
     *  canonical `-t wechat` layout. */
    engineWasmPath?: string;
}

export function initWeChatRuntime(config: WeChatRuntimeConfig): Promise<void> {
    return initMiniGameRuntime({ ...config, engineWasmPath: config.engineWasmPath ?? WECHAT_ENGINE_WASM });
}
