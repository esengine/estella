// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    opendata/index.ts
 * @brief   The built-in leaderboard, as it runs INSIDE the open data context.
 *
 * This file is not part of the engine and must never import it. The context is
 * a second JS runtime with no WebGL, no wasm, no DOM and almost none of the
 * host API — it has a 2D canvas the main domain samples as a texture, a message
 * channel with no way back, and the one thing that exists nowhere else: the
 * player's friends. `opendata.test.ts` enforces the boundary, because the cost
 * of getting it wrong is a package that builds and then fails on a device.
 *
 * It ships as its own bundle (`dist/open-data.js`) and the exporter uses it
 * when a project supplies no `open-data/index.ts` of its own. Ship a
 * leaderboard people can use, and an escape hatch for the ones who cannot.
 *
 * Nothing here can be interactive: no pointer or key event reaches this
 * runtime, so there is no scrolling, no paging and no row you can tap. A board
 * that needs those is a board the host cannot give us, and pretending
 * otherwise would be a control that silently does nothing.
 */
import type { HideMessage, LeaderboardStyle, OpenDataMessage, ShowMessage } from './protocol';

// =============================================================================
// The host, as this runtime sees it
// =============================================================================

/** One player's cloud rows, as the host hands them over. */
interface CloudPlayer {
    avatarUrl?: string;
    nickname?: string;
    openid?: string;
    KVDataList?: Array<{ key: string; value: string }>;
}

/** The subset of the host global the context is given. Everything is optional:
 *  a vendor missing one degrades to a board without that part, never a throw. */
interface OpenDataHost {
    onMessage?(cb: (message: unknown) => void): void;
    getSharedCanvas?(): OpenDataCanvas;
    getFriendCloudStorage?(opts: {
        keyList: string[];
        success?: (res: { data: CloudPlayer[] }) => void;
        fail?: (err: unknown) => void;
    }): void;
    createImage?(): { src: string; onload: (() => void) | null; onerror: (() => void) | null };
}

interface OpenDataCanvas {
    width: number;
    height: number;
    getContext(type: '2d'): CanvasRenderingContext2D | null;
}

const host = (globalThis as unknown as { wx?: OpenDataHost; tt?: OpenDataHost }).wx
    ?? (globalThis as unknown as { tt?: OpenDataHost }).tt;

// =============================================================================
// Drawing
// =============================================================================

const DEFAULTS: Required<Omit<LeaderboardStyle, 'background' | 'lineColor'>> & Pick<LeaderboardStyle, 'background' | 'lineColor'> = {
    background: undefined,
    color: '#e8e8e8',
    selfColor: '#ffffff',
    lineColor: '#ffffff14',
    rowHeight: 44,
    fontSize: 15,
    fontFamily: 'sans-serif',
    avatars: true,
};

/** A row as the board draws it: already sorted, already trimmed. */
interface Row {
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
 * survive, how they sort, and what a player with no score at all does (they are
 * dropped rather than drawn as zero — a friend who has not played is not last,
 * they are absent).
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

/** Draw `rows` onto the shared canvas. */
function paint(canvas: OpenDataCanvas, rows: readonly Row[], style: LeaderboardStyle, dpr: number): void {
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
        if (avatar) {
            // Drawn only once it has actually loaded — an image mid-flight draws
            // nothing, and the load schedules the repaint that catches it.
            ctx.drawImage(avatar as unknown as CanvasImageSource, pad + 34, mid - avatarSize / 2, avatarSize, avatarSize);
        }

        // The name is what gets cut when the canvas is narrow, never the score:
        // a board whose numbers are missing is not a leaderboard.
        const scoreText = String(row.score);
        const scoreW = ctx.measureText(scoreText).width;
        ctx.fillText(clip(ctx, row.name, w - pad - nameLeft - scoreW - 12), nameLeft, mid);

        ctx.textAlign = 'right';
        ctx.fillText(scoreText, w - pad, mid);
    });
}

/** `text`, cut with an ellipsis to fit `max` px. */
function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
    if (max <= 0) return '';
    if (ctx.measureText(text).width <= max) return text;
    let out = text;
    while (out.length > 0 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
    return out.length ? `${out}…` : '';
}

// =============================================================================
// Avatars — loaded once, redrawn when they land
// =============================================================================

type LoadedImage = { src: string; onload: (() => void) | null; onerror: (() => void) | null };
const avatars = new Map<string, { img: LoadedImage; ready: boolean }>();
let repaint: (() => void) | null = null;

function avatarFor(url: string | undefined): LoadedImage | null {
    if (!url || !host?.createImage) return null;
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
}

// =============================================================================
// The loop
// =============================================================================

let last: ShowMessage | null = null;

function show(msg: ShowMessage): void {
    last = msg;
    const canvas = host?.getSharedCanvas?.();
    const read = host?.getFriendCloudStorage;
    if (!canvas || !read) return;
    read.call(host, {
        keyList: [msg.key],
        success: (res) => {
            if (last !== msg) return;   // a newer show already replaced this one
            const rows = rowsFrom(res.data ?? [], msg.key, msg.order, msg.limit);
            repaint = () => { if (last === msg) paint(canvas, rows, msg.style, msg.dpr); };
            repaint();
        },
        // Nothing to draw and nothing to say: this runtime has no channel back,
        // so an error here can only be a board that stays empty.
        fail: () => { if (last === msg) hide(); },
    });
}

function hide(_msg?: HideMessage): void {
    last = null;
    repaint = null;
    const canvas = host?.getSharedCanvas?.();
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

/** Route one message. Exported so a test can drive it without a host. */
export function handle(message: unknown): void {
    const m = message as OpenDataMessage | undefined;
    // An older package can be running against a newer main domain, and a throw
    // in this runtime is invisible from the other one — so an unknown message is
    // ignored rather than trusted.
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'show') show(m);
    else if (m.kind === 'hide') hide(m);
}

host?.onMessage?.call(host, handle);
