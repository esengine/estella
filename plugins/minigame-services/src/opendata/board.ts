// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    board.ts
 * @brief   The built-in leaderboard's drawing, over whatever host it is given.
 *
 * Separated from the entry so the SAME code can run in two places: inside the
 * open data context on a device (index.ts hands it the host global), and in the
 * editor's play mode against an offscreen canvas and invented friends. A
 * rehearsal that drew a different board would rehearse nothing.
 *
 * Which is also why the host is a PARAMETER and the state is per board: two
 * boards sharing a module-level canvas and avatar cache is a bug that appears
 * only in the place that has two of them.
 *
 * Imports nothing but its own protocol, and that only as a type — see
 * `opendata.test.ts`. The runtime this ends up in has no engine to import.
 */
import type { HideMessage, LeaderboardStyle, OpenDataMessage, ShowMessage } from './protocol';

// =============================================================================
// The host, as this runtime sees it
// =============================================================================

/** One player's cloud rows, as a host hands them over. */
export interface CloudPlayer {
    avatarUrl?: string;
    nickname?: string;
    openid?: string;
    KVDataList?: Array<{ key: string; value: string }>;
}

/** An image the host can load. Deliberately not `HTMLImageElement`: there is no
 *  DOM in the context, and the shape below is all the drawing needs. */
export interface HostImage {
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
}

export interface HostCanvas {
    width: number;
    height: number;
    getContext(type: '2d'): CanvasRenderingContext2D | null;
}

/**
 * What a board needs from wherever it runs. Every member optional: a vendor
 * missing one degrades to a board without that part, never a throw.
 */
export interface BoardHost {
    getSharedCanvas?(): HostCanvas | null;
    getFriendCloudStorage?(opts: {
        keyList: string[];
        success?: (res: { data: CloudPlayer[] }) => void;
        fail?: (err: unknown) => void;
    }): void;
    createImage?(): HostImage;
    /**
     * This player, so their own row can be marked.
     *
     * The rehearsal knows it outright. On a device nobody hands it over — so
     * the board ASKS, through {@link getUserInfo}, and this stays for the hosts
     * (and the rehearsal) that can simply answer.
     */
    selfOpenId?: string;
    /**
     * Who someone is. The context is given this with one special argument: the
     * literal `'selfOpenId'` in the list means "the player running the game",
     * which is the only way this runtime can learn its own identity — it has no
     * login, and the main domain has no channel to tell it.
     */
    getUserInfo?(opts: {
        openIdList: string[];
        success?: (res: { data: Array<{ openid?: string }> }) => void;
        fail?: (err: unknown) => void;
    }): void;
}

/** The host's word for "whoever is playing" in an openIdList. */
const SELF = 'selfOpenId';

// =============================================================================
// Ranking
// =============================================================================

/** A row as the board draws it: already sorted, already trimmed. */
export interface Row {
    rank: number;
    name: string;
    score: number;
    avatarUrl?: string;
    self: boolean;
}

/**
 * Cloud rows → the rows to draw.
 *
 * Pure, and exported, because it is the half worth testing: which entries
 * survive, how they sort, and what a player with no score does — dropped, not
 * drawn as zero, since a friend who has not played is not last, they are absent.
 */
export function rowsFrom(
    players: readonly CloudPlayer[],
    key: string,
    order: 'desc' | 'asc',
    limit: number,
    selfOpenId?: string,
): Row[] {
    const scored: Array<Omit<Row, 'rank'>> = [];
    for (const p of players) {
        const raw = p.KVDataList?.find((kv) => kv.key === key)?.value;
        if (raw === undefined) continue;
        const score = Number(raw);
        if (!Number.isFinite(score)) continue;
        scored.push({
            name: p.nickname ?? '',
            score,
            avatarUrl: p.avatarUrl,
            self: !!selfOpenId && p.openid === selfOpenId,
        });
    }
    scored.sort((a, b) => (order === 'asc' ? a.score - b.score : b.score - a.score));
    return scored.slice(0, Math.max(0, limit)).map((r, i) => ({ ...r, rank: i + 1 }));
}

// =============================================================================
// Drawing
// =============================================================================

type Resolved = Required<Omit<LeaderboardStyle, 'background' | 'lineColor'>>
    & Pick<LeaderboardStyle, 'background' | 'lineColor'>;

const DEFAULTS: Resolved = {
    background: undefined,
    color: '#e8e8e8',
    selfColor: '#ffffff',
    lineColor: '#ffffff14',
    rowHeight: 44,
    fontSize: 15,
    fontFamily: 'sans-serif',
    avatars: true,
};

/** `text`, cut with an ellipsis to fit `max` px. */
function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
    if (max <= 0) return '';
    if (ctx.measureText(text).width <= max) return text;
    let out = text;
    while (out.length > 0 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
    return out.length ? `${out}…` : '';
}

/** A board bound to one host. */
export interface Board {
    /** Route one message from the main domain. Unknown kinds are ignored. */
    handle(message: unknown): void;
}

