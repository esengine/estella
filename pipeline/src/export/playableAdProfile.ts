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
    /** Anything else the developer must know before uploading. Reported as a
     *  warning, because an export that looks finished but isn't is worse. */
    readonly deliveryNote?: string;
    /** Markup for `<head>`: an orientation meta tag, the network's own SDK script. */
    emitHead?(ctx: PlayableAdContext): string;
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
    maxBytes: 2 * 1024 * 1024,
    limitNote: "no network selected — using Meta's 2MB index.html cap, the strictest we know of",
};

/**
 * Meta (Facebook / Instagram) playable ads, single-file format. Meta caps the
 * index.html itself at 2MB (its 5MB figure is the total for a ZIP bundle, which a
 * single-file playable has no way to spend), forbids any HTTP request — hence
 * nothing in `<head>` — and requires the click-through to call its own function.
 * @see https://www.facebook.com/business/help/412951382532338
 */
export const metaPlayableProfile: PlayableAdProfile = {
    id: 'meta',
    label: 'Meta (Facebook / Instagram)',
    maxBytes: 2 * 1024 * 1024,
    limitNote: "Meta caps a playable's index.html at 2MB",
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
 * The MRAID networks. `mraid` is injected by the host webview, so nothing goes in
 * `<head>` — and `mraid.open()` is what the spec requires for a click-through
 * (an `<a href>` or `window.open` breaks click tracking, and some exchanges reject
 * it outright).
 *
 * Note for the game: MRAID hosts expect the playable to wait for the
 * `viewableChange` event before it starts, which is the game's call to make.
 * @see https://mraid.io/
 */
const mraidBridge = (): string => 'window.__ESTELLA_PLAYABLE__={cta:function(){'
    + 'if(typeof mraid!=="undefined"&&mraid.open)mraid.open();'
    + '}};';

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
    limitNote: 'Unity requires a single inlined index.html under 5MB',
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

/** The networks the editor ships, by id. A network absent here is not unsupported:
 *  a project defines its own with the same contract (`kind: 'playable'`). */
export const BUILTIN_PLAYABLE_PROFILES: readonly PlayableAdProfile[] = [
    genericPlayableProfile,
    metaPlayableProfile,
    googlePlayableProfile,
    mraidPlayableProfile,
    unityPlayableProfile,
    applovinPlayableProfile,
];

export function builtinPlayableProfile(id: string | undefined): PlayableAdProfile | null {
    return BUILTIN_PLAYABLE_PROFILES.find((p) => p.id === id) ?? null;
}

/** What a profile contributes to the page, resolved once so the assembler stays flat. */
export function playableAdInjection(
    profile: PlayableAdProfile,
    ctx: PlayableAdContext,
): { head: string; bridge: string } {
    return {
        head: profile.emitHead?.(ctx) ?? '',
        bridge: profile.emitBridge?.(ctx) ?? '',
    };
}
