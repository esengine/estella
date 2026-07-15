// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Boundary test for the real videodec side module (pl_mpeg): decodes the
// checked-in MPEG-1 fixture (red→green→blue thirds, 64x32 @25fps, 3s, all-intra)
// and asserts frame pixels, timing, seek, loop and end-of-stream behavior.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { WASM_DIR } from './helpers/loadWasm';
import type { VideoWasmModule } from '../src/video/WasmVideoBackend';

const GLUE = resolve(WASM_DIR, 'videodec.js');
const BINARY = resolve(WASM_DIR, 'videodec.wasm');
const FIXTURE = resolve(__dirname, 'fixtures/rgb-64x32.esv');
const FLIP_FIXTURE = resolve(__dirname, 'fixtures/topwhite-64x32.esv');
const HAS_VIDEODEC = existsSync(BINARY);

const W = 64, H = 32;

let mod: VideoWasmModule;

function openFixture(path = FIXTURE): number {
    const bytes = readFileSync(path);
    const ptr = mod._malloc(bytes.length);
    mod.HEAPU8.set(bytes, ptr);
    return mod._es_video_open(ptr, bytes.length);
}

/** Center pixel [r,g,b,a] of the latest frame. */
function centerPixel(handle: number, out: number): number[] {
    expect(mod._es_video_frame_rgba(handle, out, W * H * 4)).toBe(1);
    const offset = out + ((H / 2) * W + W / 2) * 4;
    return Array.from(mod.HEAPU8.subarray(offset, offset + 4));
}

const expectColor = (px: number[], r: number, g: number, b: number) => {
    // BT.601 round-trips are not exact — allow slack.
    expect(Math.abs(px[0] - r)).toBeLessThan(30);
    expect(Math.abs(px[1] - g)).toBeLessThan(30);
    expect(Math.abs(px[2] - b)).toBeLessThan(30);
    expect(px[3]).toBe(255);
};

describe.skipIf(!HAS_VIDEODEC)('videodec side module (pl_mpeg)', () => {
    beforeAll(async () => {
        const factory = (await import(GLUE)).default;
        mod = await factory({ wasmBinary: readFileSync(BINARY) }) as VideoWasmModule;
    });

    it('opens the fixture and reports stream info', () => {
        const h = openFixture();
        expect(h).toBeGreaterThan(0);
        expect(mod._es_video_width(h)).toBe(W);
        expect(mod._es_video_height(h)).toBe(H);
        expect(mod._es_video_framerate(h)).toBe(25);
        // MPEG-PS duration is the span of PES packet PTS values; the trailing
        // packet covers the remaining frames, so it underreports the 3s clip.
        expect(mod._es_video_duration(h)).toBeGreaterThan(2);
        expect(mod._es_video_duration(h)).toBeLessThanOrEqual(3);
        mod._es_video_close(h);
    });

    it('rejects bytes that are not an MPEG stream', () => {
        const junk = new Uint8Array(256).fill(0x42);
        const ptr = mod._malloc(junk.length);
        mod.HEAPU8.set(junk, ptr);
        expect(mod._es_video_open(ptr, junk.length)).toBe(0);
    });

    it('decodes red, then green, then blue as time advances', () => {
        const h = openFixture();
        const out = mod._malloc(W * H * 4);

        expect(mod._es_video_advance(h, 0.05)).toBe(1);
        expectColor(centerPixel(h, out), 255, 0, 0);

        mod._es_video_advance(h, 1.0); // → ~1.05s: green third
        expectColor(centerPixel(h, out), 0, 255, 0);

        mod._es_video_advance(h, 1.0); // → ~2.05s: blue third
        expectColor(centerPixel(h, out), 0, 0, 255);

        mod._free(out);
        mod._es_video_close(h);
    });

    it('exact-seek lands on the right frame and reports the playhead', () => {
        const h = openFixture();
        const out = mod._malloc(W * H * 4);
        // Seek targets clamp to the PS-reported duration, so stay inside it.
        expect(mod._es_video_seek(h, 1.5)).toBe(1);
        expect(mod._es_video_time(h)).toBeCloseTo(1.5, 1);
        expectColor(centerPixel(h, out), 0, 255, 0);
        expect(mod._es_video_seek(h, 0.0)).toBe(1);
        expectColor(centerPixel(h, out), 255, 0, 0);
        mod._free(out);
        mod._es_video_close(h);
    });

    it('ends without loop, loops seamlessly with it', () => {
        const h = openFixture();
        mod._es_video_advance(h, 5.0);
        expect(mod._es_video_has_ended(h)).toBe(1);
        mod._es_video_close(h);

        const h2 = openFixture();
        const out = mod._malloc(W * H * 4);
        mod._es_video_set_loop(h2, 1);
        mod._es_video_advance(h2, 3.05); // wraps past the end
        expect(mod._es_video_has_ended(h2)).toBe(0);
        mod._es_video_advance(h2, 0.1); // back inside the red third
        expectColor(centerPixel(h2, out), 255, 0, 0);
        mod._free(out);
        mod._es_video_close(h2);
    });

    it('decodes two instances independently', () => {
        const a = openFixture();
        const b = openFixture();
        expect(a).not.toBe(b);
        const out = mod._malloc(W * H * 4);
        mod._es_video_advance(a, 2.5); // a → blue third
        mod._es_video_advance(b, 0.05); // b → red third
        expectColor(centerPixel(a, out), 0, 0, 255);
        expectColor(centerPixel(b, out), 255, 0, 0);
        mod._free(out);
        mod._es_video_close(a);
        mod._es_video_close(b);
    });

    it('emits bottom-first rows (white top half decodes into the LAST rows)', () => {
        const h = openFixture(FLIP_FIXTURE);
        const out = mod._malloc(W * H * 4);
        expect(mod._es_video_advance(h, 0.05)).toBe(1);
        expect(mod._es_video_frame_rgba(h, out, W * H * 4)).toBe(1);
        // Row 0 of the buffer is the image's BOTTOM row (black); the final row
        // is the TOP (white) — the flipY-off upload convention.
        const bottom = mod.HEAPU8[out + (W / 2) * 4];
        const top = mod.HEAPU8[out + ((H - 1) * W + W / 2) * 4];
        expect(bottom).toBeLessThan(40);
        expect(top).toBeGreaterThan(215);
        mod._free(out);
        mod._es_video_close(h);
    });
});
