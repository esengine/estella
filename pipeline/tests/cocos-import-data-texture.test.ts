// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A PNG that keeps its colour under a clear alpha holds numbers (a weight map), and is told apart from a picture so it ships as it is.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeRgbaPng } from '../src/assets/atlasPacker';
import { hidesColorUnderClearAlpha } from '../src/import/cocos/importProject';

describe('a PNG that hides colour under a clear alpha', () => {
    let dir: string;
    const png = (name: string, texel: (i: number) => [number, number, number, number], width = 16, height = 16): string => {
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) rgba.set(texel(i), i * 4);
        const file = path.join(dir, name);
        writeFileSync(file, encodeRgbaPng(width, height, rgba));
        return file;
    };
    beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'cocos-data-texture-')); });
    afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    it('is a weight map: clear everywhere, with the weights laid out in the colour, and as big as a map', () => {
        const weights: Array<[number, number, number, number]> = [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [128, 128, 0, 0], [0, 128, 128, 0]];
        expect(hidesColorUnderClearAlpha(png('weights.png', (i) => weights[i % weights.length]!, 2048, 8))).toBe(true);
    });

    it('is not the mask of an effect: the same laid out, but small', () => {
        const weights: Array<[number, number, number, number]> = [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [128, 128, 0, 0]];
        expect(hidesColorUnderClearAlpha(png('mask.png', (i) => weights[i % weights.length]!))).toBe(false);
    });

    it('is not one when what lies under the clear is a single colour, as a painter leaves under a background', () => {
        expect(hidesColorUnderClearAlpha(png('white-bleed.png', () => [255, 255, 255, 0]))).toBe(false);
    });

    it('is not a picture: opaque, or clear with nothing under it', () => {
        expect(hidesColorUnderClearAlpha(png('opaque.png', () => [200, 120, 40, 255]))).toBe(false);
        expect(hidesColorUnderClearAlpha(png('empty.png', () => [0, 0, 0, 0]))).toBe(false);
    });

    it('is not a cutout: a few clear texels around a solid shape', () => {
        expect(hidesColorUnderClearAlpha(png('sprite.png', (i) => (i < 40 ? [0, 0, 0, 0] : [200, 120, 40, 255])))).toBe(false);
    });

    it('is not one when the file is not a PNG, or is missing', () => {
        const jpg = path.join(dir, 'x.png');
        writeFileSync(jpg, Buffer.from('not a png at all, not even close to one'));
        expect(hidesColorUnderClearAlpha(jpg)).toBe(false);
        expect(hidesColorUnderClearAlpha(path.join(dir, 'nowhere.png'))).toBe(false);
    });
});
