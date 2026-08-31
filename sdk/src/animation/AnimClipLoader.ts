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

export const ANIM_CLIP_FORMAT_VERSION = '1.5';

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

/** A pair in the clip's own units — world units, which the engine authors at 1 = 1
 *  design pixel. Frame sizes and offsets are both in it. */
export interface AnimClipVec2 {
    x: number;
    y: number;
}

/**
 * Who owns `Sprite.size` while the clip plays. `'entity'` — the default, and what
 * every clip written before format 1.5 does — leaves the entity's size alone, so
 * every frame draws at that one size. `'frame'` hands size to the clip and each
 * frame draws at its own, which is what lets frames of DIFFERENT sizes share a clip.
 */
export type AnimClipSizing = 'entity' | 'frame';

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
    /**
     * What this frame draws at. Absent = its own natural size (its sheet cell, or
     * its texture's pixels), which is what an author almost always means.
     */
    size?: AnimClipVec2;
    /**
     * Shifts this frame's artwork away from the clip's anchor, in {@link size}'s
     * units, and folded into the frame's pivot at load. Units rather than a
     * normalized pivot because the same offset is the same visual shift on frames
     * of any size — a pivot is not.
     */
    offset?: AnimClipVec2;
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
    /** Who owns `Sprite.size` — see {@link AnimClipSizing}. Absent = `'entity'`. */
    frameSizing?: AnimClipSizing;
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
// Frame geometry — size and anchor
// =============================================================================

/**
 * Does this clip author anchors at all? True as soon as the clip OR any single
 * frame declares one. All-or-nothing on purpose: a clip that anchored only some
 * frames would leave the last override standing on the plain ones — the same
 * staleness the UV window has to reset away.
 *
 * An offset counts: it IS an anchor, written in units instead of fractions.
 */
export function animClipDrivesPivot(data: AnimClipAssetData): boolean {
    return data.pivot !== undefined
        || data.frames.some(f => f.pivot !== undefined || f.offset !== undefined);
}

/**
 * Does this clip own `Sprite.size`? The mode says so outright, an authored frame
 * size says so by existing — and so does an offset, which needs the size it is a
 * fraction of. Left to the entity, one clip on two entities would shift by two
 * different amounts, the very drift offsets exist to remove.
 */
export function animClipDrivesSize(data: AnimClipAssetData): boolean {
    return data.frameSizing === 'frame'
        || data.frames.some(f => f.size !== undefined || f.offset !== undefined);
}

/**
 * The size a frame renders at: its own override, else its natural size (the
 * caller's — a sheet cell, or the texture's pixels) — or `null` when the clip
 * does not own size, which leaves `Sprite.size` as the entity authored it.
 */
