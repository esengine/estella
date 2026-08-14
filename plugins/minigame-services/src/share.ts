// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    share.ts
 * @brief   Host share sheet as an engine service.
 *
 * Two share surfaces exist on a mini-game host and a game should configure
 * both: ACTIVE (the game's own share button → `share()`) and PASSIVE (the
 * host's built-in menu → `setShareCard`). The card provider is asked at share
 * time, so it can answer with live state — a room code, the current score.
 * Fire-and-forget by design: no host reports whether the player shared.
 */
import {
    defineResource, platformShare, platformCanShare, platformOnShareRequest,
    type PlatformShareOptions,
} from 'esengine';

export type ShareCard = PlatformShareOptions;

export class ShareAPI {
    private card_: ShareCard | (() => ShareCard) | null = null;
    private registered_ = false;

    /** Whether this platform can open a share sheet at all — what a menu reads
     *  to hide its share button honestly (web and native cannot). */
    get available(): boolean {
        return platformCanShare();
    }

    /** Open the host's share sheet with `card`, falling back to the default
     *  card when omitted. Returns whether a sheet could be opened at all. */
    share(card?: ShareCard): boolean {
        return platformShare(card ?? this.resolveCard_() ?? {});
    }

    /**
     * Set the DEFAULT card: what passive shares (the host's own menu) say, and
     * what `share()` without arguments uses. A function is asked at share time,
     * so the card can carry live state.
     */
    setShareCard(card: ShareCard | (() => ShareCard)): void {
        this.card_ = card;
        if (!this.registered_) {
            this.registered_ = platformOnShareRequest(() => this.resolveCard_() ?? {});
        }
    }

    private resolveCard_(): ShareCard | null {
        return typeof this.card_ === 'function' ? this.card_() : this.card_;
    }
}

export const Share = defineResource<ShareAPI>(null!, 'Share');
