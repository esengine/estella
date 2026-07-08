// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Texture-atlas packer for the asset cook. Pure and deterministic: the
 *        same inputs produce byte-identical pages, so atlas packing composes
 *        with content-addressed staging. Shelf packing over height-sorted
 *        input; images that overflow one page spill onto the next.
 *
 * The pack core is dependency-free (raw RGBA in, raw RGBA out); PNG decode/
 * encode live in thin wrappers so the algorithm stays unit-testable without
 * pixel fixtures.
 */
import { PNG } from 'pngjs';

export interface AtlasInputImage {
    /** Stable identity (the project-relative texture path). */
    key: string;
    width: number;
    height: number;
    /** RGBA8, width*height*4 bytes, row 0 = image top. */
    rgba: Uint8Array;
}

export interface AtlasPlacement {
    key: string;
    /** Pixel rect inside the page, y from the page TOP (image space). */
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface AtlasPage {
    width: number;
    height: number;
    placements: AtlasPlacement[];
    /** Composed RGBA8 page pixels (row 0 = top). */
    rgba: Uint8Array;
}

export interface PackOptions {
    /** Page dimension cap (default 2048). */
    maxSize?: number;
    /** Transparent gutter around each image, defends linear-filter bleed (default 2). */
    padding?: number;
}

interface Shelf { y: number; height: number; x: number; }

/** Shelf-pack `sorted` into one width×height page; null when anything overflows. */
function tryPackPage(
    sorted: AtlasInputImage[],
    width: number,
    height: number,
    padding: number,
): AtlasPlacement[] | null {
    const shelves: Shelf[] = [];
    let yCursor = 0;
    const placements: AtlasPlacement[] = [];
    for (const img of sorted) {
        const w = img.width + padding * 2;
        const h = img.height + padding * 2;
        if (w > width || h > height) return null;
        let placed = false;
        for (const shelf of shelves) {
            if (h <= shelf.height && shelf.x + w <= width) {
                placements.push({ key: img.key, x: shelf.x + padding, y: shelf.y + padding, width: img.width, height: img.height });
                shelf.x += w;
                placed = true;
                break;
            }
        }
        if (!placed) {
            if (yCursor + h > height) return null;
            shelves.push({ y: yCursor, height: h, x: w });
            placements.push({ key: img.key, x: padding, y: yCursor + padding, width: img.width, height: img.height });
            yCursor += h;
        }
    }
    return placements;
}

/** Smallest power of two ≥ n (n ≥ 1). */
function nextPow2(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

function composePage(images: Map<string, AtlasInputImage>, placements: AtlasPlacement[], width: number, height: number): AtlasPage {
    const rgba = new Uint8Array(width * height * 4);
    for (const p of placements) {
        const img = images.get(p.key)!;
        for (let row = 0; row < p.height; row++) {
            const src = row * img.width * 4;
            const dst = ((p.y + row) * width + p.x) * 4;
            rgba.set(img.rgba.subarray(src, src + p.width * 4), dst);
        }
    }
    return { width, height, placements, rgba };
}

/**
 * Pack images into as few pages as possible. Pages are square powers of two:
 * the smallest that fits everything remaining, capped at maxSize; when even a
 * maxSize page cannot hold all remaining images it takes as many as fit (in
 * order) and the rest spill onto the next page. Input order does not matter —
 * images are sorted (height desc, then key) for deterministic, well-packed
 * output.
 */
export function packAtlas(images: AtlasInputImage[], options: PackOptions = {}): AtlasPage[] {
    const maxSize = options.maxSize ?? 2048;
    const padding = options.padding ?? 2;
    const byKey = new Map(images.map((i) => [i.key, i]));
    if (byKey.size !== images.length) throw new Error('packAtlas: duplicate image keys');

    let remaining = [...images].sort((a, b) => (b.height - a.height) || a.key.localeCompare(b.key));
    for (const img of remaining) {
        const needed = Math.max(img.width, img.height) + padding * 2;
        if (needed > maxSize) {
            throw new Error(`packAtlas: '${img.key}' (${img.width}x${img.height}) exceeds the ${maxSize} page cap`);
        }
    }

    const pages: AtlasPage[] = [];
    while (remaining.length > 0) {
        // Grow a square page until everything remaining fits (or we hit the cap).
        let size = nextPow2(Math.max(
            remaining[0].height + padding * 2,
            Math.max(...remaining.map((i) => i.width)) + padding * 2,
        ));
        let placements: AtlasPlacement[] | null = null;
        while (size <= maxSize) {
            placements = tryPackPage(remaining, size, size, padding);
            if (placements) break;
            size *= 2;
        }
        if (placements) {
            pages.push(composePage(byKey, placements, size, size));
            remaining = [];
            break;
        }
        // Even maxSize can't hold everything: fill one maxSize page greedily
        // (prefix of the sorted order that fits), spill the rest.
        const taken: AtlasInputImage[] = [];
        const spill: AtlasInputImage[] = [];
        for (const img of remaining) {
            const attempt = tryPackPage([...taken, img], maxSize, maxSize, padding);
            if (attempt) taken.push(img);
            else spill.push(img);
        }
        pages.push(composePage(byKey, tryPackPage(taken, maxSize, maxSize, padding)!, maxSize, maxSize));
        remaining = spill;
    }
    return pages;
}

/** Decode a PNG into the packer's input shape. */
export function decodePngImage(key: string, png: Uint8Array): AtlasInputImage {
    const decoded = PNG.sync.read(Buffer.from(png));
    return { key, width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
}

/** Encode a composed page back to PNG bytes. */
export function encodePagePng(page: AtlasPage): Uint8Array {
    const png = new PNG({ width: page.width, height: page.height });
    Buffer.from(page.rgba).copy(png.data);
    return new Uint8Array(PNG.sync.write(png));
}
