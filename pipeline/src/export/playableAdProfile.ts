// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Per-network playable-ad profile.
 *
 * The export pipeline (exportPlayable.ts) is shared by every ad network: cook →
 * inline assets/scenes/engine → bundle the host → one self-contained index.html.
 * What differs per network is small and it is all DATA plus two emit hooks: the
 * size the network accepts, what goes in `<head>`, and which API the player's
 * click-through calls.
 *
 * Adding a network = one profile, not a branch in the pipeline. The built-ins
 * below are written against the same contract a project's own profile uses
 * (`.esengine/platforms/<id>.mjs` with `kind: 'playable'`), so "the editor
 * supports this network" is never a privileged path.
 */
import type { ScreenOrientation } from './orientationHtml';

export function isPlayableZipFileName(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_]+\.zip$/.test(value)
        && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\.zip$/i.test(value);
}

/** Neutral facts the pipeline computed, handed to a profile's emitters. */
export interface PlayableAdContext {
    title: string;
    orientation: ScreenOrientation;
}

export interface PlayableAdProfile {
    /** Network identity — persisted in `packaging.platforms.playable.network`. */
    readonly id: string;
    /** Shown wherever the network is chosen. */
    readonly label: string;
    /**
     * Bytes the network accepts for the delivered file. Playables are size-capped
     * and every network caps differently, so the export's size warning reads this
     * rather than a constant.
     */
    readonly maxBytes: number;
    /** Optional uncompressed HTML limit in addition to the uploaded archive limit. */
    readonly maxHtmlBytes?: number;
    /** Where {@link maxBytes} comes from, quoted in the warning so a developer can
     *  check it against the network's current docs rather than trusting us. */
    readonly limitNote: string;
    /**
     * What the network actually takes an upload of. `'zip'` also writes
     * `playable.zip` beside the HTML — Google accepts only an archive — and is what
     * the size limit is then measured against, since that is the file being sent.
     * Default `'single-html'`.
     */
    readonly delivery?: 'single-html' | 'zip';
    /** Portable archive filename; defaults to playable.zip. */
    readonly zipFileName?: string;
    /** Exact host SDK scripts allowed by this network’s published integration. */
    readonly allowedExternalScripts?: readonly string[];
    /** Mandatory literal SDK script and its position in the delivered HTML. */
    readonly requiredSdk?: { url: string; placement: 'head' | 'body-before-game' };
    /** Required config.json orientation key; values are 0, 1 or 2. */
    readonly configOrientationField?: string;
    /** Anything else the developer must know before uploading. Reported as a
     *  warning, because an export that looks finished but isn't is worse. */
    readonly deliveryNote?: string;
    /** Markup for `<head>`: an orientation meta tag, the network's own SDK script. */
    emitHead?(ctx: PlayableAdContext): string;
    /** Host SDK markup placed in body before all game scripts. */
    emitBody?(ctx: PlayableAdContext): string;
    /** Additional root files included in a ZIP, such as network config.json. */
    emitZipFiles?(ctx: PlayableAdContext): { name: string; content: string }[];
    /**
     * An inline script installing `globalThis.__ESTELLA_PLAYABLE__`, whose `cta()`
     * calls this network's click-through API. The game side of that seam is the
     * SDK's `playableCta()`, which every network shares.
     */
    emitBridge?(ctx: PlayableAdContext): string;
}

/**
 * No network named. The page stays exactly what a plain single-file HTML5 build
 * is — no injected markup, no bridge (so `playableCta()` is a no-op) — and the
 * size warning uses the strictest cap we know of, because an unnamed target could
 * be any of them.
 */
export const genericPlayableProfile: PlayableAdProfile = {
    id: 'generic',
    label: 'Generic (single-file HTML5)',
    maxBytes: 5 * 1024 * 1024,
    limitNote: 'no network selected — 5MB, which is what every network we cite accepts',
};

/**
 * Meta (Facebook / Instagram) playable ads, single-file format. Meta forbids any
 * HTTP request — hence nothing in `<head>` — and requires the click-through to
 * call its own function. 5MB is Meta's own "Maximum file size: 5MB" for a playable
 * HTML5 file; the widely repeated 2MB appears nowhere in the spec.
 * @see https://www.facebook.com/business/help/412951382532338
 */
export const metaPlayableProfile: PlayableAdProfile = {
    id: 'meta',
    label: 'Meta (Facebook / Instagram)',
    maxBytes: 5 * 1024 * 1024,
    limitNote: 'Meta caps a playable HTML5 file at 5MB',
    emitBridge: () => 'window.__ESTELLA_PLAYABLE__={cta:function(){'
        + 'if(typeof FbPlayableAd!=="undefined"&&FbPlayableAd.onCTAClick)FbPlayableAd.onCTAClick();'
        + '}};',
};

