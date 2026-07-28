// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimClipLoader.ts
 * @brief   .esanim asset format: parsing, serialization, and sheet-grid math
 */

import type { SpriteAnimClip, SpriteAnimFrame } from './SpriteAnimator';
import { log } from '../util/logger';

// =============================================================================
// .esanim File Format
// =============================================================================

export const ANIM_CLIP_FORMAT_VERSION = '1.3';

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
// Parsing / serialization
// =============================================================================

const DEFAULT_FPS = 12;

function posInt(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
}

function nonNeg(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
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
        if (sheet && typeof f.cell === 'number' && Number.isInteger(f.cell) && f.cell >= 0) {
            frames.push({ cell: f.cell, ...(duration !== undefined ? { duration } : {}) });
        } else if (typeof f.texture === 'string' && f.texture) {
            const frame: AnimClipFrameData = { texture: f.texture };
            if (duration !== undefined) frame.duration = duration;
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
    return {
        version: typeof raw?.version === 'string' ? raw.version : ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: posInt(raw?.fps, DEFAULT_FPS),
        loop: typeof raw?.loop === 'boolean' ? raw.loop : true,
        ...(sheet ? { sheet } : {}),
        frames,
        ...(events.length ? { events } : {}),
    };
}

/** Serialize an {@link AnimClipAssetData} to a plain JSON-ready object (drops empty/undefined). */
export function serializeAnimClip(asset: AnimClipAssetData): Record<string, unknown> {
    return {
        version: asset.version || ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: asset.fps ?? DEFAULT_FPS,
        loop: asset.loop ?? true,
        ...(asset.sheet ? { sheet: { ...asset.sheet } } : {}),
        frames: asset.frames.map(f => ({ ...f })),
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
            if (sheet && f.cell !== undefined) {
                if (f.cell >= cellCount) {
                    log.warn('asset', `${clipPath}: frame cell ${f.cell} outside the ${cellCount}-cell sheet grid; clamped`);
                }
                const frame: SpriteAnimFrame = {
                    texture: textureHandles.get(sheet.texture) ?? 0,
                    duration: f.duration,
                    ...animClipCellUv(sheet, f.cell),
                };
                return frame;
            }
            const frame: SpriteAnimFrame = {
                texture: textureHandles.get(f.texture ?? '') ?? 0,
                duration: f.duration,
            };
            if (f.atlasFrame) {
                const af = f.atlasFrame;
                Object.assign(frame, uvFromRect(af, af.pageWidth, af.pageHeight));
            }
            return frame;
        }),
    };
}
