// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Tileset atlas extrusion for the asset import. Pure and deterministic —
 *        same pixels and grid, byte-identical output, so it composes with
 *        content-addressed staging like {@link atlasPacker}.
 *
 * A tile quad's UV rect must equal its geometry rect, and on a gapless atlas that
 * cannot hold together with no-bleed from UVs alone. Extrusion puts the no-bleed
 * guarantee in the DATA: every cell gets a border of copies of its own edge
 * pixels, so a stray sample reads what it would have clamped to.
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
 * One texel, because `GL_LINEAR` without mipmaps weights a 2x2 neighbourhood: a
 * sample inside a cell reaches at most one texel out. Mipmaps would need this to
 * grow with the chain (mip n reaches 2^n), which is why the renderer reads the
 * number off the asset rather than assuming it.
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
 * Rebuild `img` with `extrude` px of its own edge pixels around every cell, by
 * sampling each source cell at clamped coordinates — per-cell `CLAMP_TO_EDGE`,
 * which gets the corners right rather than as four more cases. Throws on a grid
 * describing no cells, rather than emitting a blank tileset.
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

    // margin = e, spacing = 2e is the only layout that works: every cell needs its
    // own e-px border, and two neighbours contribute one each to the gap.
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