/**
 * Google App campaigns. Two things are unlike every other network: the store exit
 * goes through Google's own hosted script — which the docs require as a LITERAL
 * `<script>` in `<head>`, not one added by JS — and the upload is a ZIP, which this
 * export does not produce, so it says so rather than looking finished.
 * @see https://support.google.com/google-ads/answer/9981650
 */
export const googlePlayableProfile: PlayableAdProfile = {
    allowedExternalScripts: ['https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js'],
    requiredSdk: { url: 'https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js', placement: 'head' },
    id: 'google',
    label: 'Google Ads (App campaigns)',
    maxBytes: 5 * 1024 * 1024,
    limitNote: 'Google accepts a .ZIP up to 5MB',
    delivery: 'zip',
    // The orientation meta tag is required alongside the exit API.
    emitHead: (ctx) => '<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>\n'
        + `    <meta name="ad.orientation" content="${ctx.orientation}">`,
    emitBridge: () => 'window.__ESTELLA_PLAYABLE__={cta:function(){'
        + 'if(typeof ExitApi!=="undefined"&&ExitApi.exit)ExitApi.exit();'
        + '}};',
};

/**
 * Host-injected MRAID handles store clicks and advert viewability.
 * The runtime waits for readiness and visibility before running gameplay.
 * @see https://docs.unity.com/en-us/grow/acquire/creatives/playable/specifications
 */
const mraidBridge = (): string => `(function(){
var host=window.mraid,listeners=[],active=!host,loaded=!host,subscribed=false;
function publish(value){active=value;listeners.slice().forEach(function(fn){try{fn(value);}catch(error){console.error("[playable] lifecycle listener failed",error);}});}
function viewable(value){publish(loaded&&!!value);}
function ready(){loaded=true;if(typeof host.removeEventListener==="function")host.removeEventListener("ready",ready);publish(typeof host.isViewable==="function"&&host.isViewable());}
function subscribe(){
if(!host||subscribed||typeof host.addEventListener!=="function")return;
subscribed=true;host.addEventListener("viewableChange",viewable);
if(typeof host.getState==="function"&&host.getState()==="loading")host.addEventListener("ready",ready);else ready();
}
function unsubscribe(){
if(!subscribed)return;subscribed=false;
if(typeof host.removeEventListener==="function"){host.removeEventListener("ready",ready);host.removeEventListener("viewableChange",viewable);}
}
window.__ESTELLA_PLAYABLE__={
cta:function(url){
var target=url===undefined?window.clickTag:url,valid=false;
try{var parsed=new URL(target);valid=typeof target==="string"&&!/\\s/.test(target)&&["http:","https:","market:","itms-apps:"].indexOf(parsed.protocol)>=0&&!!parsed.hostname;}catch(error){}
if(!valid){console.warn("[playable] MRAID CTA needs a store URL passed to playableCta(url) or supplied as clickTag.");return;}
if(window.mraid&&typeof window.mraid.open==="function")window.mraid.open(target);
},
onActive:function(fn){subscribe();listeners.push(fn);fn(active);return function(){listeners=listeners.filter(function(item){return item!==fn;});if(!listeners.length)unsubscribe();};}
};
})();`;

export const mraidPlayableProfile: PlayableAdProfile = {
    id: 'mraid',
    label: 'MRAID network (generic)',
    maxBytes: 5 * 1024 * 1024,
    limitNote: 'MRAID networks commonly cap a single-file playable at 5MB — check yours',
    emitBridge: mraidBridge,
};

/** @see https://docs.unity.com/acquire/en-us/manual/playable-ads-specifications */
export const unityPlayableProfile: PlayableAdProfile = {
    id: 'unity',
    label: 'Unity Ads',
    maxBytes: 5 * 1024 * 1024,
    limitNote: 'Unity Ads requires a single inlined index.html under 5MB',
    emitBridge: mraidBridge,
};

/** AppLovin additionally forbids EXTERNAL resources, which a single-file playable
 *  satisfies by construction — every asset here is already inlined.
 *  @see https://support.applovin.com/en/growth/promoting-your-apps/welcome-to-applovin/creative-specs-and-guidelines */
export const applovinPlayableProfile: PlayableAdProfile = {
    id: 'applovin',
    label: 'AppLovin',
    maxBytes: 5 * 1024 * 1024,
    limitNote: 'AppLovin caps a single HTML file at 5MB, with every resource embedded',
    emitBridge: mraidBridge,
};

