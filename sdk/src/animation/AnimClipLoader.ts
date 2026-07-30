// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimClipLoader.ts
 * @brief   .esanim asset format: parsing, serialization, sheet-grid math, and
 *          per-frame anchor resolution
 */

import type { SpriteAnimClip, SpriteAnimFrame } from './SpriteAnimator';
import { log } from '../util/logger';

// =============================================================================
// .esanim File Format
// =============================================================================

export const ANIM_CLIP_FORMAT_VERSION = '1.4';

/**
 * A frame's anchor, normalized inside the frame's own rect — EXACTLY the space
 * `Sprite.pivot` uses: (0,0) = bottom-left, (0.5,0.5) = center, (1,1) = top-right.
 * The same numbers travel from the file to the component with no conversion, so
 * "feet on the ground" is `{ x: 0.5, y: 0 }` in both places. Values outside 0–1
 * are allowed (they anchor outside the frame), matching `Sprite.pivot`.
 */
export interface AnimClipPivotData {
    x: number;
    y: number;
}

/** The anchor a clip that authors pivots falls back to — the `Sprite.pivot` default. */
export const DEFAULT_ANIM_CLIP_PIVOT: AnimClipPivotData = { x: 0.5, y: 0.5 };

/**
 * Sprite-sheet slicing grid. When present, frames may reference grid cells
 * instead of per-frame textures; all cell frames share `texture`.
 * `pageWidth`/`pageHeight` are baked by the editor from the image's natural
 * size (UV normalization needs them; the runtime never reads the image).
 */
export interface AnimClipSheetData {
    texture: string;
    cellWidth: number;
    cellHeight: number;
    margin: number;
    spacing: number;
    pageWidth: number;
    pageHeight: number;
}

export interface AnimClipFrameData {
    /** Per-frame texture ref; absent on sheet-cell frames. */
    texture?: string;
    /** Sheet cell index (row-major, 0-based); requires a `sheet` section. */
    cell?: number;
    duration?: number;
    /**
     * Anchor override for this frame; absent = the clip's `pivot`. Added in format
     * 1.4 — this is what keeps a character's feet planted when the artwork shifts
     * inside the cell from frame to frame.
     */
    pivot?: AnimClipPivotData;
    atlasFrame?: {
        x: number;
        y: number;
        width: number;
        height: number;
        pageWidth: number;
        pageHeight: number;
    };
}

/**
 * A frame event: as the playhead crosses `frame`, the runtime fires `name`
 * (with optional `data`) to any listener. Added in format 1.3; the runtime
 * (SpriteAnimator) always supported events, only the format/editor did not.
 */
export interface AnimClipEventData {
    frame: number;
    name: string;
    data?: unknown;
}

export interface AnimClipAssetData {
    version: string;
    type: 'animation-clip';
    fps?: number;
    loop?: boolean;
    /**
     * Clip-wide anchor every frame inherits (frames override it per frame) — the
     * same fallback relationship `fps` has with per-frame `duration`. Absent means
     * the clip does not author anchors at all and playback leaves `Sprite.pivot`
     * exactly as the entity authored it.
     */
    pivot?: AnimClipPivotData;
    sheet?: AnimClipSheetData;
    frames: AnimClipFrameData[];
    events?: AnimClipEventData[];
}

// =============================================================================
// Sheet grid math
// =============================================================================

/** Columns the sheet grid fits (same stride math as the tileset atlas grid). */
export function animClipSheetCols(sheet: AnimClipSheetData): number {
    const stride = sheet.cellWidth + sheet.spacing;
    return stride > 0 ? Math.max(1, Math.floor((sheet.pageWidth - sheet.margin + sheet.spacing) / stride)) : 1;
}

/** Rows the sheet grid fits. At least 1 so cell 0 always resolves. */
export function animClipSheetRows(sheet: AnimClipSheetData): number {
    const stride = sheet.cellHeight + sheet.spacing;
    return stride > 0 ? Math.max(1, Math.floor((sheet.pageHeight - sheet.margin + sheet.spacing) / stride)) : 1;
}

/** Pixel rect of a grid cell, clamped into the valid cell range. */
export function animClipCellRect(
    sheet: AnimClipSheetData,
    cell: number,
): { x: number; y: number; width: number; height: number } {
    const cols = animClipSheetCols(sheet);
    const rows = animClipSheetRows(sheet);
    const clamped = Math.min(Math.max(0, Math.floor(cell)), cols * rows - 1);
    const col = clamped % cols;
    const row = Math.floor(clamped / cols);
    return {
        x: sheet.margin + col * (sheet.cellWidth + sheet.spacing),
        y: sheet.margin + row * (sheet.cellHeight + sheet.spacing),
        width: sheet.cellWidth,
        height: sheet.cellHeight,
    };
}

