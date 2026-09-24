// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   Bilibili as a profile of the mini-game platform family.
 *
 * `bl` is WeChat-shaped (miniapp.bilibili.com/small-game-doc: 「bilibili 小游戏
 * runtime 与小游戏兼容」) and needs no override. Its recorder shares only through
 * a native button, which the engine does not draw, so `canShare` answers false.
 *
 * UNVERIFIED on a device: wasm on iOS (the upload list says 「wasm 仅支持
 * Android」, the config table recommends iOS high-performance mode for it), and
 * the standard `WebAssembly` loader — no page names one.
 *
 * NOT CLAIMED: `pay`. `bl.requestRecharge` takes an order your server creates.
 */
import type { MiniGameGlobal, MiniGameProfile } from '../minigame';

declare const bl: unknown;

export const bilibiliProfile: MiniGameProfile = {
    id: 'bilibili',
    hostLabel: '哔哩哔哩',

    get global(): MiniGameGlobal {
        return bl as MiniGameGlobal;
    },
};
