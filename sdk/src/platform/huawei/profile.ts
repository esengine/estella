// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   Huawei's quick games as a profile of the mini-game family.
 *
 * Huawei is not in the 快游戏联盟, but its `qg` reads as the family does: the
 * window in logical pixels (「"pixelRatio":3,"screenWidth":360」), a global
 * `WebAssembly` (the IDE's own runtime shim wraps it), and a `require` that gives
 * a file no CommonJS wrapper, which the export's entry handles.
 *
 * UNVERIFIED on a device: all of it. Huawei's loader asks Huawei's servers about
 * a package before it runs one, so nothing has run without a registered app.
 *
 * NOT CLAIMED: sign-in and purchase — `qg.gameLoginWithReal` and
 * `qg.createPurchaseIntent` go through HMS Core with shapes of their own.
 */
import type { MiniGameGlobal, MiniGameProfile } from '../minigame';

declare const qg: unknown;

export const huaweiProfile: MiniGameProfile = {
    id: 'huawei',
    hostLabel: '华为快游戏',

    get global(): MiniGameGlobal {
        return qg as MiniGameGlobal;
    },
};
