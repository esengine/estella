// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   WeChat as a profile of the mini-game platform family.
 *
 * Everything WeChat shares with other vendors lives in the family adapter
 * (../minigame/adapter.ts); this file is only the DATA + the genuine WeChat
 * divergences: the WXWebAssembly loader and the WeChat audio/video/socket
 * backends.
 */

/// <reference types="minigame-api-typings" />

import type { MiniGameGlobal, MiniGameProfile } from '../minigame';
import type { PlatformAudioBackend } from '../../audio/PlatformAudioBackend';
import type { PlatformVideoBackend, VideoBackendContext } from '../../video/PlatformVideoBackend';
import type { PlatformSocket, PlatformSocketOptions, WasmInstantiateResult } from '../types';
import { WeChatAudioBackend } from '../../audio/WeChatAudioBackend';
import { WeChatSocket } from '../../net/WeChatSocket';
import { WasmVideoBackend } from '../../video/WasmVideoBackend';
import { wxInstantiateWasm } from './wasm';

export const wechatProfile: MiniGameProfile = {
    id: 'wechat',
    hostLabel: 'WeChat',

    // `wx` is an ambient runtime global; read it lazily so importing this module
    // outside a WeChat runtime (bundling/tests) never touches an undefined `wx`.
    get global(): MiniGameGlobal {
        return wx as unknown as MiniGameGlobal;
    },

    instantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult> {
        if (typeof pathOrBuffer !== 'string') {
            throw new Error('WeChat WXWebAssembly requires a file path string, not ArrayBuffer');
        }
        return wxInstantiateWasm(pathOrBuffer, imports);
    },

    createAudioBackend(): PlatformAudioBackend {
        return new WeChatAudioBackend();
    },

    // WeChat gets the engine-owned wasm decoder on every device class. The
    // native wx.createVideoDecoder is deliberately not used: it is absent on the
    // PC client and unreliable on phones (per-device staging, null frames, no
    // playhead), so the deterministic single path is the software decode.
    createVideoBackend(ctx: VideoBackendContext): PlatformVideoBackend {
        return new WasmVideoBackend(ctx);
    },

    createSocket(options: PlatformSocketOptions): PlatformSocket {
        return new WeChatSocket(options);
    },
};
