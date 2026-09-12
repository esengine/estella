// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a `.aseprite` becomes — the claims a picture of the sheet cannot make.
 *
 * The fixtures are ENCODED (see ./asepriteWriter) rather than checked in as
 * binaries: a blob would make every expectation below a number nobody could check.
 *
 * What carries the import and is invisible in the result: that a frame is the
 * COMPOSITE of the layers the artist left on, that cell N of the sheet is frame
 * N of the file, and that a tag's direction survives as the order its clip plays.
 */
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { importAseprite, isAsepriteSource } from '../src/assets/asepriteImport';
import { writeAseprite, fill, type CelSpec, type FrameSpec } from './asepriteWriter';

/** The sheet, decoded — what a reader of the products actually gets. */
function sheetPixels(bytes: Uint8Array): { width: number; height: number; at: (x: number, y: number) => number[] } {
  const png = PNG.sync.read(Buffer.from(bytes));
  return {
    width: png.width,
    height: png.height,
    at: (x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)),
  };
}

// ---------------------------------------------------------------------------

describe('isAsepriteSource', () => {
  it('claims .aseprite and .ase, whatever the case, and nothing else', () => {
    expect(isAsepriteSource('art/Hero.ASEPRITE')).toBe(true);
    expect(isAsepriteSource('hero.ase')).toBe(true);
    expect(isAsepriteSource('hero.png')).toBe(false);
    expect(isAsepriteSource('aseprite')).toBe(false);
  });
});

