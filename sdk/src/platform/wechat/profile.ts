// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   WeChat as a profile of the mini-game platform family.
 *
 * Three facts and one override. Everything else — fs, fetch, canvas, image,
 * input, storage, subpackages, audio, video, sockets — is the family's, written
 * once in ../minigame/ against the normalized host global.
 *
 * WeChat's single genuine divergence is WASM: it is instantiated through
 * WXWebAssembly (a package path, not bytes), so the standard family loader does
 * not apply.
 */

/// <reference types="minigame-api-typings" />

import type { MiniGameGlobal, MiniGameProfile } from '../minigame';
import type { WasmInstantiateResult } from '../types';
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
};
