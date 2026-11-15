// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { encodeRgbaPng } from '../src/assets/png';
import { drawImageFile } from '../src/image/imageFiles';

const text = (doc: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(doc));

function project(files: Record<string, Uint8Array>): { read: (path: string) => Promise<Uint8Array>; asked: string[] } {
    const asked: string[] = [];
    return {
        asked,
        read: async (path) => {
            asked.push(path);
            const bytes = files[path];
            if (!bytes) throw new Error(`no file at ${path}`);
            return bytes;
        },
    };
}

function pixel(png: Uint8Array, x: number, y: number): number[] {
    const image = PNG.sync.read(Buffer.from(png));
    return Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
}

const size = (png: Uint8Array): number[] => { const image = PNG.sync.read(Buffer.from(png)); return [image.width, image.height]; };

describe('a picture source drawn to a file', () => {
    it('writes the pixels the source draws, clear where it draws nothing', async () => {
        const { read } = project({ 'ui/plate.esimage': text({ size: [16, 8], layers: [{ id: 'bar', shape: 'rect', at: [2, 2], size: [8, 4], fill: '#ff0000' }] }) });
        const drawn = await drawImageFile('ui/plate.esimage', read);
        expect([drawn.width, drawn.height]).toEqual([16, 8]);
        expect(size(drawn.png)).toEqual([16, 8]);
        expect(pixel(drawn.png, 5, 3)).toEqual([255, 0, 0, 255]);
        expect(pixel(drawn.png, 13, 3)[3]).toBe(0);
        expect(drawn.layerBounds.bar).toEqual([2, 2, 8, 4]);
        expect(drawn.notes).toEqual([]);
    });

    it('lays it on a ground, half-clear colour mixed with it and the picture left opaque', async () => {
        const { read } = project({ 'a.esimage': text({ size: 8, layers: [{ shape: 'rect', at: [0, 0], size: [4, 8], fill: '#ffffff80' }] }) });
        const drawn = await drawImageFile('a.esimage', read, { on: '#000000' });
        expect(pixel(drawn.png, 6, 4)).toEqual([0, 0, 0, 255]);
        const mixed = pixel(drawn.png, 1, 4);
        expect(mixed[3]).toBe(255);
        expect(mixed[0]).toBeGreaterThan(120);
        expect(mixed[0]).toBeLessThan(136);
    });

    it('enlarges a part with hard pixels', async () => {
        const { read } = project({ 'a.esimage': text({ size: 8, layers: [{ shape: 'rect', at: [0, 0], size: [1, 1], fill: '#00ff00' }] }) });
        const drawn = await drawImageFile('a.esimage', read, { zoom: { x: 0, y: 0, w: 2, h: 2 } });
        const [w, h] = size(drawn.png);
        expect(w).toBe(h);
        expect(w).toBeGreaterThanOrEqual(512);
        expect(pixel(drawn.png, w / 4, h / 4)).toEqual([0, 255, 0, 255]);
        expect([drawn.width, drawn.height]).toEqual([8, 8]);
    });

    it('reads what the source lays in, and what that lays in, by project path', async () => {
        const dot = encodeRgbaPng(2, 2, new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]));
        const inner = { size: 4, layers: [{ id: 'p', shape: 'image', src: 'art/dot.png', at: [0, 0], size: [4, 4], guide: false }] };
        const outer = { size: 8, layers: [{ id: 'q', shape: 'image', src: 'ui/inner.esimage', at: [0, 0], size: [8, 8], guide: false }] };
        const { read, asked } = project({ 'ui/outer.esimage': text(outer), 'ui/inner.esimage': text(inner), 'art/dot.png': dot });
        const drawn = await drawImageFile('ui/outer.esimage', read);
        expect(asked).toEqual(['ui/outer.esimage', 'ui/inner.esimage', 'art/dot.png']);
        expect(pixel(drawn.png, 4, 4)).toEqual([0, 0, 255, 255]);
    });

    it('draws a surface map of a picture', async () => {
        const wall = { size: 16, material: { relief: 4 }, layers: [{ shape: 'rect', at: [0, 0], size: [16, 16], fill: '#808080' }] };
        const { read } = project({ 'wall.esimage': text(wall), 'wall_normal.esimage': text({ mapOf: 'wall.esimage', map: 'normal' }) });
        const drawn = await drawImageFile('wall_normal.esimage', read);
        expect(size(drawn.png)).toEqual([16, 16]);
        const flat = pixel(drawn.png, 8, 8);
        expect(flat[2]).toBeGreaterThan(250);
        expect(Math.abs(flat[0]! - 128)).toBeLessThanOrEqual(1);
    });

    it('passes on what a layer that drew nothing says', async () => {
        const { read } = project({ 'a.esimage': text({ size: 8, layers: [{ id: 'far', shape: 'rect', at: [40, 40], size: [4, 4], fill: '#ffffff' }] }) });
        expect((await drawImageFile('a.esimage', read)).notes.join('\n')).toMatch(/far draws nothing inside the picture/);
    });

    it('says why a picture with text is not drawn here', async () => {
        const { read } = project({ 'label.esimage': text({ size: 32, layers: [{ shape: 'text', text: 'HULL', at: [2, 20], fontSize: 12, fill: '#ffffff' }] }) });
        await expect(drawImageFile('label.esimage', read)).rejects.toThrow(/label\.esimage sets text, and this command has no fonts/);
    });

    it('says what is wrong with a source, and with a picture that is no PNG', async () => {
        const broken = project({ 'a.esimage': text({ size: 8, layers: [{ shape: 'rect', at: [0, 0], size: [4, 4], fill: 'red' }] }) });
        await expect(drawImageFile('a.esimage', broken.read)).rejects.toThrow(/must be #rgb/);
        const jpeg = project({ 'a.esimage': text({ size: 8, layers: [{ shape: 'image', src: 'photo.jpg', at: [0, 0], size: [8, 8] }] }), 'photo.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) });
        await expect(drawImageFile('a.esimage', jpeg.read)).rejects.toThrow(/photo\.jpg is laid in the picture and is not a PNG/);
    });
});
