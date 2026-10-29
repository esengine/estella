// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/sys.ts
 * @brief   `sys`: what the machine and platform are.
 *
 * Scripts branch on `sys.platform` and `sys.os` to choose paths, payment flows and sdk calls, so the answers have to be the
 * platform the engine is actually running on: the mini-game hosts report themselves, a browser is told apart by its user agent,
 * and `localStorage` is the platform's storage (a mini-game has no `window.localStorage`).
 *
 * Constants keep Cocos's names and its string values for `OS` and `Language`; the `Platform` numbers are this layer's own, since
 * scripts compare them to the enum's members and never to a literal.
 */
import { getPlatformType, platformGetStorageItem, platformNow, platformRemoveStorageItem, platformSetStorageItem } from '../platform';
import { Rect } from './math';

const OS = Object.freeze({
    UNKNOWN: 'Unknown', IOS: 'iOS', ANDROID: 'Android', WINDOWS: 'Windows', LINUX: 'Linux', OSX: 'OS X', OHOS: 'OHOS', OPENHARMONY: 'OpenHarmony',
});

const Platform = Object.freeze({
    UNKNOWN: 0, EDITOR_PAGE: 1, EDITOR_CORE: 2, MOBILE_BROWSER: 3, DESKTOP_BROWSER: 4, WIN32: 5, MACOS: 6, IOS: 7, ANDROID: 8, OHOS: 9,
    OPENHARMONY: 10, WECHAT_GAME: 11, WECHAT_MINI_PROGRAM: 12, BAIDU_MINI_GAME: 13, XIAOMI_QUICK_GAME: 14, ALIPAY_MINI_GAME: 15,
    BYTEDANCE_MINI_GAME: 16, OPPO_MINI_GAME: 17, VIVO_MINI_GAME: 18, HUAWEI_QUICK_GAME: 19, COCOSPLAY: 20, LINKSURE_MINI_GAME: 21,
    QTT_MINI_GAME: 22, XR_VR_MIRROR: 23, XR_AR_MIRROR: 24, XR_HMD: 25,
});

const Language = Object.freeze({
    ENGLISH: 'en', CHINESE: 'zh', FRENCH: 'fr', ITALIAN: 'it', GERMAN: 'de', SPANISH: 'es', DUTCH: 'du', RUSSIAN: 'ru', KOREAN: 'ko',
    JAPANESE: 'ja', HUNGARIAN: 'hu', PORTUGUESE: 'pt', ARABIC: 'ar', NORWEGIAN: 'no', POLISH: 'pl', TURKISH: 'tr', UKRAINIAN: 'uk',
    ROMANIAN: 'ro', BULGARIAN: 'bg', UNKNOWN: 'unknown',
});

const BrowserType = Object.freeze({
    WECHAT: 'wechat', ANDROID: 'androidbrowser', IE: 'ie', EDGE: 'edge', QQ: 'qqbrowser', MOBILE_QQ: 'mqqbrowser', UC: 'ucbrowser',
    UCBS: 'ucbs', BAIDU_APP: 'baiduboxapp', BAIDU: 'baidubrowser', MAXTHON: 'maxthon', OPERA: 'opera', OUPENG: 'oupeng', MIUI: 'miuibrowser',
    FIREFOX: 'firefox', SAFARI: 'safari', CHROME: 'chrome', LIEBAO: 'liebao', QZONE: 'qzone', SOUGOU: 'sogou', HUAWEI: 'huawei', UNKNOWN: 'unknown',
});

const userAgent = (): string => (typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '');

function detectOS(): string {
    const ua = userAgent();
    if (/iPhone|iPad|iPod/i.test(ua)) return OS.IOS;
    if (/Android/i.test(ua)) return OS.ANDROID;
    if (/OpenHarmony/i.test(ua)) return OS.OPENHARMONY;
    if (/HarmonyOS|OHOS/i.test(ua)) return OS.OHOS;
    if (/Windows/i.test(ua)) return OS.WINDOWS;
    if (/Mac OS X|Macintosh/i.test(ua)) return OS.OSX;
    if (/Linux|X11/i.test(ua)) return OS.LINUX;
    return OS.UNKNOWN;
}