export function animClipFrameSize(
    data: AnimClipAssetData,
    frame: AnimClipFrameData,
    natural?: AnimClipVec2 | null,
): AnimClipVec2 | null {
    if (frame.size) return { x: frame.size.x, y: frame.size.y };
    if (!animClipDrivesSize(data)) return null;
    return natural ? { x: natural.x, y: natural.y } : null;
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
    size?: AnimClipVec2 | null,
): AnimClipPivotData | null {
    const base = frame.pivot
        ?? (animClipDrivesPivot(data) ? (data.pivot ?? DEFAULT_ANIM_CLIP_PIVOT) : null);
    if (!frame.offset) return base ? { x: base.x, y: base.y } : null;
    // Moving the artwork one way is the anchor moving the other. With no size to
    // divide by the shift is dropped rather than guessed; animClipDrivesSize is
    // what keeps that from happening on a clip that authors offsets.
    if (!size || size.x <= 0 || size.y <= 0) return base ? { x: base.x, y: base.y } : null;
    const b = base ?? DEFAULT_ANIM_CLIP_PIVOT;
    return { x: b.x - frame.offset.x / size.x, y: b.y - frame.offset.y / size.y };
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

/** A `{x,y}` in clip units, or undefined. `positive` rejects a zero/negative size,
 *  which would divide an offset by nothing and blank the sprite. */
function vec2Of(v: unknown, positive: boolean): AnimClipVec2 | undefined {
    const p = v as { x?: unknown; y?: unknown } | null | undefined;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return undefined;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
    if (positive && (p.x <= 0 || p.y <= 0)) return undefined;
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
        const frameSize = vec2Of(f.size, true);
        const frameOffset = vec2Of(f.offset, false);
        if (sheet && typeof f.cell === 'number' && Number.isInteger(f.cell) && f.cell >= 0) {
            frames.push({
                cell: f.cell,
                ...(duration !== undefined ? { duration } : {}),
                ...(framePivot ? { pivot: framePivot } : {}),
                ...(frameSize ? { size: frameSize } : {}),
                ...(frameOffset ? { offset: frameOffset } : {}),
            });
        } else if (typeof f.texture === 'string' && f.texture) {
            const frame: AnimClipFrameData = { texture: f.texture };
            if (duration !== undefined) frame.duration = duration;
            if (framePivot) frame.pivot = framePivot;
            if (frameSize) frame.size = frameSize;
            if (frameOffset) frame.offset = frameOffset;
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
    const sizing: AnimClipSizing | undefined = raw?.frameSizing === 'frame' ? 'frame'
        : raw?.frameSizing === 'entity' ? 'entity' : undefined;
    return {
        version: typeof raw?.version === 'string' ? raw.version : ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: posInt(raw?.fps, DEFAULT_FPS),
        loop: typeof raw?.loop === 'boolean' ? raw.loop : true,
        ...(clipPivot ? { pivot: clipPivot } : {}),
        ...(sizing ? { frameSizing: sizing } : {}),
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
        ...(asset.frameSizing ? { frameSizing: asset.frameSizing } : {}),
        ...(asset.sheet ? { sheet: { ...asset.sheet } } : {}),
        frames: asset.frames.map(f => ({
            ...f,
            ...(f.pivot ? { pivot: { ...f.pivot } } : {}),
            ...(f.size ? { size: { ...f.size } } : {}),
            ...(f.offset ? { offset: { ...f.offset } } : {}),
        })),
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

/**
 * A fresh clip over a sequence of per-frame textures — the shape a flipbook of
 * separate images is. Owns size from the start: images drawn at one shared size
 * is the thing an image sequence is authored to avoid.
 */
export function createAnimClipFromTextures(textures: string[]): AnimClipAssetData {
    return {
        version: ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: DEFAULT_FPS,
        loop: true,
        frameSizing: 'frame',
        frames: textures.filter(t => !!t).map(texture => ({ texture })),
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

/**
 * Bake a parsed clip into what the runtime plays. @p textureSizes carries each
 * frame texture's pixel size, which is the natural size of a per-texture frame —
 * without it a clip that owns size has nothing to fall back to and says so.
 */
export function parseAnimClipData(
    clipPath: string,
    data: AnimClipAssetData,
    textureHandles: Map<string, number>,
    textureSizes?: Map<string, AnimClipVec2>,
): SpriteAnimClip {
    const sheet = data.sheet;
    const cellCount = sheet ? animClipSheetCols(sheet) * animClipSheetRows(sheet) : 0;
    const drivesSize = animClipDrivesSize(data);
    let missingNatural = 0;
    const clip: SpriteAnimClip = {
        name: clipPath,
        fps: data.fps ?? DEFAULT_FPS,
        loop: data.loop ?? true,
        ...(data.events?.length ? { events: data.events.map(e => ({ frame: e.frame, name: e.name, data: e.data })) } : {}),
        frames: data.frames.map(f => {
            // Resolved once at load: at runtime a frame either carries the size and
            // anchor it renders with, or the clip authors none and playback leaves
            // the entity's own standing.
            const natural = sheet && f.cell !== undefined
                ? { x: sheet.cellWidth, y: sheet.cellHeight }
                : textureSizes?.get(f.texture ?? '');
            const size = animClipFrameSize(data, f, natural);
            if (drivesSize && !size) missingNatural++;
            const pivot = animClipFramePivot(data, f, size);
            if (sheet && f.cell !== undefined) {
                if (f.cell >= cellCount) {
                    log.warn('asset', `${clipPath}: frame cell ${f.cell} outside the ${cellCount}-cell sheet grid; clamped`);
                }
                const frame: SpriteAnimFrame = {
                    texture: textureHandles.get(sheet.texture) ?? 0,
                    duration: f.duration,
                    ...(pivot ? { pivot } : {}),
                    ...(size ? { size } : {}),
                    ...animClipCellUv(sheet, f.cell),
                };
                return frame;
            }
            const frame: SpriteAnimFrame = {
                texture: textureHandles.get(f.texture ?? '') ?? 0,
                duration: f.duration,
                ...(pivot ? { pivot } : {}),
                ...(size ? { size } : {}),
            };
            if (f.atlasFrame) {
                const af = f.atlasFrame;
                Object.assign(frame, uvFromRect(af, af.pageWidth, af.pageHeight));
            }
            return frame;
        }),
    };
    if (missingNatural > 0) {
        log.warn('asset', `${clipPath}: ${missingNatural} frame(s) own their size but no natural size was available; they draw at the entity's`);
    }
    return clip;
}