export function createBoard(host: BoardHost): Board {
    // Per board, not per module: see the file header.
    const avatars = new Map<string, { img: HostImage; ready: boolean }>();
    let last: ShowMessage | null = null;
    let repaint: (() => void) | null = null;

    const avatarFor = (url: string | undefined): HostImage | null => {
        if (!url || !host.createImage) return null;
        const have = avatars.get(url);
        if (have) return have.ready ? have.img : null;
        const img = host.createImage();
        const entry = { img, ready: false };
        avatars.set(url, entry);
        img.onload = () => { entry.ready = true; repaint?.(); };
        // A failed avatar is a row without a picture, not a row that is missing.
        img.onerror = () => { avatars.delete(url); };
        img.src = url;
        return null;
    };

    const paint = (canvas: HostCanvas, rows: readonly Row[], style: LeaderboardStyle, dpr: number): void => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const s = { ...DEFAULTS, ...style };
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (s.background) {
            ctx.fillStyle = s.background;
            ctx.fillRect(0, 0, w, h);
        }

        ctx.textBaseline = 'middle';
        const pad = 14;
        const avatarSize = Math.min(s.rowHeight - 12, 30);
        const nameLeft = pad + 34 + (s.avatars ? avatarSize + 10 : 0);

        rows.forEach((row, i) => {
            const y = i * s.rowHeight;
            const mid = y + s.rowHeight / 2;
            if (s.lineColor && i > 0) {
                ctx.fillStyle = s.lineColor;
                ctx.fillRect(pad, y, w - pad * 2, 1);
            }
            ctx.fillStyle = row.self ? s.selfColor : s.color;
            ctx.font = `${row.self ? '600 ' : ''}${s.fontSize}px ${s.fontFamily}`;

            ctx.textAlign = 'left';
            ctx.fillText(String(row.rank), pad, mid);

            const avatar = s.avatars ? avatarFor(row.avatarUrl) : null;
            // Drawn only once it has actually loaded — an image mid-flight draws
            // nothing, and its load schedules the repaint that catches it.
            if (avatar) {
                ctx.drawImage(avatar as unknown as CanvasImageSource, pad + 34, mid - avatarSize / 2, avatarSize, avatarSize);
            }

            // The name is what gets cut when the canvas is narrow, never the
            // score: a board whose numbers are missing is not a leaderboard.
            const scoreText = String(row.score);
            const scoreW = ctx.measureText(scoreText).width;
            ctx.fillText(clip(ctx, row.name, w - pad - nameLeft - scoreW - 12), nameLeft, mid);

            ctx.textAlign = 'right';
            ctx.fillText(scoreText, w - pad, mid);
        });
    };

    const hide = (_msg?: HideMessage): void => {
        last = null;
        repaint = null;
        const canvas = host.getSharedCanvas?.();
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    /**
     * Who is playing, asked once and kept.
     *
     * Resolved lazily and NEVER waited on: the identity only decides which row
     * is emphasised, so a board that drew a moment before the answer arrived is
     * a correct board missing one highlight — where a board that waited would
     * be a blank rectangle for as long as the host took. The answer schedules a
     * repaint, so the highlight lands on its own.
     */
    let self: string | undefined = host.selfOpenId;
    let asked = false;
    const askWhoWeAre = (): void => {
        if (asked || self !== undefined || !host.getUserInfo) return;
        asked = true;
        host.getUserInfo.call(host, {
            openIdList: [SELF],
            success: (res) => {
                self = res.data?.[0]?.openid;
                // Only useful if there is still a board on screen to re-mark.
                if (self !== undefined) repaint?.();
            },
            // A host that will not say leaves every row unmarked, which is the
            // same board minus one emphasis — not a failure worth reporting to
            // a runtime that has no way to report anything.
            fail: () => {},
        });
    };

    const show = (msg: ShowMessage): void => {
        last = msg;
        const canvas = host.getSharedCanvas?.();
        const read = host.getFriendCloudStorage;
        if (!canvas || !read) return;
        askWhoWeAre();
        read.call(host, {
            keyList: [msg.key],
            success: (res) => {
                if (last !== msg) return;   // a newer show already replaced this one
                const players = res.data ?? [];
                // Ranked at paint time, not here: `self` can land after the rows
                // do, and re-ranking is what turns that late answer into the
                // highlight appearing.
                repaint = () => {
                    if (last !== msg) return;
                    paint(canvas, rowsFrom(players, msg.key, msg.order, msg.limit, self), msg.style, msg.dpr);
                };
                repaint();
            },
            // Nothing to draw and nothing to say: this runtime has no channel
            // back, so an error here can only be a board that stays empty.
            fail: () => { if (last === msg) hide(); },
        });
    };

    return {
        handle(message: unknown): void {
            const m = message as OpenDataMessage | undefined;
            // An older package can run against a newer main domain, and a throw
            // in this runtime is invisible from the other one — so an unknown
            // message is ignored rather than trusted.
            if (!m || typeof m !== 'object') return;
            if (m.kind === 'show') show(m);
            else if (m.kind === 'hide') hide(m);
        },
    };
}
