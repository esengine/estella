// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   Douyin as a profile of the mini-game platform family.
 *
 * Three facts and no override: fs, fetch, canvas, image, input, storage,
 * subpackages, audio, video and sockets are the family's, written once in
 * ../minigame/ against the normalized host global, and `tt` answers the same
 * shape `wx` does.
 *
 * One override: wasm. Douyin's own loader is TTWebAssembly, which takes a
 * package path (「必须为包内 wasm 文件路径」) and, from base library 3.7.0.0,
 * a brotli `.wasm.br` one — the only way a compressed engine loads
 * (developer.open-douyin.com, mini-game/develop/framework/basic-function/web-assembly).
 * An older host has no TTWebAssembly and keeps the family loader.
 *
 * NOT CLAIMED: `pay`. The family's payment is WeChat's `requestMidasPayment`
 * with WeChat's rules, and Douyin's call is its own. There is no source in this
 * checkout for its name or its fields, and a payment path invented from a guess
 * charges a player through a call that does not exist. So purchase reports
 * itself unavailable here — the profile now has the slot to fill once a vendor
 * doc or a device answers.
 */
import type { MiniGameGlobal, MiniGameProfile } from '../minigame';
import type { WasmInstantiateResult } from '../types';

/** Douyin's host global. Ambient at runtime and absent while bundling, so it is
 *  read lazily — importing this module outside Douyin must not touch it. */
declare const tt: unknown;

interface TTWebAssemblyApi {
    instantiate(path: string, imports: WebAssembly.Imports): Promise<{ instance: WebAssembly.Instance; module: WebAssembly.Module }>;
}

/** TTWebAssembly, where this host has it (base library 3.7.0.0). Read off the global so bundling and tests never touch it. */
function ttWebAssembly(): TTWebAssemblyApi | undefined {
    return (globalThis as { TTWebAssembly?: TTWebAssemblyApi }).TTWebAssembly;
}

export const douyinProfile: MiniGameProfile = {
    id: 'douyin',
    hostLabel: '抖音',

    get global(): MiniGameGlobal {
        return tt as MiniGameGlobal;
    },

    instantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult> | undefined {
        const loader = ttWebAssembly();
        if (typeof pathOrBuffer !== 'string') return undefined;
        if (!loader) {
            if (pathOrBuffer.endsWith('.br')) {
                return Promise.reject(new Error(`${pathOrBuffer} is brotli-compressed, and only TTWebAssembly loads that: it needs Douyin base library 3.7.0.0`));
            }
            return undefined;
        }
        const path = pathOrBuffer.startsWith('/') ? pathOrBuffer.slice(1) : pathOrBuffer;
        return loader.instantiate(path, imports).then(
            (res) => ({ instance: res.instance, module: res.module }),
            (err: unknown) => { throw new Error(`TTWebAssembly.instantiate failed for "${path}": ${err instanceof Error ? err.message : String(err)}`); },
        );
    },
};
