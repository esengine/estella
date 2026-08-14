// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    leaderboard.ts
 * @brief   The friends leaderboard, as a package.
 *
 * The shape of this API is not a design choice; it is the host's constraint
 * made visible. A player's friends can be READ only inside the open data
 * context — a second JS runtime with no engine — and there is no channel back
 * from it. So the two halves of a leaderboard live in different places and this
 * façade cannot hide that:
 *
 *   `submit`  is the MAIN domain's half. Writing your own row is the one cloud
 *             operation a game may do here.
 *   `show`    is a request, not a question. It asks the context to draw, and
 *             what comes back is pixels on a canvas — never rows, never a
 *             count, never "did it work".
 *   `texture` is those pixels, as an engine texture handle a UIVisual can wear.
 *
 * An API that returned `Promise<Row[]>` would be the honest-looking one, and it
 * is the one no host can implement.
 *
 * The other half — what draws inside the context — is `./opendata`, which this
 * file must never import: that runtime has no engine, and the package a project
 * points its `open-data/index.ts` at is bundled on its own.
 */
import {
    defineResource, log,
    platformCanOpenData, platformOpenDataCanvas, platformOpenDataPostMessage,
    platformSetCloudKeyValues, platformDevicePixelRatio,
    createCanvasTexture,
    type App, type CanvasTexture,
} from 'esengine';
import type { LeaderboardScope, LeaderboardStyle, ShowMessage } from './opendata/protocol';

export type { LeaderboardScope, LeaderboardStyle };

/** What to draw, and how. Everything has a default a game can ignore. */
export interface LeaderboardOptions {
    /** Cloud key the scores live under. Defaults to what {@link LeaderboardAPI.submit}
     *  writes, so the two cannot disagree unless a game makes them. */
    key?: string;
    scope?: LeaderboardScope;
    /** Rows at most. The context's canvas is a fixed size and cannot scroll. */
    limit?: number;
    /** `desc` for a high score (default), `asc` for a best time. */
    order?: 'desc' | 'asc';
    style?: LeaderboardStyle;
}

/** The default cloud key. Named for the engine so two games in one host cannot
 *  read each other's rows by accident. */
const DEFAULT_KEY = 'es.score';

export class LeaderboardAPI {
    private texture_: CanvasTexture | null = null;
    private shown_ = false;
    private key_ = DEFAULT_KEY;

    constructor(private readonly app_: () => App | null) {}

    /** Whether this host has a context to draw in — what a menu reads to hide
     *  its leaderboard button honestly (web and native have none). */
    get available(): boolean {
        return platformCanOpenData();
    }

    /**
     * The board's pixels, as an engine texture handle, or 0 before there are
     * any. Stable across every redraw — a UIVisual set to it once keeps it.
     */
    get texture(): number {
        return this.texture_?.handle ?? 0;
    }

    /** Whether the board is currently being drawn. */
    get visible(): boolean {
        return this.shown_;
    }

    /**
     * Write this player's own score.
     *
     * Fire-and-forget past "was there a store": the hosts report a write's
     * outcome inconsistently, and the failure a game could act on (offline) is
     * not the one they distinguish. Returns whether there was anywhere to write.
     */
    submit(score: number, options?: { key?: string; extra?: Readonly<Record<string, string>> }): boolean {
        this.key_ = options?.key ?? this.key_;
        return platformSetCloudKeyValues({ ...options?.extra, [this.key_]: String(score) });
    }

    /**
     * Ask the context to draw the board, and start sampling what it draws.
     *
     * False where there is no context. The rows themselves never come back —
     * see the file header.
     */
    show(options: LeaderboardOptions = {}): boolean {
        const key = options.key ?? this.key_;
        this.key_ = key;
        const message: ShowMessage = {
            kind: 'show',
            key,
            scope: options.scope ?? 'friends',
            limit: options.limit ?? 20,
            order: options.order ?? 'desc',
            style: options.style ?? {},
            dpr: platformDevicePixelRatio(),
        };
        if (!platformOpenDataPostMessage(message as unknown as Record<string, unknown>)) return false;
        this.shown_ = true;
        this.ensureTexture_();
        return true;
    }

    /** Stop drawing, and stop sampling. The texture handle stays valid and
     *  holds the last frame until the next {@link show}. */
    hide(): void {
        if (!this.shown_) return;
        this.shown_ = false;
        platformOpenDataPostMessage({ kind: 'hide' });
        // One last take, so what stays on the handle is the CLEARED canvas
        // rather than the board that was on it when we stopped looking.
        this.texture_?.update();
    }

    /** Re-take the context's canvas. Called by the plugin's system, once a frame
     *  and only while the board is up. */
    sample(): void {
        if (!this.shown_) return;
        if (!this.texture_) this.ensureTexture_();
        this.texture_?.update();
    }

    /** Release the GL texture. The handle is dead afterwards. */
    dispose(): void {
        this.texture_?.destroy();
        this.texture_ = null;
        this.shown_ = false;
    }

    private ensureTexture_(): void {
        if (this.texture_) return;
        const canvas = platformOpenDataCanvas();
        if (!canvas) return;
        this.texture_ = createCanvasTexture(this.app_(), canvas);
        if (!this.texture_) {
            // Said once, where it is actionable: the board will be a blank quad
            // and nothing else explains why.
            log.warn('leaderboard', 'no WebGL2 context to sample the open data canvas with');
        }
    }
}

export const Leaderboard = defineResource<LeaderboardAPI>(null!, 'Leaderboard');
