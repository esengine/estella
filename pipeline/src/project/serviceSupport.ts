// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which engine services a packaging target can actually provide.
 *
 *        `Ads`, `Identity`, `Achievements` and in-game purchase all answer
 *        `available` at RUNTIME, by asking the installed adapter — and that is
 *        the right answer for a game, which can hide a button. It is no answer
 *        at all for the person choosing a target in the build dialog, because
 *        there is no host to ask yet. A Douyin build that sells nothing is a
 *        fact worth hearing before the store page is written, not after the
 *        purchase call rejects on a device.
 *
 *        So this is the vocabulary of `sizeBudget.ts` one shelf over: what a
 *        target can do, WHY we say so, quoted from whoever said it, all three
 *        travelling together. Nothing here reads the filesystem, a host global
 *        or React — the build dialog renders it, and `service-support.test.ts`
 *        holds it against the adapters that will actually be installed.
 *
 *        Deliberately NOT here: a runtime probe. This file is the pre-build
 *        answer and is allowed to be less precise than the device; it is never
 *        allowed to be more confident.
 */
import type { ExportPlatform } from './platforms';

/**
 * The services a game asks a platform for. Each is one optional method group on
 * `PlatformAdapter` (sdk/src/platform/types.ts) — the list is what an adapter
 * can decline to implement, not everything the engine offers.
 */
export const GAME_SERVICES = ['ads', 'share', 'signIn', 'purchase', 'achievements'] as const;
export type GameService = (typeof GAME_SERVICES)[number];

/**
 * How sure we are, before a build exists.
 *
 * `unknown` is a real answer and the commonest honest one: the engine wires the
 * call and the HOST decides. Saying `yes` there would be us promising on
 * someone else's behalf.
 */
export type ServiceSupport = 'yes' | 'no' | 'unknown';

/** One service on one target. */
export interface ServiceStatus {
    readonly service: GameService;
    readonly support: ServiceSupport;
    /**
     * Why — quoted verbatim where the source is the platform's own words, under
     * the same rule a size budget's note follows: a developer should be able to
     * check us against the vendor's current docs rather than trust us.
     */
    readonly note: string;
}

/**
 * The engine's achievements service is backed by a platform on Steam and
 * nowhere else; everywhere else it keeps its local provider, so a game's own
 * achievements screen works and the platform's does not exist.
 */
const ACHIEVEMENTS_LOCAL_ONLY =
    'Only Steam backs achievements with a platform. Elsewhere the service keeps its local provider:'
    + ' unlocks are recorded and readable, and there is no system notification.';

/** What a browser, an ad frame and an app of our own have in common: nobody up
 *  there sells, shares or signs anyone in on the game's behalf. */
const NO_HOST_ABOVE =
    'This platform\'s adapter declares no such method — there is no host above the game offering it.'
    + ' A game can still install a provider of its own.';

/** Every service unsupported, for a target whose adapter declares none. */
function noHostServices(): readonly ServiceStatus[] {
    return GAME_SERVICES.map((service) => ({
        service,
        support: 'no' as const,
        note: service === 'achievements' ? ACHIEVEMENTS_LOCAL_ONLY : NO_HOST_ABOVE,
    }));
}

/**
 * WeChat's API list is not guessed: `minigame-api-typings` is Tencent's own
 * published declaration and a dependency of this checkout, so every member the
 * family adapter forwards to can be shown to exist.
 */
const WECHAT_SERVICES: readonly ServiceStatus[] = [
    {
        service: 'ads',
        support: 'yes',
        note: 'wx.createRewardedVideoAd / wx.createInterstitialAd — declared by minigame-api-typings,'
            + ' WeChat\'s own published API declaration.'
            + ' An ad unit id from the mini-game console is still needed before a unit fills.',
    },
    {
        service: 'share',
        support: 'yes',
        note: 'wx.shareAppMessage / wx.onShareAppMessage — declared by minigame-api-typings.'
            + ' No host reports whether a share went through, so neither does the engine.',
    },
    {
        service: 'signIn',
        support: 'yes',
        note: 'wx.login — declared by minigame-api-typings. It yields a code your own server exchanges;'
            + ' the engine hands the code over and never talks to WeChat\'s server itself.',
    },
    {
        service: 'purchase',
        support: 'unknown',
        note: 'wx.requestMidasPayment 「发起购买游戏币支付请求」(需要基础库 2.19.2) —'
            + ' https://developers.weixin.qq.com/minigame/dev/api/midas-payment/wx.requestMidasPayment.html'
            + ' Two things no build can see decide it: the account must have 虚拟支付 enabled, and WeChat'
            + ' permits the call on Android only — it is refused on an iPhone.',
    },
    { service: 'achievements', support: 'no', note: ACHIEVEMENTS_LOCAL_ONLY },
];

