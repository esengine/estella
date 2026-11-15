// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { encodeOversizeUastc, loadTextureEncoder, type BasisEncoderModule } from '../src/assets/textureCook';
import { readKtx2Layout, stackStrips } from '../src/assets/ktx2Mips';

let enc: BasisEncoderModule & { transcodeKtx2ToRgba(ktx2: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }> };

beforeAll(async () => { enc = (await loadTextureEncoder()).module as typeof enc; });

function picture(width: number, height: number): { rgba: Uint8Array; width: number; height: number } {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            rgba[i] = (x * 5 + y * 3) & 255;
            rgba[i + 1] = (Math.sin(x * 0.31) * Math.cos(y * 0.17) * 127 + 128) | 0;
            rgba[i + 2] = ((x ^ y) * 7) & 255;
            rgba[i + 3] = 255;
        }
    }
    return { rgba, width, height };
}

const whole = (img: ReturnType<typeof picture>, opts: { srgb: boolean; supercompress: boolean; mipmaps: boolean }): Promise<Uint8Array> =>
    enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: img.rgba, width: img.width, height: img.height }, { mode: 'uastc', ...opts });

describe('an image past what the encoder takes in one piece', () => {
    for (const supercompress of [false, true]) {
        it(`is encoded in strips and reads back as the same picture, ${supercompress ? 'under zstd' : 'plain'}`, async () => {
            const img = picture(96, 80);
            const opts = { srgb: false, supercompress, mipmaps: false };
            const stitched = await encodeOversizeUastc(enc, img, opts, 96 * 24);
            const layout = readKtx2Layout(stitched)!;
            expect([layout.width, layout.height, layout.levels.length]).toEqual([96, 80, 1]);
            const [a, b] = [await enc.transcodeKtx2ToRgba(stitched), await enc.transcodeKtx2ToRgba(await whole(img, opts))];
            expect([a.width, a.height]).toEqual([96, 80]);
            expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(true);
        });
    }

    it('keeps a whole mip chain under the stitched level', async () => {
        const img = picture(64, 64);
        const stitched = await encodeOversizeUastc(enc, img, { srgb: true, supercompress: true, mipmaps: true }, 64 * 16);
        const layout = readKtx2Layout(stitched)!;
        expect(layout.levels.length).toBe(7);
        expect(layout.srgb).toBe(true);
        const top = await enc.transcodeKtx2ToRgba(stitched);
        const plain = await enc.transcodeKtx2ToRgba(await whole(img, { srgb: true, supercompress: true, mipmaps: false }));
        expect(Buffer.from(top.pixels).equals(Buffer.from(plain.pixels))).toBe(true);
    });

    it('goes on in strips below the top while a level is still too large', async () => {
        const img = picture(64, 64);
        const stitched = await encodeOversizeUastc(enc, img, { srgb: false, supercompress: false, mipmaps: true }, 16 * 16);
        expect(readKtx2Layout(stitched)!.levels.length).toBe(7);
        expect((await enc.transcodeKtx2ToRgba(stitched)).width).toBe(64);
    });

    it('is the encoder\'s own answer where the image is within its limit', async () => {
        const img = picture(32, 32);
        const opts = { srgb: false, supercompress: true, mipmaps: false };
        expect(Buffer.from(await encodeOversizeUastc(enc, img, opts)).equals(Buffer.from(await whole(img, opts)))).toBe(true);
    });

    it('refuses strips that are not of one image', async () => {
        const opts = { srgb: false, supercompress: false, mipmaps: false };
        const [wide, narrow, chained] = [await whole(picture(32, 8), opts), await whole(picture(16, 8), opts), await whole(picture(32, 8), { ...opts, mipmaps: true })];
        expect(() => stackStrips([wide, narrow])).toThrow(/wide/);
        expect(() => stackStrips([wide, chained])).toThrow(/levels/);
        const ragged = await whole(picture(32, 6), opts);
        expect(() => stackStrips([ragged, wide])).toThrow(/block/);
    });
});
