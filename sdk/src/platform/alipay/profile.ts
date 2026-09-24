// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   Alipay as a profile of the mini-game family.
 *
 * `my` has the family's shape under other names (opendocs.alipay.com/mini-game),
 * so the profile hands the family a view of it in WeChat's words:
 * `createRewardedAd` for a rewarded unit, `getAuthCode` for sign-in (its
 * `authCode` is the one-time code), and share through a card the host reads off
 * the `my.onShareAppMessage` PROPERTY when `my.showSharePanel()` opens.
 * WebAssembly is `MYWebAssembly`, which takes an absolute package path.
 *
 * UNVERIFIED on a device: all of it. iOS runs MYWebAssembly only in
 * high-performance mode (「暂不支持 iOS 普通模式」), which the export turns on.
 *
 * NOT CLAIMED: `pay` — `my.requestGamePayment` sells on Android and Harmony only,
 * keyed by a `customId` the engine's request does not carry.
 */
import type { MiniGameGlobal, MiniGameProfile } from '../minigame';
import type { MiniGameShareOptions } from '../minigame/api';
import type { WasmInstantiateResult } from '../types';

declare const my: Record<string, unknown>;
declare const MYWebAssembly: { instantiate(path: string, imports: WebAssembly.Imports): Promise<WasmInstantiateResult> } | undefined;

type Card = MiniGameShareOptions & { desc?: string };
type Callbacks = { success?: (res: { code: string }) => void; fail?: (err: unknown) => void };

/** Each renamed call and the host call it stands for. */
const RENAMED_FROM = {
    createRewardedVideoAd: 'createRewardedAd',
    login: 'getAuthCode',
    onShareAppMessage: 'showSharePanel',
    shareAppMessage: 'showSharePanel',
} as const;

let passiveCard: (() => Card) | null = null;
let activeCard: Card | null = null;

function answerShare(): void {
    my.onShareAppMessage = () => activeCard ?? passiveCard?.() ?? {};
}

/** `my` in the family's words; anything not renamed is `my`'s own, bound to it. */
function view(): MiniGameGlobal {
    const renamed: Record<string, unknown> = {
        createRewardedVideoAd: (opts: { adUnitId: string }) => (my.createRewardedAd as (o: unknown) => unknown)(opts),
        login: (opts: Callbacks) => (my.getAuthCode as (o: unknown) => void)({
            scopes: ['auth_base'],
            success: (res: { authCode?: string }) => opts.success?.({ code: res.authCode ?? '' }),
            fail: opts.fail,
        }),
        onShareAppMessage: (provide: () => Card) => { passiveCard = provide; answerShare(); },
        shareAppMessage: (card: Card) => {
            activeCard = card;
            answerShare();
            (my.showSharePanel as (o: unknown) => void)({ complete: () => { activeCard = null; answerShare(); } });
        },
    };
    return new Proxy(my, {
        get(target, key) {
            if (typeof key === 'string' && key in RENAMED_FROM) {
                // Absent where the host lacks the call it stands for, as the family probes.
                return typeof target[RENAMED_FROM[key as keyof typeof RENAMED_FROM]] === 'function' ? renamed[key] : undefined;
            }
            const v = target[key as string];
            return typeof v === 'function' ? v.bind(target) : v;
        },
    }) as unknown as MiniGameGlobal;
}

let cached: MiniGameGlobal | null = null;

export const alipayProfile: MiniGameProfile = {
    id: 'alipay',
    hostLabel: '支付宝',

    get global(): MiniGameGlobal {
        return (cached ??= view());
    },

    async instantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult> {
        if (typeof pathOrBuffer !== 'string') throw new Error('MYWebAssembly takes a package path, not bytes');
        if (typeof MYWebAssembly === 'undefined') {
            throw new Error('MYWebAssembly is not available: it needs Alipay 10.7.6, and on iOS the high-performance mode');
        }
        const res = await MYWebAssembly.instantiate(pathOrBuffer.startsWith('/') ? pathOrBuffer : `/${pathOrBuffer}`, imports);
        return { instance: res.instance, module: res.module };
    },
};
