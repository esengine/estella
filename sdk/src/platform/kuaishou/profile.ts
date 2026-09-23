// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   Kuaishou as a profile of the mini-game platform family.
 *
 * `ks` answers the family's shape — fs, canvas, subpackages, ads, login and a
 * WeChat-shaped recorder (open.kuaishou.com/miniGameDocs). Two facts differ:
 * a recording is 3–300 s (「录制时间太短（>=3s)」「录制时间太长(<=300s)」), and
 * the recorder publishes through its own `publishVideo`, which the family
 * recorder reads off the host.
 *
 * UNVERIFIED on a device: that `WebAssembly` is the standard global here (the
 * docs name no host loader), and that WebGL2 is available — the docs call it
 * beta, and the engine renders on nothing less.
 *
 * NOT CLAIMED: `pay`. Kuaishou's `ks.requestGamePayment` takes an order signed
 * by the game's server (`sign`, `goods_name`, `third_party_trade_no`), a shape
 * PlatformPaymentRequest does not carry, so purchase reports itself unavailable.
 */
import type { MiniGameGlobal, MiniGameProfile } from '../minigame';

/** Kuaishou's host global, read lazily — importing this outside Kuaishou must not touch it. */
declare const ks: unknown;

export const kuaishouProfile: MiniGameProfile = {
    id: 'kuaishou',
    hostLabel: '快手',

    get global(): MiniGameGlobal {
        return ks as MiniGameGlobal;
    },

    recordingLimits: { minSeconds: 3, maxSeconds: 300 },
};