const MINI_GAME: Record<string, number> = {
    wechat: Platform.WECHAT_GAME, douyin: Platform.BYTEDANCE_MINI_GAME, kuaishou: Platform.BYTEDANCE_MINI_GAME, alipay: Platform.ALIPAY_MINI_GAME,
    huawei: Platform.HUAWEI_QUICK_GAME, bilibili: Platform.UNKNOWN, quickgame: Platform.XIAOMI_QUICK_GAME,
};

function detectPlatform(os: string): number {
    const name = getPlatformType();
    if (name && name in MINI_GAME) return MINI_GAME[name]!;
    if (name === 'native') {
        return os === OS.IOS ? Platform.IOS : os === OS.ANDROID ? Platform.ANDROID : os === OS.WINDOWS ? Platform.WIN32
            : os === OS.OSX ? Platform.MACOS : os === OS.OHOS ? Platform.OHOS : Platform.UNKNOWN;
    }
    if (name === 'web') return os === OS.IOS || os === OS.ANDROID ? Platform.MOBILE_BROWSER : Platform.DESKTOP_BROWSER;
    return Platform.UNKNOWN;
}

/** Storage that falls back to memory where the platform has none, as Cocos's does outside a browser. */
const memory = new Map<string, string>();
const localStorage = {
    getItem(key: string): string | null {
        try { const v = platformGetStorageItem(key); if (v !== null) return v; } catch { /* fall through to memory */ }
        return memory.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
        memory.set(key, String(value));
        try { platformSetStorageItem(key, String(value)); } catch { /* memory holds it */ }
    },
    removeItem(key: string): void {
        memory.delete(key);
        try { platformRemoveStorageItem(key); } catch { /* nothing to remove */ }
    },
    clear(): void { for (const key of [...memory.keys()]) localStorage.removeItem(key); },
};

const os = detectOS();
const platform = detectPlatform(os);
const isMobilePlatform = platform === Platform.MOBILE_BROWSER || platform === Platform.IOS || platform === Platform.ANDROID
    || platform === Platform.OHOS || platform === Platform.OPENHARMONY || (platform >= Platform.WECHAT_GAME && platform <= Platform.QTT_MINI_GAME);

export const sys = {
    OS, Platform, Language, BrowserType,
    os,
    platform,
    language: typeof navigator !== 'undefined' && navigator.language ? navigator.language.toLowerCase() : 'en',
    languageCode: typeof navigator !== 'undefined' && navigator.language ? navigator.language.toLowerCase() : 'en',
    isNative: getPlatformType() === 'native',
    isBrowser: getPlatformType() === 'web',
    isMobile: isMobilePlatform,
    isXR: false,
    isLittleEndian: new Uint8Array(new Uint16Array([1]).buffer)[0] === 1,
    browserType: BrowserType.UNKNOWN as string,
    browserVersion: '',
    osVersion: '',
    osMainVersion: 0,
    isOnline: typeof navigator === 'undefined' || navigator.onLine !== false,
    capabilities: { canvas: true, opengl: true, webp: true, imageBitmap: typeof createImageBitmap !== 'undefined', touches: platform !== Platform.DESKTOP_BROWSER, mouse: platform === Platform.DESKTOP_BROWSER, keyboard: platform === Platform.DESKTOP_BROWSER, accelerometer: false },
    localStorage,
    /** The `width`/`height` of the area free of notches and system bars, in canvas units. */
    getSafeAreaRect(): Rect { return new Rect(0, 0, 0, 0); },
    now(): number { return platformNow(); },
    openURL(url: string): void {
        if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(url);
    },
    dumpRoot(): void { /* the root is the engine's; nothing to dump */ },
    garbageCollect(): void { /* the host's */ },
    restartVM(): void { /* the host's */ },
    getNetworkType(): number { return 0; },
    getBatteryLevel(): number { return 1; },
};
