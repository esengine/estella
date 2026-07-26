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

/** The networks the editor ships, by id. */
export const BUILTIN_PLAYABLE_PROFILES: readonly PlayableAdProfile[] = [
    genericPlayableProfile,
    metaPlayableProfile,
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
