// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   The 快游戏联盟 hosts (vivo, OPPO, Xiaomi, Honor) as a profile of the
 *          mini-game family.
 *
 * `qg` is WeChat-shaped for what the family reads. What differs, each measured on
 * vivo's engine (1203) in an emulator:
 *
 * - `windowWidth`/`windowHeight` are physical pixels (2340 beside a pixelRatio of
 *   2.75), so the screen is sized without multiplying again.
 * - `WebAssembly` is exposed by `qg.setWasmTaskCompile(true)` (OPPO documents
 *   it: 「开启 wasm 开关,会全局暴露`WebAssembly`变量」); it is called before the
 *   engine instantiates.
 *
 * The engine binary itself differs too (no SIMD, no BigInt i64 — V8 8.3); that is
 * the export's `quickgame` build, not something a profile can choose.
 *
 * UNVERIFIED: OPPO, Xiaomi and Honor on a device. OPPO grants WebGL2 only to a
 * game that applied for it.
 */
import type { MiniGameGlobal, MiniGameProfile } from '../minigame';
import type { WasmInstantiateResult } from '../types';

declare const qg: unknown;

interface QuickGameGlobal {
    setWasmTaskCompile?(on: boolean): void;
    getFileSystemManager(): { readFileSync(path: string): ArrayBuffer };
}

export const quickgameProfile: MiniGameProfile = {
    id: 'quickgame',
    hostLabel: '快游戏',

    get global(): MiniGameGlobal {
        return qg as MiniGameGlobal;
    },

    windowInPhysicalPixels: true,

    async instantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult> {
        const host = qg as QuickGameGlobal;
        host.setWasmTaskCompile?.(true);
        const bytes = typeof pathOrBuffer === 'string'
            ? host.getFileSystemManager().readFileSync(pathOrBuffer)
            : pathOrBuffer;
        return WebAssembly.instantiate(bytes, imports) as Promise<WasmInstantiateResult>;
    },
};
