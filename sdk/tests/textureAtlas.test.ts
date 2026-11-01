// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Packing textures onto one canvas: where each lands, what uv rectangle shows it, and that a lost device draws it again.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const drawn: Array<{ pos: { x: number; y: number }; size: { x: number; y: number }; id: number }> = [];
let restored: (() => void) | null = null;
let texture = 500;

vi.mock('../src/render/draw', () => ({
    Draw: {
        begin: vi.fn(), end: vi.fn(), setBlendMode: vi.fn(), rect: vi.fn(),
        texture: (pos: { x: number; y: number }, size: { x: number; y: number }, id: number) => { drawn.push({ pos, size, id }); },
    },
}));
vi.mock('../src/render/renderer', () => ({
    deviceGeneration: () => 1,
    Renderer: { setViewport: vi.fn() },
    onDeviceRestored: (fn: () => void) => { restored = fn; return () => { restored = null; }; },
}));
vi.mock('../src/render/renderTexture', () => ({
    RenderTexture: {
        create: vi.fn(() => ({ texture, width: 0, height: 0 })),
        release: vi.fn(), begin: vi.fn(), end: vi.fn(), contentDrawn: vi.fn(),
    },
}));
const dims = new Map<number, { width: number; height: number }>();
vi.mock('../src/wasm/resourceManager', () => ({
    getTextureDimensions: (h: number) => dims.get(h) ?? null,
    getResourceManager: () => ({ getTextureGLId: (h: number) => h + 1000 }),
}));

import { packRects, TextureAtlas } from '../src/render/textureAtlas';

describe('packRects', () => {
    const overlap = (a: { x: number; y: number }, as: { width: number; height: number }, b: { x: number; y: number }, bs: { width: number; height: number }) =>
        a.x < b.x + bs.width && b.x < a.x + as.width && a.y < b.y + bs.height && b.y < a.y + as.height;

    it('keeps every picture inside the canvas and clear of the others', () => {
        const sizes = [{ width: 64, height: 64 }, { width: 32, height: 48 }, { width: 100, height: 20 }, { width: 17, height: 90 }, { width: 64, height: 64 }];
        const out = packRects(sizes, 512, 2);
        sizes.forEach((s, i) => {
            const p = out.places[i];
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.x + s.width).toBeLessThanOrEqual(out.width);
            expect(p.y + s.height).toBeLessThanOrEqual(out.height);
            for (let j = i + 1; j < sizes.length; j++) expect(overlap(p, s, out.places[j], sizes[j])).toBe(false);
        });
    });

    it('leaves the padding between neighbours', () => {
        const out = packRects([{ width: 10, height: 10 }, { width: 10, height: 10 }], 64, 4);
        const [a, b] = out.places;
        expect(Math.abs(a.x - b.x) >= 14 || Math.abs(a.y - b.y) >= 14).toBe(true);
    });

    it('picks the smallest power-of-two canvas that holds them', () => {
        const out = packRects([{ width: 30, height: 30 }], 2048, 0);
        expect([out.width, out.height]).toEqual([32, 32]);
    });

    it('grows past a single picture wider than the first guess', () => {
        const out = packRects([{ width: 200, height: 10 }, { width: 4, height: 4 }], 2048, 0);
        expect(out.width).toBeGreaterThanOrEqual(200);
    });

    it('refuses what does not fit, and a picture larger than the canvas', () => {
        expect(() => packRects([{ width: 600, height: 10 }], 512, 0)).toThrow(/do not fit/);
        expect(() => packRects(Array.from({ length: 5 }, () => ({ width: 256, height: 256 })), 512, 0)).toThrow(/do not fit/);
    });
});

describe('TextureAtlas.pack', () => {
    beforeEach(() => {
        drawn.length = 0;
        dims.clear();
        dims.set(1, { width: 64, height: 32 });
        dims.set(2, { width: 16, height: 16 });
        texture = 500;
    });

    it('gives each source a uv window measured from the bottom, like a sheet cell', () => {
        const atlas = TextureAtlas.pack([1, 2], { padding: 0 })!;
        for (const src of [1, 2]) {
            const e = atlas.get(src)!;
            expect(e.uvScale.x).toBeCloseTo(e.width / atlas.width, 9);
            expect(e.uvScale.y).toBeCloseTo(e.height / atlas.height, 9);
            expect(e.uvOffset.x).toBeCloseTo(e.x / atlas.width, 9);
            expect(e.uvOffset.y).toBeCloseTo(1 - (e.y + e.height) / atlas.height, 9);
        }
        expect(atlas.sprite(1).texture).toBe(500);
    });

    it('draws each source into its own rectangle, by the device id, with the vertical axis pointing up', () => {
        const atlas = TextureAtlas.pack([1, 2], { padding: 0 })!;
        expect(drawn.map((d) => d.id).sort()).toEqual([1001, 1002]);
        for (const d of drawn) {
            const e = atlas.get(d.id - 1000)!;
            expect(d.pos.x).toBeCloseTo(e.x + e.width / 2, 9);
            expect(d.pos.y).toBeCloseTo(atlas.height - e.y - e.height / 2, 9);
            expect(d.size).toEqual({ x: e.width, y: e.height });
        }
    });

    it('packs a handle given twice once', () => {
        const atlas = TextureAtlas.pack([2, 2, 2])!;
        expect(drawn).toHaveLength(1);
        expect(atlas.get(2)).toBeDefined();
    });

    it('draws again when the device comes back, and stops listening once released', () => {
        const atlas = TextureAtlas.pack([1, 2])!;
        drawn.length = 0;
        restored!();
        expect(drawn).toHaveLength(2);
        atlas.release();
        expect(restored).toBeNull();
    });

    it('says so for a handle with no size, a source it did not pack, and a renderer not up yet', () => {
        expect(() => TextureAtlas.pack([99])).toThrow(/no size/);
        const atlas = TextureAtlas.pack([1])!;
        expect(() => atlas.sprite(2)).toThrow(/not on this atlas/);
        texture = 0;
        expect(TextureAtlas.pack([1])).toBeNull();
    });
});
