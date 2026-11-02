// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The texture canvas: a blank texture textures are pasted into at pixel positions from its top-left, and drawn again after a lost device.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const drawn: Array<{ pos: { x: number; y: number }; size: { x: number; y: number }; id: number }> = [];
const created: Array<{ width: number; height: number }> = [];
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
        create: vi.fn((o: { width: number; height: number }) => { created.push(o); return { texture, width: o.width, height: o.height }; }),
        release: vi.fn(), begin: vi.fn(), end: vi.fn(), contentDrawn: vi.fn(),
    },
}));
const dims = new Map<number, { width: number; height: number }>();
vi.mock('../src/wasm/resourceManager', () => ({
    getTextureDimensions: (h: number) => dims.get(h) ?? null,
    getResourceManager: () => ({ getTextureGLId: (h: number) => h + 1000 }),
}));

import { TextureCanvas } from '../src/render/textureCanvas';

describe('TextureCanvas', () => {
    beforeEach(() => {
        drawn.length = 0;
        created.length = 0;
        dims.clear();
        dims.set(1, { width: 64, height: 32 });
        dims.set(2, { width: 16, height: 16 });
        texture = 500;
    });

    it('is the size asked for, and hands out the texture a Sprite takes', () => {
        const canvas = TextureCanvas.create(256, 128)!;
        expect([canvas.width, canvas.height, canvas.texture]).toEqual([256, 128, 500]);
        expect(created).toEqual([{ width: 256, height: 128, depth: false, filter: 'linear' }]);
    });

    it('puts a picture with its top-left corner at (x, y) counted from the top, at its own size', () => {
        const canvas = TextureCanvas.create(256, 128)!;
        canvas.draw(1, 10, 20);
        expect(drawn).toEqual([{ pos: { x: 10 + 32, y: 128 - 20 - 16 }, size: { x: 64, y: 32 }, id: 1001 }]);
    });

    it('draws a stated size instead of the picture\'s own', () => {
        const canvas = TextureCanvas.create(100, 100)!;
        canvas.draw(2, 0, 0, 50, 30);
        expect(drawn[0].size).toEqual({ x: 50, y: 30 });
        expect(drawn[0].pos).toEqual({ x: 25, y: 100 - 15 });
    });

    it('draws everything pasted again when the device comes back, in order, and not what clear forgot', () => {
        const canvas = TextureCanvas.create(256, 128)!;
        canvas.draw(1, 0, 0);
        canvas.draw(2, 70, 0);
        drawn.length = 0;
        restored!();
        expect(drawn.map((d) => d.id)).toEqual([1001, 1002]);
        canvas.clear();
        drawn.length = 0;
        restored!();
        expect(drawn).toHaveLength(0);
    });

    it('stops listening once released', () => {
        TextureCanvas.create(8, 8)!.release();
        expect(restored).toBeNull();
    });

    it('says so for a handle with no size and a canvas with none, and is null while the renderer is not up', () => {
        const canvas = TextureCanvas.create(64, 64)!;
        expect(() => canvas.draw(99, 0, 0)).toThrow(/no size/);
        expect(() => TextureCanvas.create(0, 64)).toThrow(/needs a size/);
        texture = 0;
        expect(TextureCanvas.create(64, 64)).toBeNull();
    });
});
