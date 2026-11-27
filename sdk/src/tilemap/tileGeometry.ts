// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileGeometry.ts
 * @brief   Orientation-aware tile-cell geometry mirroring the native TileGrid.
 *
 * The renderer draws each tile as a layer-local axis-aligned tileWidth×tileHeight quad;
 * only its CENTER moves per orientation (orthogonal / isometric / staggered /
 * hexagonal). {@link tileCellCenter} reproduces that center (layer-local, y-up —
 * the caller applies the layer's world Z rotation and origin), so the editor brush ghost lands
 * exactly where the runtime will draw the tile.
 *
 * The CELL itself is a rect (orthogonal), a diamond (isometric / staggered), or a
 * hexagon (hexagonal). {@link tileCellOutline} returns that polygon as offsets
 * around the center — the same shape for every cell — so the editor grid overlay
 * and shaped ghost draw the true cell boundary. One geometry seam drives both.
 */

// Grid orientation, single-sourced from the C++ ES_ENUM via the generated module:
// the number a cell placement switches on is the number the engine's grid uses.
export { TilemapOrientation, TilemapStaggerAxis, TilemapStaggerIndex } from '../wasm/wasm.generated';
import { TilemapOrientation } from '../wasm/wasm.generated';
import type { Quat, Vec3 } from '../types';

/** The layout inputs a cell placement needs — a subset of the TilemapLayer component. */
export interface TileGridParams {
    /** 0 orthogonal · 1 isometric · 2 staggered · 3 hexagonal. */
    orientation: number;
    tileWidth: number;
    tileHeight: number;
    /** Hex edge along the stagger axis, bounded by that tile dimension (0 → tileHeight/2). */
    hexSideLength?: number;
    /** staggerAxis === X: columns stagger (else rows). Staggered + hex. */
    staggerAxisX?: boolean;
    /** staggerIndex === Even carries the half-cell shift (else odd). Staggered + hex. */
    staggerIndexEven?: boolean;
}

export interface Vec2Like {
    x: number;
    y: number;
}

/** Whether a cell coordinate can cross the tilemap bindings without coercion. */
export function isTileCoordinate(value: number): boolean {
    return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

/** The grid origin and planar angle used by the tile renderer. The offset is layer-local. */
export function tileWorldFrame(position: Vec3, q: Quat, offset?: Vec2Like): Vec3 & { rotation: number } {
    // Mirror TilemapRenderPlugin's projection of the full quaternion onto the XY plane.
    const rotation = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    const x = offset?.x ?? 0, y = offset?.y ?? 0;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    return { x: position.x + cos * x - sin * y, y: position.y + sin * x + cos * y, z: position.z, rotation };
}

/** Convert world coordinates to the grid's local frame before passing them to the float grid. */
export function tileWorldToLocal(x: number, y: number, originX: number, originY: number, rotation: number): Vec2Like {
    const dx = x - originX, dy = y - originY;
    if (rotation === 0) return { x: dx, y: dy };
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

/** Layout without cell dimensions, for consumers that already receive tile width/height. */
export type TileGridLayout = Omit<TileGridParams, 'tileWidth' | 'tileHeight'>;

/** The effective hex side length: the authored value, or the regular-hex fallback (th/2). */
function hexSide(p: TileGridParams): number {
    const side = p.hexSideLength && p.hexSideLength > 0 ? p.hexSideLength : p.tileHeight * 0.5;
    return Math.min(side, p.staggerAxisX ? p.tileWidth : p.tileHeight);
}

/**
 * Cell center in layer-local pixels (y-up, origin at 0,0), matching native TileGrid.
 * Apply the layer's world rotation and position to obtain world coordinates.
 */
export function tileCellCenter(p: TileGridParams, tx: number, ty: number): Vec2Like {
    const hw = p.tileWidth * 0.5;
    const hh = p.tileHeight * 0.5;
    switch (p.orientation) {
        case TilemapOrientation.Isometric:
            return { x: (tx - ty) * hw, y: -(tx + ty) * hh };
        case TilemapOrientation.Staggered:
        case TilemapOrientation.Hexagonal: {
            const side = p.orientation === TilemapOrientation.Hexagonal ? hexSide(p) : 0;
            if (p.staggerAxisX) {
                const colW = (p.tileWidth + side) * 0.5;
                const staggered = ((tx & 1) !== 0) !== !!p.staggerIndexEven;
                return { x: tx * colW + hw, y: -(ty * p.tileHeight + (staggered ? hh : 0) + hh) };
            }
            const rowH = (p.tileHeight + side) * 0.5;
            const staggered = ((ty & 1) !== 0) !== !!p.staggerIndexEven;
            return { x: tx * p.tileWidth + (staggered ? hw : 0) + hw, y: -(ty * rowH + hh) };
        }
        default: // Orthogonal
            return { x: tx * p.tileWidth + hw, y: -(ty * p.tileHeight + hh) };
    }
}

/**
 * The cell outline as offsets around its center (y-up, world units) — the same polygon
 * for every cell of a given layout. Rect (orthogonal), diamond inscribed in the tile box
 * (isometric / staggered), or a Tiled hexagon whose flat edges (length = side) run along
 * the stagger axis (hexagonal). Draw it translated to each {@link tileCellCenter}.
 */
export function tileCellOutline(p: TileGridParams): Vec2Like[] {
    const hw = p.tileWidth * 0.5;
    const hh = p.tileHeight * 0.5;
    switch (p.orientation) {
        case TilemapOrientation.Isometric:
        case TilemapOrientation.Staggered:
            // Diamond: top, right, bottom, left.
            return [{ x: 0, y: hh }, { x: hw, y: 0 }, { x: 0, y: -hh }, { x: -hw, y: 0 }];
        case TilemapOrientation.Hexagonal: {
            const s = hexSide(p);
            const hs = s * 0.5;
            if (p.staggerAxisX) {
                // Flat-top hex: horizontal flat edges (length s) top and bottom, points left/right.
                return [
                    { x: -hs, y: hh }, { x: hs, y: hh }, { x: hw, y: 0 },
                    { x: hs, y: -hh }, { x: -hs, y: -hh }, { x: -hw, y: 0 },
                ];
            }
            // Pointy-top hex: vertical flat edges (length s) left and right, points top/bottom.
            return [
                { x: 0, y: hh }, { x: hw, y: hs }, { x: hw, y: -hs },
                { x: 0, y: -hh }, { x: -hw, y: -hs }, { x: -hw, y: hs },
            ];
        }
        default: // Orthogonal rect: tl, tr, br, bl (y-up).
            return [{ x: -hw, y: hh }, { x: hw, y: hh }, { x: hw, y: -hh }, { x: -hw, y: -hh }];
    }
}

/** True when the layout is anything other than a plain orthogonal square grid. */
export function isNonOrthogonal(orientation: number): boolean {
    return orientation !== TilemapOrientation.Orthogonal && orientation !== undefined;
}

/** True for the layouts that read the stagger axis/index (staggered + hexagonal). */
export function usesStagger(orientation: number): boolean {
    return orientation === TilemapOrientation.Staggered || orientation === TilemapOrientation.Hexagonal;
}

/** True for the hexagonal layout (the only one that reads the hex side length). */
export function isHexOrientation(orientation: number): boolean {
    return orientation === TilemapOrientation.Hexagonal;
}
