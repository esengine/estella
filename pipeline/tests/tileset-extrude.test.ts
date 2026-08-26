// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Tileset extrusion — the property is "a sample taken inside a cell never
 *        reads another cell", so the tests SAMPLE, with the same bilinear filter
 *        the GPU uses. A test that only compared sizes and border bytes would
 *        pass on an extruder that copied the right pixels to the wrong place.
 *
 *        Every claim about the extruded atlas is paired with the same
 *        measurement on the packed one, which must FAIL it — otherwise the
 *        measurement is not sensitive to the thing being fixed.
 */
import { describe, it, expect } from 'vitest';
import {
  extrudeTileset, gridCells, decodeRgbaPng, encodeRgbaPng, DEFAULT_EXTRUDE,
  type RgbaImage, type TilesetGrid,
} from '../src/assets/tilesetExtrude';

/** An atlas of solid cells, one distinct colour each — so "which cell did this pixel come from" is decidable. */
function solidCells(tileW: number, tileH: number, cols: number, rows: number,
                    margin = 0, spacing = 0): RgbaImage {
  const width = 2 * margin + cols * tileW + (cols - 1) * spacing;
  const height = 2 * margin + rows * tileH + (rows - 1) * spacing;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = row * cols + col + 1;
      for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x++) {
          const px = margin + col * (tileW + spacing) + x;
          const py = margin + row * (tileH + spacing) + y;
          const i = (py * width + px) * 4;
          rgba[i] = id * 20; rgba[i + 1] = 255 - id * 20; rgba[i + 2] = id; rgba[i + 3] = 255;
        }
      }
    }
  }
  return { width, height, rgba };
}

/** GL_LINEAR with CLAMP_TO_EDGE, in texel units: texel (i,j) is centred at (i+0.5, j+0.5). */
function bilinear(img: RgbaImage, u: number, v: number): [number, number, number, number] {
  const fx = u - 0.5, fy = v - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const at = (x: number, y: number, c: number) => {
    const cx = Math.min(img.width - 1, Math.max(0, x));
    const cy = Math.min(img.height - 1, Math.max(0, y));
    return img.rgba[(cy * img.width + cx) * 4 + c]!;
  };
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx;
    const b = at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

describe('extrudeTileset — layout', () => {
  it('repacks to margin = extrude, spacing = 2 * extrude', () => {
    const src = solidCells(8, 8, 3, 2);
    const out = extrudeTileset(src, { tileWidth: 8, tileHeight: 8, margin: 0, spacing: 0 });
    expect(out.extrude).toBe(DEFAULT_EXTRUDE);
    expect(out.margin).toBe(1);
    expect(out.spacing).toBe(2);
    expect(out.columns).toBe(3);
    expect(out.rows).toBe(2);
    expect(out.width).toBe(3 * (8 + 2));
    expect(out.height).toBe(2 * (8 + 2));
  });

  it('the layout it writes is the one the engine reads back', () => {
    // The renderer locates cell (col,row) from margin/spacing alone. If the
    // repack and that arithmetic disagree, every tile samples its neighbour.
    const src = solidCells(6, 10, 4, 3, 2, 4);
    const out = extrudeTileset(src, { tileWidth: 6, tileHeight: 10, margin: 2, spacing: 4 });
    const cells = gridCells(out, { tileWidth: 6, tileHeight: 10, margin: out.margin, spacing: out.spacing });
    expect(cells).toEqual({ columns: 4, rows: 3 });
  });

  it('keeps the cell body byte-identical — extrusion adds a border, it does not resample', () => {
    const src = solidCells(5, 7, 2, 2, 1, 3);
    const grid: TilesetGrid = { tileWidth: 5, tileHeight: 7, margin: 1, spacing: 3 };
    const out = extrudeTileset(src, grid);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 5; x++) {
            const s = ((1 + row * (7 + 3) + y) * src.width + 1 + col * (5 + 3) + x) * 4;
            const d = ((row * 9 + 1 + y) * out.width + col * 7 + 1 + x) * 4;
            expect([out.rgba[d], out.rgba[d + 1], out.rgba[d + 2], out.rgba[d + 3]])
              .toEqual([src.rgba[s], src.rgba[s + 1], src.rgba[s + 2], src.rgba[s + 3]]);
          }
        }
      }
    }
  });

  it('refuses a grid that describes no cells rather than emitting a blank atlas', () => {
    const src = solidCells(8, 8, 1, 1);
    expect(() => extrudeTileset(src, { tileWidth: 64, tileHeight: 64, margin: 0, spacing: 0 }))
      .toThrow(/no cells/);
  });

  it('is deterministic — the same pixels give the same bytes', () => {
    const src = solidCells(4, 4, 3, 3);
    const grid: TilesetGrid = { tileWidth: 4, tileHeight: 4, margin: 0, spacing: 0 };
    const a = extrudeTileset(src, grid);
    const b = extrudeTileset(src, grid);
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
    expect(Buffer.from(encodeRgbaPng(a.width, a.height, a.rgba))
      .equals(Buffer.from(encodeRgbaPng(b.width, b.height, b.rgba)))).toBe(true);
  });

  it('survives a PNG round trip', () => {
    const src = solidCells(8, 8, 2, 2);
    const out = extrudeTileset(src, { tileWidth: 8, tileHeight: 8, margin: 0, spacing: 0 });
    const back = decodeRgbaPng(encodeRgbaPng(out.width, out.height, out.rgba));
    expect(back.width).toBe(out.width);
    expect(back.height).toBe(out.height);
    expect(Buffer.from(back.rgba).equals(Buffer.from(out.rgba))).toBe(true);
  });
});

