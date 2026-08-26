// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Tileset atlas extrusion for the asset import. Pure and deterministic:
 *        the same pixels and grid produce byte-identical output, so it composes
 *        with content-addressed staging exactly like {@link atlasPacker}.
 *
 * WHY THIS EXISTS. A tile quad's UV rect and its geometry rect must be the same
 * rect, or the tile's texture is stretched and the sampling phase resets at every
 * cell boundary — a visible seam on a wall of repeated tiles, and one that moves
 * as the camera does, because which boundary lands mid-pixel keeps changing.
 * The renderer used to buy no-bleed by insetting the UV half a texel per edge,
 * which is exactly that stretch: the sampled rect lost a whole texel while the
 * quad kept the full tile.
 *
 * On a gapless atlas the two cannot both hold from UVs alone. Extrusion removes
 * the conflict from the DATA instead: give every cell a border made of copies of
 * its own edge pixels, and a sample that strays outside the cell reads the value
 * it would have clamped to anyway. The renderer then sends the exact cell rect
 * and insets nothing.
 *
 * The output is a repack, not an edit in place: cells move to `margin = extrude`,
 * `spacing = 2 * extrude`, which is the only layout where every cell gets its own
 * border regardless of what the source spacing was.
 */
import { PNG } from 'pngjs';
import { atlasCells } from '../../../sdk/src/tilemap/tilesetResolve';

/** Raw RGBA8, row 0 = image top. Structurally an `AtlasInputImage` without the key. */
export interface RgbaImage {
    width: number;
    height: number;
    /** RGBA8, width*height*4 bytes. */
    rgba: Uint8Array;
}

/** Where an atlas's cells are, in the source image's own pixels (Tiled's model). */
export interface TilesetGrid {
    tileWidth: number;
    tileHeight: number;
    /** Border before the first cell, on every side. */
    margin: number;
    /** Gap between adjacent cells. */
    spacing: number;
    /** Cells per row. 0 or absent → derived from the image width. */
    columns?: number;
}

/** An extruded atlas plus the grid that now describes it. */
export interface ExtrudedTileset extends RgbaImage {
    /** Always `extrude` — the border every cell now carries. */
    margin: number;
    /** Always `2 * extrude` — one border from each of the two cells it separates. */
    spacing: number;
    extrude: number;
    columns: number;
    rows: number;
}

/**
 * ONE texel is enough, and the reason is a property of the filter rather than of
 * the art: `GL_LINEAR` without mipmaps weights a 2x2 texel neighbourhood, so a
 * sample taken anywhere inside a cell reaches at most one texel outside it.
 * A tileset that ever gains mipmaps needs this to grow with the chain — mip n
 * reaches 2^n texels — which is why the renderer reads the number back off the
 * asset instead of assuming it.
 */
export const DEFAULT_EXTRUDE = 1;

/**
 * The cells `grid` describes in an image of this size. Asks the SDK's
 * `atlasCells` rather than repeating the arithmetic: the engine skips a tile
 * whose cell the atlas does not hold, and it must skip the same ones.
 */
export function gridCells(img: RgbaImage, grid: TilesetGrid): { columns: number; rows: number } {
    const wide = atlasCells(img.width, grid.margin, grid.tileWidth, grid.spacing);
    const tall = atlasCells(img.height, grid.margin, grid.tileHeight, grid.spacing);
    // An authored column count may be NARROWER than the image (a tileset that
    // uses the left part of a sheet); it may not be wider, or ids would address
    // cells with no texels. The engine clamps the same way.
    const columns = grid.columns && grid.columns > 0 ? Math.min(grid.columns, wide) : wide;
    return { columns, rows: tall };
}

/**
 * Rebuild `img` with `extrude` px of its own edge pixels around every cell.
 *
 * Each output cell block is filled by sampling the source cell at clamped
 * coordinates — which IS per-cell `CLAMP_TO_EDGE`, and gets the four corners
 * right for free rather than as four more cases.
 *
 * Throws on a grid that describes no cells: an atlas that silently extruded to
 * nothing would ship a blank tileset, and the caller can still choose to leave
 * the texture alone.
 */
export function extrudeTileset(
    img: RgbaImage,
    grid: TilesetGrid,
    extrude: number = DEFAULT_EXTRUDE,
): ExtrudedTileset {
    const e = Math.max(0, Math.floor(extrude));
    const { columns, rows } = gridCells(img, grid);
    if (columns <= 0 || rows <= 0) {
        throw new Error(
            `tileset grid describes no cells: ${img.width}x${img.height} px, `
            + `tile ${grid.tileWidth}x${grid.tileHeight}, margin ${grid.margin}, spacing ${grid.spacing}`);
    }

    const cellW = grid.tileWidth + 2 * e;
    const cellH = grid.tileHeight + 2 * e;
    const outW = columns * cellW;
    const outH = rows * cellH;
    const out = new Uint8Array(outW * outH * 4);

    for (let row = 0; row < rows; row++) {
        const srcY0 = grid.margin + row * (grid.tileHeight + grid.spacing);
        const dstY0 = row * cellH;
        for (let col = 0; col < columns; col++) {
            const srcX0 = grid.margin + col * (grid.tileWidth + grid.spacing);
            const dstX0 = col * cellW;
            for (let oy = 0; oy < cellH; oy++) {
                const sy = srcY0 + clamp(oy - e, 0, grid.tileHeight - 1);
                for (let ox = 0; ox < cellW; ox++) {
                    const sx = srcX0 + clamp(ox - e, 0, grid.tileWidth - 1);
                    const s = (sy * img.width + sx) * 4;
                    const d = ((dstY0 + oy) * outW + dstX0 + ox) * 4;
                    out[d] = img.rgba[s]!;
                    out[d + 1] = img.rgba[s + 1]!;
                    out[d + 2] = img.rgba[s + 2]!;
                    out[d + 3] = img.rgba[s + 3]!;
                }
            }
        }
    }

    // margin = e and spacing = 2e is not a choice among layouts, it is the only
    // one: every cell needs its own e-px border, and two neighbours contribute
    // one each to the gap between them.
    return { width: outW, height: outH, rgba: out, margin: e, spacing: 2 * e, extrude: e, columns, rows };
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Decode a PNG into the extruder's input shape. */
export function decodeRgbaPng(png: Uint8Array): RgbaImage {
    const decoded = PNG.sync.read(Buffer.from(png));
    return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
}

/** Encode raw RGBA8 (row 0 = top) to PNG bytes. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
    const png = new PNG({ width, height });
    Buffer.from(rgba).copy(png.data);
    return new Uint8Array(PNG.sync.write(png));
}
