// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An authored single-level KTX2 leaves the cook with a mip chain under its
 *        own level 0, and a second cook reads the encode back.
 *
 * The encoder is the real one; sdk/tests/basis-mip-chain-wasm.test.ts reads a
 * spliced chain back through the side module the runtime loads.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readKtx2Layout, wantsMipChain, halveRgba, spliceMipChain } from '../src/assets/ktx2Mips';
import { cookCached } from '../src/assets/cookCache';
import { cookAssets } from '../src/assets/cookAssets';

const SIDE = 64;
const work = mkdtempSync(path.join(tmpdir(), 'ktx2-mips-'));
afterAll(() => rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

type Encoder = typeof import('../../build-tools/basis/encoder.mjs');
let enc: Encoder;
let authored: Uint8Array;

beforeAll(async () => {
    enc = await import('../../build-tools/basis/encoder.mjs');
    const rgba = new Uint8Array(SIDE * SIDE * 4).map((_, i) => (i * 37) & 0xff);
    // What a KTX2 made elsewhere usually is: UASTC under zstd, one level.
    authored = await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: rgba, width: SIDE, height: SIDE },
        { mode: 'uastc', mipmaps: false, supercompress: true });
});

async function chainOf(source: Uint8Array): Promise<Uint8Array> {
    const layout = readKtx2Layout(source)!;
    const decoded = await enc.transcodeKtx2ToRgba(source);
    const half = halveRgba(decoded.pixels, decoded.width, decoded.height, layout.srgb);
    const below = await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: half.rgba, width: half.width, height: half.height },
        { mode: 'uastc', mipmaps: true, yFlip: false, uastcLevel: 0, supercompress: layout.scheme === 2 });
    return spliceMipChain(source, below);
}

describe('the chain under an authored level', () => {
    it('keeps level 0 byte for byte and adds every level down to 1x1', async () => {
        const src = readKtx2Layout(authored)!;
        expect(wantsMipChain(src)).toBe(true);
        const out = await chainOf(authored);
        const got = readKtx2Layout(out)!;
        expect(got.levels).toHaveLength(7);
        const bytesOf = (b: Uint8Array, l: { offset: number; length: number }) => b.subarray(l.offset, l.offset + l.length);
        expect(Buffer.from(bytesOf(out, got.levels[0])).equals(Buffer.from(bytesOf(authored, src.levels[0])))).toBe(true);
        expect(wantsMipChain(got)).toBe(false);
    });

    it('refuses levels whose supercompression differs from the base', async () => {
        const rgba = new Uint8Array(32 * 32 * 4).fill(128);
        const plain = await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: rgba, width: 32, height: 32 },
            { mode: 'uastc', mipmaps: true, supercompress: false });
        expect(() => spliceMipChain(authored, plain)).toThrow(/supercompression differs/);
    });
});

describe('halving an sRGB image', () => {
    it('averages light, not its encoding', () => {
        // Black and white side by side: half the light is 188 in sRGB, not 128.
        const px = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
        expect(halveRgba(px, 2, 2, true).rgba[0]).toBe(188);
        expect(halveRgba(px, 2, 2, false).rgba[0]).toBe(128);
    });
});

describe('the cook cache', () => {
    it('reads an encode back instead of redoing it', async () => {
        const root = mkdtempSync(path.join(work, 'cache-'));
        let made = 0;
        const produce = async () => { made++; return new Uint8Array([1, 2, 3]); };
        const first = await cookCached(root, [new Uint8Array([9]), 'k'], produce);
        const second = await cookCached(root, [new Uint8Array([9]), 'k'], produce);
        expect([first.hit, second.hit, made]).toEqual([false, true, 1]);
        expect([...second.bytes]).toEqual([1, 2, 3]);
        await cookCached(root, [new Uint8Array([9]), 'other'], produce);
        expect(made).toBe(2);
    });
});

describe('cooking an authored single-level KTX2', () => {
    it('ships it with a chain, and keeps the encode for the next cook', async () => {
        const r = mkdtempSync(path.join(work, 'project-'));
        const TEX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const SC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        mkdirSync(path.join(r, 't'), { recursive: true });
        mkdirSync(path.join(r, 's'), { recursive: true });
        writeFileSync(path.join(r, 't', 'wall.ktx2'), authored);
        writeFileSync(path.join(r, 't', 'wall.ktx2.meta'), JSON.stringify({ uuid: TEX, version: '2.0', type: 'texture', importer: {} }));
        writeFileSync(path.join(r, 's', 'main.esscene'), JSON.stringify({ version: '1.0', name: 's', entities: [
            { id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }));
        writeFileSync(path.join(r, 's', 'main.esscene.meta'), JSON.stringify({ uuid: SC, version: '2.0', type: 'scene', importer: {} }));

        const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', compressTextures: true });
        expect(res.warnings.filter((w) => w.includes('wall.ktx2'))).toEqual([]);
        const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as { entries: Array<{ uuid: string; path: string }> };
        const shipped = new Uint8Array(readFileSync(path.join(res.outDir, m.entries.find((e) => e.uuid === TEX)!.path)));
        expect(readKtx2Layout(shipped)!.levels).toHaveLength(7);
        expect(readdirSync(path.join(r, '.esengine', 'cache', 'cook'))).toHaveLength(1);
    }, 60_000);
});