describe('extrudeTileset — the property the seam came from', () => {
  const TILE = 8, COLS = 3, ROWS = 3;

  /** Sample right across a cell's exact rect and report every colour seen. */
  function sweepCell(img: RgbaImage, x0: number, y0: number, w: number, h: number): Set<string> {
    const seen = new Set<string>();
    const STEPS = 40;
    for (let i = 0; i <= STEPS; i++) {
      for (let j = 0; j <= STEPS; j++) {
        const c = bilinear(img, x0 + (i / STEPS) * w, y0 + (j / STEPS) * h);
        seen.add(c.map((v) => Math.round(v)).join(','));
      }
    }
    return seen;
  }

  it('a sample anywhere in an extruded cell reads only that cell', () => {
    const src = solidCells(TILE, TILE, COLS, ROWS);
    const out = extrudeTileset(src, { tileWidth: TILE, tileHeight: TILE, margin: 0, spacing: 0 });
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const id = row * COLS + col + 1;
        const want = [id * 20, 255 - id * 20, id, 255].join(',');
        const seen = sweepCell(out, col * (TILE + 2) + 1, row * (TILE + 2) + 1, TILE, TILE);
        expect([...seen]).toEqual([want]);
      }
    }
  });

  it('...and the same sweep on the PACKED atlas does not — so the sweep can tell them apart', () => {
    const src = solidCells(TILE, TILE, COLS, ROWS);
    // The interior cell is surrounded on all four sides, so it is the one a
    // gapless atlas must fail on.
    const seen = sweepCell(src, 1 * TILE, 1 * TILE, TILE, TILE);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('extrudeTileset — the seam itself, as the renderer draws it', () => {
  /**
   * Two cells of art continuous across their shared edge — a wall of tiles meant
   * to butt together, which is the shape a seam shows on. Draws a scanline the
   * way TilemapRenderPlugin does. Dropping the inset without extruding measures
   * perfectly HERE only because this atlas's neighbour is also the map's.
   */
  const TILE = 8, COLS = 2, SCALE = 6.0;

  function ramp(): RgbaImage {
    const width = COLS * TILE, height = TILE;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = x * 16; rgba[i + 1] = x * 16; rgba[i + 2] = x * 16; rgba[i + 3] = 255;
      }
    }
    return { width, height, rgba };
  }

  /** One scanline of the two quads, `inset` texels in from each cell edge. */
  function scanline(img: RgbaImage, cellX: (c: number) => number, inset: number, vRow: number): number[] {
    const out: number[] = [];
    for (let c = 0; c < COLS; c++) {
      const uMin = cellX(c) + inset;
      const uMax = cellX(c) + TILE - inset;
      const quadWidth = TILE * SCALE;
      for (let p = 0; p < quadWidth; p++) {
        const s = (p + 0.5) / quadWidth;
        out.push(bilinear(img, uMin + s * (uMax - uMin), vRow)[0]);
      }
    }
    return out;
  }

  /** What a single un-tiled image of the same ramp would have produced. */
  function ideal(img: RgbaImage, vRow: number): number[] {
    const out: number[] = [];
    for (let p = 0; p < COLS * TILE * SCALE; p++) {
      out.push(bilinear(img, (p + 0.5) / SCALE, vRow)[0]);
    }
    return out;
  }

  /** Worst departure from the art over a span of the scanline. */
  function worstOver(line: number[], want: number[], lo: number, hi: number): number {
    return Math.max(...line.slice(lo, hi).map((v, i) => Math.abs(v - want[lo + i]!)));
  }

  const N = COLS * TILE * SCALE;
  const BOUNDARY = TILE * SCALE;          // first screen px of cell 1
  const EDGE = Math.ceil(0.5 * SCALE);    // the outer half-texel, in screen px

  it('THE FIX: the tile interior becomes exact, where the inset was wrong everywhere', () => {
    const src = ramp();
    const out = extrudeTileset(src, { tileWidth: TILE, tileHeight: TILE, margin: 0, spacing: 0 });
    const want = ideal(src, 2);
    // The extruded row-0 body starts one px down, so the same art row is v + 1.
    const extruded = scanline(out, (c) => c * (TILE + 2) + 1, 0, 3);
    const inset = scanline(src, (c) => c * TILE, 0.5, 2);
    const interior = (l: number[]) => Math.max(
      worstOver(l, want, EDGE, BOUNDARY - EDGE),
      worstOver(l, want, BOUNDARY + EDGE, N - EDGE));

    expect(interior(extruded)).toBeLessThan(1e-9);   // f64 residue in the test's own filter, not a departure
    // Not a near miss: the inset displaces the art by up to a full texel, and it
    // does so across the WHOLE tile, not just at its edges. That ramp of error
    // is what made a boundary read as a break in the pattern.
    expect(interior(inset)).toBeGreaterThan(6);
  });

  it('what extrusion does NOT do: the filter still stops at the tile boundary', () => {
    // The map's next tile is not the atlas's next cell, so no atlas layout lets the
    // filter blend across a tile edge — the border clamps, leaving one texel of
    // step. A residual, not a defect, and smaller than the inset's.
    const src = ramp();
    const out = extrudeTileset(src, { tileWidth: TILE, tileHeight: TILE, margin: 0, spacing: 0 });
    const step = (l: number[]) => Math.abs(l[BOUNDARY]! - l[BOUNDARY - 1]!);
    const extruded = scanline(out, (c) => c * (TILE + 2) + 1, 0, 3);
    const inset = scanline(src, (c) => c * TILE, 0.5, 2);

    expect(step(extruded)).toBeCloseTo(16, 5);          // exactly one texel of the ramp
    expect(step(inset)).toBeGreaterThan(step(extruded));
    // A camera that lands tiles on whole pixels removes even this one; that is a
    // property of the camera, not of the atlas. See Camera.pixelPerfect.
  });

  it('why not simply drop the inset: a packed atlas then reads the next cell', () => {
    // The mode that measured perfectly on a ramp does so only because the ramp's
    // atlas neighbour IS its map neighbour. Give the two cells unrelated content
    // and the exact rect on a packed atlas pulls one into the other.
    const width = COLS * TILE, height = TILE;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = x < TILE ? 0 : 255;             // cell 0 black, cell 1 white
        rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
      }
    }
    const src: RgbaImage = { width, height, rgba };
    const out = extrudeTileset(src, { tileWidth: TILE, tileHeight: TILE, margin: 0, spacing: 0 });

    const packedExact = scanline(src, (c) => c * TILE, 0, 2);
    const extruded = scanline(out, (c) => c * (TILE + 2) + 1, 0, 3);
    // Cell 0 is solid black. Anything above 0 in its span came from cell 1.
    expect(Math.max(...packedExact.slice(0, BOUNDARY))).toBeGreaterThan(0);
    expect(Math.max(...extruded.slice(0, BOUNDARY))).toBe(0);
  });
});