/** @see https://www.playturbo.com/review/doc */
export const mintegralPlayableProfile: PlayableAdProfile = {
    id: 'mintegral',
    label: 'Mintegral',
    maxBytes: 5 * 1024 * 1024,
    maxHtmlBytes: 5 * 1024 * 1024,
    limitNote: 'Mintegral accepts an embedded HTML playable up to 5MB',
    delivery: 'zip',
    zipFileName: 'index.zip',
    deliveryNote: 'Call playableGameEnd() on win or loss, and playableRetry() when restarting. Mintegral supplies the store, ready and lifecycle hooks.',
    emitBridge: () => `(function(){
var active=typeof window.gameReady!=="function",listeners=[],ready=false;
var oldStart=window.gameStart,oldClose=window.gameClose;
function visibility(value){active=value;listeners.slice().forEach(function(fn){try{fn(value);}catch(error){console.error("[playable] lifecycle listener failed",error);}});}
window.gameStart=function(){visibility(true);if(typeof oldStart==="function")oldStart.apply(this,arguments);};
window.gameClose=function(){visibility(false);if(typeof oldClose==="function")oldClose.apply(this,arguments);};
window.__ESTELLA_PLAYABLE__={
cta:function(){if(typeof window.install==="function")window.install();},
ready:function(){if(ready)return;ready=true;if(typeof window.gameReady==="function")window.gameReady();else visibility(true);},
gameEnd:function(){if(typeof window.gameEnd==="function")window.gameEnd();},
retry:function(){if(typeof window.gameRetry==="function")window.gameRetry();},
onActive:function(fn){listeners.push(fn);fn(active);return function(){listeners=listeners.filter(function(item){return item!==fn;});};}
};
})();`,
};

/** @see https://ads.tiktok.com/resources/help/article/playable-ads?lang=en */
export const tiktokPlayableProfile: PlayableAdProfile = {
    allowedExternalScripts: ['https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js'],
    requiredSdk: { url: 'https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js', placement: 'body-before-game' },
    configOrientationField: 'Playable_orientation',
    id: 'tiktok', label: 'TikTok', maxBytes: 5 * 1024 * 1024 - 1,
    limitNote: 'TikTok requires a ZIP less than 5MB (official September 2026 specification)',
    delivery: 'zip',
    deliveryNote: 'Test the upload in TikTok Ads Manager; store redirects are disabled during preview. Only the mandatory host SDK is external.',
    // The mixed-case TikTok documentation URL returns 404; the compatible Pangle URL is live.
    emitBody: () => '<script src="https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"></script>',
    emitZipFiles: () => [{ name: 'config.json', content: JSON.stringify({ Playable_orientation: 0 }) }],
    emitBridge: () => `(function(){
  window.__ESTELLA_PLAYABLE__={
  cta:function(){if(typeof window.openAppStore==="function")window.openAppStore();},
  onActive:function(fn){function changed(){fn(!document.hidden);}document.addEventListener("visibilitychange",changed);changed();return function(){document.removeEventListener("visibilitychange",changed);};}
  };
  })();`,
};

/** @see https://ads.tiktok.com/resources/help/article/how-to-create-tiktok-pangle-playable-ads */
export const panglePlayableProfile: PlayableAdProfile = {
    ...tiktokPlayableProfile,
    configOrientationField: 'playable_orientation',
    id: 'pangle', label: 'TikTok Ad Network (Pangle, overseas)',
    limitNote: 'TikTok Ad Network requires a ZIP less than 5MB (official September 2026 specification)',
    emitBody: () => '<script src="https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"></script>',
    emitZipFiles: () => [{ name: 'config.json', content: JSON.stringify({ playable_orientation: 0 }) }],
};

/** The networks the editor ships, by id. A network absent here is not unsupported:
 *  a project defines its own with the same contract (`kind: 'playable'`). */
export const BUILTIN_PLAYABLE_PROFILES: readonly PlayableAdProfile[] = [
    genericPlayableProfile,
    metaPlayableProfile,
    googlePlayableProfile,
    mraidPlayableProfile,
    unityPlayableProfile,
    applovinPlayableProfile,
    mintegralPlayableProfile,
    tiktokPlayableProfile,
    panglePlayableProfile,
];

export function builtinPlayableProfile(id: string | undefined): PlayableAdProfile | null {
    return BUILTIN_PLAYABLE_PROFILES.find((p) => p.id === id) ?? null;
}

/** What a profile contributes to the page, resolved once so the assembler stays flat. */
export function playableAdInjection(
    profile: PlayableAdProfile,
    ctx: PlayableAdContext,
): { head: string; body: string; bridge: string } {
    return {
        head: profile.emitHead?.(ctx) ?? '',
        body: profile.emitBody?.(ctx) ?? '',
        bridge: profile.emitBridge?.(ctx) ?? '',
    };
}
