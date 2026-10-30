// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/layout/anchored-rect.ts
 * @brief   The data and the arithmetic of `RectAnchors`, with nothing of the ECS: an importer places a node the way the engine will
 *          without compiling the engine.
 */

/** Which edges are pinned: the flags of one axis are mutually exclusive between its edges and its centre. */
export const AnchorFlag = Object.freeze({ TOP: 1, MID: 2, BOTTOM: 4, LEFT: 8, CENTER: 16, RIGHT: 32, HORIZONTAL: 8 | 16 | 32, VERTICAL: 1 | 2 | 4 });
export const AnchorMode = Object.freeze({ ONCE: 0, ON_RESIZE: 1, ALWAYS: 2 });

export interface RectAnchorsData {
    /** The pinned edges, as {@link AnchorFlag} bits. Zero pins nothing. */
    alignFlags: number;
    /** Distance from each pinned edge of the parent rectangle: in layout units, or as a fraction of the parent's size (see the `isAbs…` flags). */
    left: number;
    right: number;
    top: number;
    bottom: number;
    /** Offset from the centre of the parent rectangle, for a centred axis. */
    horizontalCenter: number;
    verticalCenter: number;
    isAbsLeft: boolean;
    isAbsRight: boolean;
    isAbsTop: boolean;
    isAbsBottom: boolean;
    isAbsHorizontalCenter: boolean;
    isAbsVerticalCenter: boolean;
    /** When it aligns: {@link AnchorMode}. */
    alignMode: number;
    enabled: boolean;
}

/** The rectangle an anchored node aligns to, in the node's parent space: its edges and its centre. */
export interface Box { left: number; right: number; bottom: number; top: number }

const isStretchWidth = (flags: number): boolean => (flags & (AnchorFlag.LEFT | AnchorFlag.RIGHT)) === (AnchorFlag.LEFT | AnchorFlag.RIGHT);
const isStretchHeight = (flags: number): boolean => (flags & (AnchorFlag.TOP | AnchorFlag.BOTTOM)) === (AnchorFlag.TOP | AnchorFlag.BOTTOM);

/**
 * Where a rectangle goes, and how big, when pinned as @p a says inside @p target. Pure: the node's own size, pivot and scale in, its local
 * position and (when an axis is stretched) its size out. Rotation is ignored.
 */
export function anchoredRect(
    a: RectAnchorsData, target: Box,
    own: { width: number; height: number; pivotX: number; pivotY: number },
    scale: { x: number; y: number },
    position: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
    const targetW = target.right - target.left;
    const targetH = target.top - target.bottom;
    let { x, y } = position;
    let width = own.width;
    let height = own.height;

    if (a.alignFlags & AnchorFlag.HORIZONTAL) {
        const left = target.left + (a.isAbsLeft ? a.left : a.left * targetW);
        const right = target.right - (a.isAbsRight ? a.right : a.right * targetW);
        let pivot = own.pivotX;
        let sx = scale.x;
        if (sx < 0) { pivot = 1 - pivot; sx = -sx; }
        if (isStretchWidth(a.alignFlags)) {
            const span = right - left;
            if (sx !== 0) width = span / sx;
            x = left + pivot * span;
        } else {
            const span = own.width * sx;
            if (a.alignFlags & AnchorFlag.CENTER) {
                const offset = a.isAbsHorizontalCenter ? a.horizontalCenter : a.horizontalCenter * targetW;
                x = (target.left + targetW / 2) + (pivot - 0.5) * span + offset;
            } else if (a.alignFlags & AnchorFlag.LEFT) {
                x = left + pivot * span;
            } else {
                x = right + (pivot - 1) * span;
            }
        }
    }

    if (a.alignFlags & AnchorFlag.VERTICAL) {
        const bottom = target.bottom + (a.isAbsBottom ? a.bottom : a.bottom * targetH);
        const top = target.top - (a.isAbsTop ? a.top : a.top * targetH);
        let pivot = own.pivotY;
        let sy = scale.y;
        if (sy < 0) { pivot = 1 - pivot; sy = -sy; }
        if (isStretchHeight(a.alignFlags)) {
            const span = top - bottom;
            if (sy !== 0) height = span / sy;
            y = bottom + pivot * span;
        } else {
            const span = own.height * sy;
            if (a.alignFlags & AnchorFlag.MID) {
                const offset = a.isAbsVerticalCenter ? a.verticalCenter : a.verticalCenter * targetH;
                y = (target.bottom + targetH / 2) + (pivot - 0.5) * span + offset;
            } else if (a.alignFlags & AnchorFlag.BOTTOM) {
                y = bottom + pivot * span;
            } else {
                y = top + (pivot - 1) * span;
            }
        }
    }
    return { x, y, width, height };
}