/**
 * Douyin runs through the same family adapter, so the engine calls
 * `tt.createRewardedVideoAd` and friends exactly as it calls `wx`'s. What is
 * missing is a SOURCE: no published declaration for `tt` exists in this
 * checkout the way one does for `wx`.
 */
const DOUYIN_SERVICES: readonly ServiceStatus[] = [
    {
        service: 'ads',
        support: 'unknown',
        note: 'The engine forwards to tt.createRewardedVideoAd / tt.createInterstitialAd. No published'
            + ' declaration for tt is available here, so whether this host has them is the host\'s answer.',
    },
    {
        service: 'share',
        support: 'unknown',
        note: 'The engine forwards to tt.shareAppMessage / tt.onShareAppMessage, unverified on a device.',
    },
    {
        service: 'signIn',
        support: 'unknown',
        note: 'The engine forwards to tt.login, unverified on a device.',
    },
    {
        service: 'purchase',
        support: 'no',
        note: 'The engine sells nothing on Douyin. Payment in the mini-game family is WeChat\'s'
            + ' requestMidasPayment with WeChat\'s rules; Douyin\'s call is its own, and there is no source'
            + ' here for its name or its fields — so the profile leaves the slot empty rather than charge a'
            + ' player through a call invented from a guess.',
    },
    { service: 'achievements', support: 'no', note: ACHIEVEMENTS_LOCAL_ONLY },
];

/** From open.kuaishou.com/miniGameDocs; nothing here has run on a device yet. */
const KUAISHOU_SERVICES: readonly ServiceStatus[] = [
    {
        service: 'ads',
        support: 'unknown',
        note: 'The engine forwards to ks.createRewardedVideoAd / ks.createInterstitialAd, which Kuaishou documents'
            + ' (onClose carries isEnded, as WeChat\'s does); unverified on a device.',
    },
    {
        service: 'share',
        support: 'unknown',
        note: 'ks.shareAppMessage is documented as an active share only, keyed by a templateId from the console;'
            + ' there is no passive share menu to answer, so setShareCard reaches nothing here.',
    },
    {
        service: 'signIn',
        support: 'unknown',
        note: 'The engine forwards to ks.login, which yields a code your server exchanges; unverified on a device.',
    },
    {
        service: 'purchase',
        support: 'no',
        note: 'Kuaishou sells through ks.requestGamePayment, whose order is signed by the game\'s server'
            + ' (sign, goods_name, third_party_trade_no) and needs an ISBN to enable — a shape the engine\'s'
            + ' purchase request does not carry, so the profile leaves the slot empty.',
    },
    { service: 'achievements', support: 'no', note: ACHIEVEMENTS_LOCAL_ONLY },
];

const DESKTOP_SERVICES: readonly ServiceStatus[] = noHostServices().map((s) => (
    s.service === 'achievements'
        ? {
            service: 'achievements' as const,
            support: 'unknown' as const,
            note: 'Steam backs them once the project sets a Steam app id AND the player has the client'
                + ' running — neither of which a build can see. Without both, the local provider is used.',
        }
        : s
));

/**
 * What a built-in target can provide, before any project profile has its say.
 *
 * A project-authored platform gets an empty list rather than a guess: its
 * profile decides which adapter is installed, and inventing capabilities for
 * someone else's vendor is exactly the confidence this file must not have.
 */
export function builtinServiceSupport(platform: ExportPlatform): readonly ServiceStatus[] {
    if (platform === 'wechat') return WECHAT_SERVICES;
    if (platform === 'douyin') return DOUYIN_SERVICES;
    if (platform === 'kuaishou') return KUAISHOU_SERVICES;
    if (platform === 'desktop') return DESKTOP_SERVICES;
    if (platform === 'web' || platform === 'playable' || platform === 'android' || platform === 'ios') {
        return noHostServices();
    }
    return [];
}