/** UV window (flipY space) of a grid cell — what a Sprite shows for that frame. */
export function animClipCellUv(
    sheet: AnimClipSheetData,
    cell: number,
): { uvOffset: { x: number; y: number }; uvScale: { x: number; y: number } } {
    const rect = animClipCellRect(sheet, cell);
    return {
        uvOffset: {
            x: rect.x / sheet.pageWidth,
            y: 1.0 - (rect.y + rect.height) / sheet.pageHeight,
        },
        uvScale: {
            x: rect.width / sheet.pageWidth,
            y: rect.height / sheet.pageHeight,
        },
    };
}

// =============================================================================
// Frame anchors
// =============================================================================

/**
 * Does this clip author anchors at all? True as soon as the clip OR any single
 * frame declares one. All-or-nothing on purpose: a clip that anchored only some
 * frames would leave the last override standing on the plain ones — the same
 * staleness the UV window has to reset away.
 */
export function animClipDrivesPivot(data: AnimClipAssetData): boolean {
    return data.pivot !== undefined || data.frames.some(f => f.pivot !== undefined);
}

/**
 * The anchor a frame actually renders with: its own override, else the clip
 * default, else centered — or `null` when the clip authors no anchors, which is
 * the signal to leave `Sprite.pivot` exactly as the entity set it.
 *
 * The one place this resolution lives: the runtime bake, the edit-mode viewport
 * projection, and the editor's drag handle all read it here.
 */
export function animClipFramePivot(
    data: AnimClipAssetData,
    frame: AnimClipFrameData,
): AnimClipPivotData | null {
    if (frame.pivot) return { x: frame.pivot.x, y: frame.pivot.y };
    if (!animClipDrivesPivot(data)) return null;
    const p = data.pivot ?? DEFAULT_ANIM_CLIP_PIVOT;
    return { x: p.x, y: p.y };
}

// =============================================================================
// Parsing / serialization
// =============================================================================

const DEFAULT_FPS = 12;

function posInt(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
}

