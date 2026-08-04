// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    leaderboard.ts
 * @brief   The friends leaderboard as an engine service.
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
 */
import { defineResource } from '../ecs/resource';
import {
    platformCanOpenData, platformOpenDataCanvas, platformOpenDataPostMessage, platformSetCloudKeyValues,
    platformDevicePixelRatio, platformCreateCanvas,
} from '../platform';
import type { ESEngineModule } from '../wasm';
import type { PlatformCanvas } from '../platform/types';
import { createCanvasTexture, type CanvasTexture } from '../asset/canvasTexture';
import type { LeaderboardScope, LeaderboardStyle, ShowMessage } from '../opendata/protocol';
import { createBoard, type CloudPlayer, type HostCanvas } from '../opendata/board';
import { log } from '../util/logger';

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

/**
 * A stand-in for the open data context, for hosts that have none: the editor's
 * play mode, a web build, a test. Mirrors the two things the platform supplies
 * — somewhere to send a message, and a canvas to sample — so one seam serves
 * both. {@link createLocalLeaderboard} is the standard implementation.
 */
export interface LeaderboardProvider {
    /** The surface the board is drawn on. */
    canvas(): PlatformCanvas | null;
    /** Receive what the main domain would have posted into the context. */
    post(message: Record<string, unknown>): void;
}

export class LeaderboardAPI {
    private texture_: CanvasTexture | null = null;
    private shown_ = false;
    private key_ = DEFAULT_KEY;
    private provider_: LeaderboardProvider | null = null;

    constructor(private readonly module_: () => ESEngineModule | null) {}

    /** Whether SOME board exists here — the host's context, or an installed
     *  provider. What a menu reads to hide its leaderboard button honestly. */
    get available(): boolean {
        return this.provider_ !== null || platformCanOpenData();
    }

    /**
     * Install (or clear with null) a {@link LeaderboardProvider} that answers
     * INSTEAD of the platform. The editor's play mode installs the local one,
     * so a board can be looked at without a device. Clearing drops the texture
     * — the canvas behind it is going away.
     */
    setProvider(provider: LeaderboardProvider | null): void {
        if (provider === this.provider_) return;
        this.provider_ = provider;
        this.texture_?.destroy();
        this.texture_ = null;
        this.shown_ = false;
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
        if (!this.post_(message as unknown as Record<string, unknown>)) return false;
        this.shown_ = true;
        this.ensureTexture_();
        return true;
    }

    /** Stop drawing, and stop sampling. The texture handle stays valid and
     *  holds the last frame until the next {@link show}. */
    hide(): void {
        if (!this.shown_) return;
        this.shown_ = false;
        this.post_({ kind: 'hide' });
        // One last take, so what stays on the handle is the CLEARED canvas
        // rather than the board that was on it when we stopped looking.
        this.texture_?.update();
    }

    /** Re-take the context's canvas. Called by the service system, once a frame
     *  and only while the board is up. @internal */
    sample(): void {
        if (!this.shown_) return;
        if (!this.texture_) this.ensureTexture_();
        this.texture_?.update();
    }

    /** Release the GL texture. @internal */
    dispose(): void {
        this.texture_?.destroy();
        this.texture_ = null;
        this.shown_ = false;
    }

    /** An installed provider answers instead of the platform, both ways. */
    private post_(message: Record<string, unknown>): boolean {
        if (this.provider_) { this.provider_.post(message); return true; }
        return platformOpenDataPostMessage(message);
    }

    private ensureTexture_(): void {
        if (this.texture_) return;
        const canvas = this.provider_ ? this.provider_.canvas() : platformOpenDataCanvas();
        if (!canvas) return;
        this.texture_ = createCanvasTexture(this.module_(), canvas);
        if (!this.texture_) {
            // Said once, where it is actionable: the board will be a blank quad
            // and nothing else explains why.
            log.warn('services', 'leaderboard: no WebGL2 context to sample the open data canvas with');
        }
    }
}

export const Leaderboard = defineResource<LeaderboardAPI>(null!, 'Leaderboard');

/** How a rehearsal board is populated. */
export interface LocalLeaderboardOptions {
    /** The friends to invent. Defaults to a small, obviously-fake set — real
     *  names would read as real data and hide that this is a rehearsal. */
    friends?: readonly CloudPlayer[];
    /** Canvas size in CSS px. */
    width?: number;
    height?: number;
}

/** Names that cannot be mistaken for a real friends list. */
const REHEARSAL_FRIENDS: readonly CloudPlayer[] = [
    { nickname: 'Player One', openid: 'local-self', KVDataList: [{ key: 'es.score', value: '18400' }] },
    { nickname: 'Sample Friend', openid: 'local-2', KVDataList: [{ key: 'es.score', value: '15250' }] },
    { nickname: 'Another Tester', openid: 'local-3', KVDataList: [{ key: 'es.score', value: '9870' }] },
    { nickname: 'Someone Else', openid: 'local-4', KVDataList: [{ key: 'es.score', value: '6120' }] },
    { nickname: 'Never Played', openid: 'local-5', KVDataList: [] },
];

/**
 * A board you can look at without a device.
 *
 * It runs the ENGINE'S OWN board — the same `createBoard` that ships inside the
 * open data context — against an offscreen 2D canvas and invented friends. That
 * is the whole point: a rehearsal that drew its own approximation would tell
 * you nothing about the thing that ships. What it cannot rehearse is the part
 * that is genuinely the host's: real friends, and the sandbox they live in.
 *
 * The cloud read answers SYNCHRONOUSLY here, where a host answers over IPC. The
 * board treats both the same (it repaints from the callback either way), and a
 * fake delay would only be a number nobody chose.
 */
export function createLocalLeaderboard(options: LocalLeaderboardOptions = {}): LeaderboardProvider {
    const friends = options.friends ?? REHEARSAL_FRIENDS;
    const canvas = platformCreateCanvas(options.width ?? 360, options.height ?? 260);
    const board = createBoard({
        getSharedCanvas: () => canvas as unknown as HostCanvas,
        getFriendCloudStorage: ({ keyList, success }) => {
            const key = keyList[0];
            success?.({
                data: friends.map((f) => ({
                    ...f,
                    // Re-keyed to whatever the game asked for, so a game with its
                    // own key still sees the rehearsal rows rather than an empty
                    // board it would reasonably read as "this is broken".
                    KVDataList: (f.KVDataList ?? []).map((kv) => ({ ...kv, key })),
                })),
            });
        },
        selfOpenId: 'local-self',
    });
    return {
        canvas: () => canvas,
        post: (message) => { board.handle(message); },
    };
}
