// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileGeometry.ts
 * @brief   Orientation-aware tile-cell geometry — the single TS mirror of the C++
 *          placement math in TilemapRenderPlugin / TilemapSystem.
 *
 * The renderer always draws a tile as an axis-aligned tileWidth×tileHeight quad;
 * only its CENTER moves per orientation (orthogonal / isometric / staggered /
 * hexagonal). {@link tileCellCenter} reproduces that center (layer-local, y-up —
 * the caller adds the layer's world origin), so the editor brush ghost lands
 * exactly where the runtime will draw the tile.
 *
 * The CELL itself is a rect (orthogonal), a diamond (isometric / staggered), or a
 * hexagon (hexagonal). {@link tileCellOutline} returns that polygon as offsets
 * around the center — the same shape for every cell — so the editor grid overlay
 * and shaped ghost draw the true cell boundary. One geometry seam drives both.
 */

/** Grid orientation, values matching the C++ TilemapOrientation / tilemap::GridType. */
export enum TileOrientation {
    Orthogonal = 0,
    Isometric = 1,
    Staggered = 2,
    Hexagonal = 3,
}

/** The layout inputs a cell placement needs — a subset of the TilemapLayer component. */
export interface TileGridParams {
    /** 0 orthogonal · 1 isometric · 2 staggered · 3 hexagonal. */
    orientation: number;
    tileWidth: number;
    tileHeight: number;
    /** Hex edge length in px along the stagger axis (0 → tileHeight/2). Hex only. */
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

/** The effective hex side length: the authored value, or the regular-hex fallback (th/2). */
function hexSide(p: TileGridParams): number {
    return p.hexSideLength && p.hexSideLength > 0 ? p.hexSideLength : p.tileHeight * 0.5;
}

/**
 * The center of cell (tx, ty) in the layer's local space (y-up, layer origin at 0,0).
 * Add the layer entity's world position to get world coords. Mirrors the C++ renderer's
 * `(worldX, worldY)` per-tile center exactly, so a painted map and an imported one place
 * a given cell at the same point.
 */
export function tileCellCenter(p: TileGridParams, tx: number, ty: number): Vec2Like {
    const hw = p.tileWidth * 0.5;
    const hh = p.tileHeight * 0.5;
    switch (p.orientation) {
        case TileOrientation.Isometric:
            return { x: (tx - ty) * hw, y: -(tx + ty) * hh };
        case TileOrientation.Staggered:
        case TileOrientation.Hexagonal: {
            const side = p.orientation === TileOrientation.Hexagonal ? hexSide(p) : 0;
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
        case TileOrientation.Isometric:
        case TileOrientation.Staggered:
            // Diamond: top, right, bottom, left.
            return [{ x: 0, y: hh }, { x: hw, y: 0 }, { x: 0, y: -hh }, { x: -hw, y: 0 }];
        case TileOrientation.Hexagonal: {
            const s = Math.min(hexSide(p), p.tileHeight, p.tileWidth); // clamp so it stays inside the box
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
    return orientation !== TileOrientation.Orthogonal && orientation !== undefined;
}

/** True for the layouts that read the stagger axis/index (staggered + hexagonal). */
export function usesStagger(orientation: number): boolean {
    return orientation === TileOrientation.Staggered || orientation === TileOrientation.Hexagonal;
}

/** True for the hexagonal layout (the only one that reads the hex side length). */
export function isHexOrientation(orientation: number): boolean {
    return orientation === TileOrientation.Hexagonal;
}