function nonNeg(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** A `{x,y}` anchor, or undefined when the field is missing or not a finite pair.
 *  Deliberately unclamped: an anchor outside 0–1 is legal on `Sprite.pivot` too. */
function pivotOf(v: unknown): AnimClipPivotData | undefined {
    const p = v as { x?: unknown; y?: unknown } | null | undefined;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return undefined;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
    return { x: p.x, y: p.y };
}

/** Parse arbitrary JSON into a normalized {@link AnimClipAssetData} (tolerant of missing fields). */
export function parseAnimClipAsset(rawJson: unknown): AnimClipAssetData {
    const raw = rawJson as Record<string, any> | null | undefined;
    let sheet: AnimClipSheetData | undefined;
    const rs = raw?.sheet;
    if (rs && typeof rs.texture === 'string' && rs.texture) {
        sheet = {
            texture: rs.texture,
            cellWidth: posInt(rs.cellWidth, 32),
            cellHeight: posInt(rs.cellHeight, 32),
            margin: nonNeg(rs.margin, 0),
            spacing: nonNeg(rs.spacing, 0),
            pageWidth: posInt(rs.pageWidth, 1),
            pageHeight: posInt(rs.pageHeight, 1),
        };
    }
    const frames: AnimClipFrameData[] = [];
    for (const f of Array.isArray(raw?.frames) ? raw.frames : []) {
        if (!f) continue;
        const duration = typeof f.duration === 'number' && f.duration > 0 ? f.duration : undefined;
        const framePivot = pivotOf(f.pivot);
        if (sheet && typeof f.cell === 'number' && Number.isInteger(f.cell) && f.cell >= 0) {
            frames.push({
                cell: f.cell,
                ...(duration !== undefined ? { duration } : {}),
                ...(framePivot ? { pivot: framePivot } : {}),
            });
        } else if (typeof f.texture === 'string' && f.texture) {
            const frame: AnimClipFrameData = { texture: f.texture };
            if (duration !== undefined) frame.duration = duration;
            if (framePivot) frame.pivot = framePivot;
            const af = f.atlasFrame;
            if (af && [af.x, af.y, af.width, af.height, af.pageWidth, af.pageHeight]
                .every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) {
                frame.atlasFrame = {
                    x: af.x, y: af.y, width: af.width, height: af.height,
                    pageWidth: af.pageWidth, pageHeight: af.pageHeight,
                };
            }
            frames.push(frame);
        }
    }
    const events: AnimClipEventData[] = [];
    for (const e of Array.isArray(raw?.events) ? raw.events : []) {
        if (e && typeof e.name === 'string' && e.name
            && typeof e.frame === 'number' && Number.isInteger(e.frame) && e.frame >= 0) {
            events.push({ frame: e.frame, name: e.name, ...(e.data !== undefined ? { data: e.data } : {}) });
        }
    }
    const clipPivot = pivotOf(raw?.pivot);
    return {
        version: typeof raw?.version === 'string' ? raw.version : ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: posInt(raw?.fps, DEFAULT_FPS),
        loop: typeof raw?.loop === 'boolean' ? raw.loop : true,
        ...(clipPivot ? { pivot: clipPivot } : {}),
        ...(sheet ? { sheet } : {}),
        frames,
        ...(events.length ? { events } : {}),
    };
}

/**
 * Serialize an {@link AnimClipAssetData} to a plain JSON-ready object (drops
 * empty/undefined). Stamps the CURRENT format version: whatever the file said when
 * it was read, this writer produced what is on disk now — a clip that gained 1.4
 * anchors must not keep claiming 1.3.
 */
export function serializeAnimClip(asset: AnimClipAssetData): Record<string, unknown> {
    return {
        version: ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: asset.fps ?? DEFAULT_FPS,
        loop: asset.loop ?? true,
        ...(asset.pivot ? { pivot: { ...asset.pivot } } : {}),
        ...(asset.sheet ? { sheet: { ...asset.sheet } } : {}),
        frames: asset.frames.map(f => ({ ...f, ...(f.pivot ? { pivot: { ...f.pivot } } : {}) })),
        ...(asset.events && asset.events.length ? { events: asset.events.map(e => ({ ...e })) } : {}),
    };
}

/** A fresh sheet-sliced clip over a texture (no frames yet). */
export function createAnimClip(
    texture: string,
    cellWidth: number,
    cellHeight: number,
    pageWidth: number,
    pageHeight: number,
): AnimClipAssetData {
    return {
        version: ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: DEFAULT_FPS,
        loop: true,
        sheet: { texture, cellWidth, cellHeight, margin: 0, spacing: 0, pageWidth, pageHeight },
        frames: [],
    };
}

// =============================================================================
// Runtime clip resolution
// =============================================================================

export function extractAnimClipTexturePaths(data: AnimClipAssetData): string[] {
    const paths = new Set<string>();
    if (data.sheet?.texture) {
        paths.add(data.sheet.texture);
    }
    for (const frame of data.frames) {
        if (frame.texture) {
            paths.add(frame.texture);
        }
    }
    return Array.from(paths);
}

function uvFromRect(
    rect: { x: number; y: number; width: number; height: number },
    pageWidth: number,
    pageHeight: number,
): Pick<SpriteAnimFrame, 'uvOffset' | 'uvScale'> {
    return {
        uvOffset: {
            x: rect.x / pageWidth,
            y: 1.0 - (rect.y + rect.height) / pageHeight,
        },
        uvScale: {
            x: rect.width / pageWidth,
            y: rect.height / pageHeight,
        },
    };
}

export function parseAnimClipData(
    clipPath: string,
    data: AnimClipAssetData,
    textureHandles: Map<string, number>,
): SpriteAnimClip {
    const sheet = data.sheet;
    const cellCount = sheet ? animClipSheetCols(sheet) * animClipSheetRows(sheet) : 0;
    return {
        name: clipPath,
        fps: data.fps ?? DEFAULT_FPS,
        loop: data.loop ?? true,
        ...(data.events?.length ? { events: data.events.map(e => ({ frame: e.frame, name: e.name, data: e.data })) } : {}),
        frames: data.frames.map(f => {
            // Resolved once at load: at runtime a frame either carries the anchor it
            // renders with, or the clip authors none and playback leaves pivot alone.
            const pivot = animClipFramePivot(data, f);
            if (sheet && f.cell !== undefined) {
                if (f.cell >= cellCount) {
                    log.warn('asset', `${clipPath}: frame cell ${f.cell} outside the ${cellCount}-cell sheet grid; clamped`);
                }
                const frame: SpriteAnimFrame = {
                    texture: textureHandles.get(sheet.texture) ?? 0,
                    duration: f.duration,
                    ...(pivot ? { pivot } : {}),
                    ...animClipCellUv(sheet, f.cell),
                };
                return frame;
            }
            const frame: SpriteAnimFrame = {
                texture: textureHandles.get(f.texture ?? '') ?? 0,
                duration: f.duration,
                ...(pivot ? { pivot } : {}),
            };
            if (f.atlasFrame) {
                const af = f.atlasFrame;
                Object.assign(frame, uvFromRect(af, af.pageWidth, af.pageHeight));
            }
            return frame;
        }),
    };
}