describe('importAseprite', () => {
  it('composites the layers the artist left on, in stack order', () => {
    const doc = writeAseprite({
      width: 2, height: 1,
      layers: [{ name: 'bg' }, { name: 'fg' }, { name: 'off', visible: false }],
      frames: [{ duration: 100, cels: [
        { layer: 0, x: 0, y: 0, w: 2, h: 1, pixels: fill(2, 1, [255, 0, 0, 255]) },
        { layer: 1, x: 1, y: 0, w: 1, h: 1, pixels: fill(1, 1, [0, 0, 255, 255]) },
        { layer: 2, x: 0, y: 0, w: 2, h: 1, pixels: fill(2, 1, [0, 255, 0, 255]) },
      ] }],
    });
    const sheet = sheetPixels(importAseprite(doc, 'hero').sheet.bytes);
    expect(sheet.at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(sheet.at(1, 0)).toEqual([0, 0, 255, 255]);
  });

  it('blends a half-transparent layer the way the editor does', () => {
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'bg' }, { name: 'fg', opacity: 128 }],
      frames: [{ duration: 100, cels: [
        { layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [0, 0, 0, 255] },
        { layer: 1, x: 0, y: 0, w: 1, h: 1, pixels: [255, 255, 255, 255] },
      ] }],
    });
    // 128/255 of the way from black to white, rounded as Aseprite rounds it.
    expect(sheetPixels(importAseprite(doc, 'x').sheet.bytes).at(0, 0)).toEqual([128, 128, 128, 255]);
  });

  // Each pair is chosen so the answer differs from source-over: a mode agreeing with
  // plain stacking on its inputs is a case that would pass unimplemented.
  it.each([
    ['multiply', 1, 128, 128, [64, 64, 64]],
    ['screen', 2, 128, 128, [192, 192, 192]],
    ['difference', 10, 128, 128, [0, 0, 0]],
    ['addition', 16, 128, 128, [255, 255, 255]],
    ['darken', 4, 64, 200, [64, 64, 64]],
    ['lighten', 5, 200, 64, [200, 200, 200]],
  ])('composites a %s layer the way the editor does', (_name, blend, back, front, want) => {
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'bg' }, { name: 'fg', blend: blend as number }],
      frames: [{ duration: 100, cels: [
        { layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [back, back, back, 255] as number[] },
        { layer: 1, x: 0, y: 0, w: 1, h: 1, pixels: [front, front, front, 255] as number[] },
      ] }],
    });
    const px = sheetPixels(importAseprite(doc, 'x').sheet.bytes).at(0, 0);
    expect([px[0], px[1], px[2]]).toEqual(want);
  });

  it('hides everything inside a group the artist turned off', () => {
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [
        { name: 'shown', group: true, childLevel: 0 },
        { name: 'a', childLevel: 1 },
        { name: 'hidden', group: true, childLevel: 0, visible: false },
        { name: 'b', childLevel: 1 },
      ],
      frames: [{ duration: 100, cels: [
        { layer: 1, x: 0, y: 0, w: 1, h: 1, pixels: [10, 20, 30, 255] },
        { layer: 3, x: 0, y: 0, w: 1, h: 1, pixels: [200, 200, 200, 255] },
      ] }],
    });
    expect(sheetPixels(importAseprite(doc, 'x').sheet.bytes).at(0, 0)).toEqual([10, 20, 30, 255]);
  });

  it('lays frames out as sheet cells, in the order the clip addresses them', () => {
    const frame = (rgba: number[]): FrameSpec =>
      ({ duration: 50, cels: [{ layer: 0, x: 0, y: 0, w: 2, h: 2, pixels: fill(2, 2, rgba) }] });
    const doc = writeAseprite({
      width: 2, height: 2,
      layers: [{ name: 'a' }],
      frames: [frame([255, 0, 0, 255]), frame([0, 255, 0, 255]), frame([0, 0, 255, 255])],
    });
    const result = importAseprite(doc, 'walk');
    const sheet = sheetPixels(result.sheet.bytes);
    expect([sheet.width, sheet.height]).toEqual([6, 2]);
    expect(sheet.at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(sheet.at(2, 0)).toEqual([0, 255, 0, 255]);
    expect(sheet.at(4, 0)).toEqual([0, 0, 255, 255]);

    const clip = result.clips[0]!.data;
    expect(clip.sheet).toMatchObject({ cellWidth: 2, cellHeight: 2, margin: 0, spacing: 0, pageWidth: 6, pageHeight: 2 });
    expect(clip.frames.map((f) => f.cell)).toEqual([0, 1, 2]);
  });

  it('wraps to a second row rather than exceed the sheet width', () => {
    const frame = (): FrameSpec =>
      ({ duration: 50, cels: [{ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [1, 2, 3, 255] }] });
    const doc = writeAseprite({
      width: 2100, height: 1,
      layers: [{ name: 'a' }],
      frames: [frame(), frame()],
    });
    const result = importAseprite(doc, 'wide');
    expect([result.sheet.width, result.sheet.height]).toEqual([2100, 2]);
  });

  it('keeps each frame\'s own timing, in seconds', () => {
    const cel = (): CelSpec => ({ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [9, 9, 9, 255] });
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'a' }],
      frames: [{ duration: 100, cels: [cel()] }, { duration: 250, cels: [cel()] }],
    });
    expect(importAseprite(doc, 'x').clips[0]!.data.frames.map((f) => f.duration)).toEqual([0.1, 0.25]);
  });

  it('gives every tag its own clip, playing the direction the tag states', () => {
    const cel = (): CelSpec => ({ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [9, 9, 9, 255] });
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'a' }],
      frames: Array.from({ length: 4 }, () => ({ duration: 100, cels: [cel()] })),
      tags: [
        { name: 'walk', from: 0, to: 2, direction: 0 },
        { name: 'back', from: 0, to: 2, direction: 1 },
        { name: 'breathe', from: 0, to: 3, direction: 2 },
      ],
    });
    const clips = importAseprite(doc, 'hero').clips;
    expect(clips.map((c) => c.file)).toEqual(['hero_walk.esanim', 'hero_back.esanim', 'hero_breathe.esanim']);
    expect(clips[0]!.data.frames.map((f) => f.cell)).toEqual([0, 1, 2]);
    expect(clips[1]!.data.frames.map((f) => f.cell)).toEqual([2, 1, 0]);
    // A ping-pong turns around on its ends rather than repeating them.
    expect(clips[2]!.data.frames.map((f) => f.cell)).toEqual([0, 1, 2, 3, 2, 1]);
  });

  it('loops a tag that plays forever and stops one that counts its plays', () => {
    const cel = (): CelSpec => ({ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [9, 9, 9, 255] });
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'a' }],
      frames: [{ duration: 100, cels: [cel()] }],
      tags: [
        { name: 'idle', from: 0, to: 0, direction: 0, repeat: 0 },
        { name: 'hit', from: 0, to: 0, direction: 0, repeat: 1 },
      ],
    });
    const clips = importAseprite(doc, 'x').clips;
    expect(clips[0]!.data.loop).toBe(true);
    expect(clips[1]!.data.loop).toBe(false);
  });

  it('covers every frame with one clip when the file has no tags', () => {
    const cel = (): CelSpec => ({ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [9, 9, 9, 255] });
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'a' }],
      frames: [{ duration: 100, cels: [cel()] }, { duration: 100, cels: [cel()] }],
    });
    const clips = importAseprite(doc, 'idle').clips;
    expect(clips.map((c) => c.file)).toEqual(['idle.esanim']);
    expect(clips[0]!.data.frames.map((f) => f.cell)).toEqual([0, 1]);
  });

  it('resolves an indexed palette, and the transparent index it names', () => {
    const doc = writeAseprite({
      width: 3, height: 1, depth: 8, transparentIndex: 3,
      palette: [[0, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255], [1, 2, 3, 255]],
      layers: [{ name: 'a' }],
      frames: [{ duration: 100, cels: [{ layer: 0, x: 0, y: 0, w: 3, h: 1, pixels: [1, 2, 3] }] }],
    });
    const sheet = sheetPixels(importAseprite(doc, 'x').sheet.bytes);
    expect(sheet.at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(sheet.at(1, 0)).toEqual([0, 255, 0, 255]);
    // Index 3 is the sprite's transparent one — a hole, not the palette's colour.
    expect(sheet.at(2, 0)[3]).toBe(0);
  });

  it('paints the transparent index on a background layer, where it is a colour', () => {
    const doc = writeAseprite({
      width: 1, height: 1, depth: 8, transparentIndex: 0,
      palette: [[1, 2, 3, 255], [9, 9, 9, 255]],
      layers: [{ name: 'Background', background: true }],
      frames: [{ duration: 100, cels: [{ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [0] }] }],
    });
    expect(sheetPixels(importAseprite(doc, 'x').sheet.bytes).at(0, 0)).toEqual([1, 2, 3, 255]);
  });

  it('draws a linked cel with the pixels it links to', () => {
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'a' }],
      frames: [
        { duration: 100, cels: [{ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [7, 8, 9, 255] }] },
        { duration: 100, cels: [{ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [], linkTo: 0 }] },
      ],
    });
    const sheet = sheetPixels(importAseprite(doc, 'x').sheet.bytes);
    expect(sheet.at(0, 0)).toEqual([7, 8, 9, 255]);
    expect(sheet.at(1, 0)).toEqual([7, 8, 9, 255]);
  });

  it('asks for the import settings pixel art needs, and the grid it was cut on', () => {
    const doc = writeAseprite({
      width: 8, height: 16,
      layers: [{ name: 'a' }],
      frames: [{ duration: 100, cels: [{ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [1, 1, 1, 255] }] }],
    });
    expect(importAseprite(doc, 'x').settings).toEqual({
      filterMode: 'nearest', compress: false,
      sheet: { cellWidth: 8, cellHeight: 16, margin: 0, spacing: 0 },
    });
  });

  it('takes a slice pivot as the clip\'s anchor, in the clip\'s own space', () => {
    const doc = writeAseprite({
      width: 10, height: 20,
      layers: [{ name: 'a' }],
      frames: [{ duration: 100, cels: [{ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [1, 1, 1, 255] }] }],
      slices: [{ name: 'feet', x: 2, y: 4, w: 6, h: 12, pivot: { x: 3, y: 12 } }],
    });
    // The slice says the anchor is 5px across and 16px down from the top-left;
    // a clip anchors from the bottom-left, normalized.
    expect(importAseprite(doc, 'x').clips[0]!.data.pivot).toEqual({ x: 0.5, y: 0.2 });
  });

  it('says so when a tilemap layer cannot be composited', () => {
    const doc = writeAseprite({
      width: 1, height: 1,
      layers: [{ name: 'map', tilemap: true }],
      frames: [{ duration: 100, cels: [] }],
    });
    expect(importAseprite(doc, 'x').warnings.join(' ')).toMatch(/tilemap/i);
  });

  it('refuses a file that is not one', () => {
    expect(() => importAseprite(new Uint8Array(200), 'x')).toThrow(/not an Aseprite file/);
  });
});
