// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reading a `.aseprite` document: chunks in, structure out.
 *
 *        Only the format lives here — frames, layers, cels, tags, slices and the
 *        palette, named the way the file names them. What any of it becomes is
 *        the import's question, which is the same line the FBX read draws
 *        against the model import.
 *
 *        The format is small and stable enough to read directly (the spec is
 *        published with the editor), and doing so keeps the one pixel-art
 *        pipeline free of a dependency that would have to be trusted with every
 *        byte of an artist's work.
 */
import { inflateSync } from 'node:zlib';

/** Aseprite's own blend-mode numbering, in the order the format assigns. */
export enum AsepriteBlend {
    Normal = 0, Multiply = 1, Screen = 2, Overlay = 3, Darken = 4, Lighten = 5,
    ColorDodge = 6, ColorBurn = 7, HardLight = 8, SoftLight = 9, Difference = 10,
    Exclusion = 11, Hue = 12, Saturation = 13, Color = 14, Luminosity = 15,
    Addition = 16, Subtract = 17, Divide = 18,
}

/** How a tag walks its own frame range. */
export type AsepriteDirection = 'forward' | 'reverse' | 'pingpong' | 'pingpong-reverse';

export interface AsepriteLayer {
    name: string;
    /** Nesting depth; a layer belongs to the nearest preceding group one level up. */
    childLevel: number;
    isGroup: boolean;
    isTilemap: boolean;
    isBackground: boolean;
    /** The layer's own switch, before any group above it is taken into account. */
    visible: boolean;
    opacity: number;
    blend: AsepriteBlend;
}

export interface AsepriteCel {
    layer: number;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    /** Drawing order offset within the frame, added to the layer's own (format 1.3). */
    zIndex: number;
    /** RGBA8, row-major, `width * height * 4` — already resolved out of the file's
     *  colour depth and palette. Null for a cel this read does not decode. */
    pixels: Uint8Array | null;
    /** True for a tilemap cel, whose pixels are tile indices this read does not expand. */
    tilemap: boolean;
}

export interface AsepriteFrame {
    /** How long this frame is held, in milliseconds — the file's own per-frame timing. */
    durationMs: number;
    cels: AsepriteCel[];
}

export interface AsepriteTag {
    name: string;
    from: number;
    to: number;
    direction: AsepriteDirection;
    /** How many times the tag's range plays; 0 means "forever" (format 1.3). */
    repeat: number;
}

/** A named rectangle the artist marked on the canvas, per the frame it changes on. */
export interface AsepriteSliceKey {
    frame: number;
    x: number;
    y: number;
    width: number;
    height: number;
    /** 9-slice centre rect, relative to the key's own rect; null when the slice has none. */
    center: { x: number; y: number; width: number; height: number } | null;
    /** Pivot in the key's own pixels from its top-left; null when the slice has none. */
    pivot: { x: number; y: number } | null;
}

export interface AsepriteSlice {
    name: string;
    keys: AsepriteSliceKey[];
}

export interface AsepriteDocument {
    width: number;
    height: number;
    /** 32 = RGBA, 16 = grayscale, 8 = indexed. */
    colorDepth: number;
    layers: AsepriteLayer[];
    frames: AsepriteFrame[];
    tags: AsepriteTag[];
    slices: AsepriteSlice[];
    /** What the read could not carry; never dropped silently. */
    warnings: string[];
}

const HEADER_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;

const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_PALETTE = 0x2019;
const CHUNK_OLD_PALETTE = 0x0004;
const CHUNK_TAGS = 0x2018;
const CHUNK_SLICE = 0x2022;

const CEL_RAW = 0;
const CEL_LINKED = 1;
const CEL_COMPRESSED = 2;
const CEL_COMPRESSED_TILEMAP = 3;

const LAYER_FLAG_VISIBLE = 1;
const LAYER_FLAG_BACKGROUND = 8;

const LAYER_TYPE_GROUP = 1;
const LAYER_TYPE_TILEMAP = 2;

const DIRECTIONS: AsepriteDirection[] = ['forward', 'reverse', 'pingpong', 'pingpong-reverse'];

/** A little-endian cursor over the file — every field in the format is one. */
class Reader {
    private view: DataView;
    private pos = 0;

    constructor(private bytes: Uint8Array, start = 0, private end = bytes.length) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = start;
    }

    get offset(): number { return this.pos; }
    get remaining(): number { return this.end - this.pos; }

    skip(n: number): void { this.pos += n; }
    seek(n: number): void { this.pos = n; }

    u8(): number { return this.view.getUint8(this.pos++); }
    u16(): number { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
    i16(): number { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
    u32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
    i32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }

    /** WORD length followed by that many UTF-8 bytes. */
    string(): string {
        const len = this.u16();
        const text = Buffer.from(this.bytes.buffer, this.bytes.byteOffset + this.pos, len).toString('utf8');
        this.pos += len;
        return text;
    }

    bytesOf(len: number): Uint8Array {
        const slice = this.bytes.subarray(this.pos, this.pos + len);
        this.pos += len;
        return slice;
    }
}

/**
 * Expand one cel's stored pixels to RGBA8.
 *
 * The sprite's transparent index becomes a hole — except on a background layer,
 * where that index is a colour like any other, which is what "background" means.
 */
function toRgba(raw: Uint8Array, count: number, depth: number,
                palette: Uint8Array, transparentIndex: number, background: boolean): Uint8Array {
    const out = new Uint8Array(count * 4);
    if (depth === 32) {
        out.set(raw.subarray(0, count * 4));
        return out;
    }
    if (depth === 16) {
        for (let i = 0; i < count; i++) {
            const value = raw[i * 2] ?? 0;
            out[i * 4] = value; out[i * 4 + 1] = value; out[i * 4 + 2] = value;
            out[i * 4 + 3] = raw[i * 2 + 1] ?? 0;
        }
        return out;
    }
    for (let i = 0; i < count; i++) {
        const index = raw[i] ?? 0;
        if (index === transparentIndex && !background) continue;
        out[i * 4] = palette[index * 4] ?? 0;
        out[i * 4 + 1] = palette[index * 4 + 1] ?? 0;
        out[i * 4 + 2] = palette[index * 4 + 2] ?? 0;
        out[i * 4 + 3] = palette[index * 4 + 3] ?? 255;
    }
    return out;
}

/**
 * Read `bytes` as an Aseprite document.
 *
 * @throws when the file is not one — a caller that guessed from the extension
 *         needs to hear that rather than receive an empty document.
 */
export function parseAseprite(bytes: Uint8Array): AsepriteDocument {
    const r = new Reader(bytes);
    r.skip(4); // file size, which the chunk walk does not need
    if (r.u16() !== HEADER_MAGIC) throw new Error('not an Aseprite file (bad header magic)');

    const frameCount = r.u16();
    const width = r.u16();
    const height = r.u16();
    const colorDepth = r.u16();
    r.u32(); // flags: only says whether layer opacity is meaningful, and it always is here
    r.u16(); // the deprecated whole-sprite speed; per-frame durations replace it
    r.u32(); r.u32();
    const transparentIndex = r.u8();
    r.skip(3);
    r.u16(); // palette entry count, which the palette chunk restates
    r.skip(2); // pixel aspect ratio: a display hint, not the pixels
    r.skip(92); // the grid's origin and size, then the reserved tail — to byte 128

    const layers: AsepriteLayer[] = [];
    const frames: AsepriteFrame[] = [];
    const tags: AsepriteTag[] = [];
    const slices: AsepriteSlice[] = [];
    const warnings: string[] = [];
    const palette = new Uint8Array(256 * 4);
    let modernPalette = false;

    for (let f = 0; f < frameCount; f++) {
        const frameStart = r.offset;
        const frameBytes = r.u32();
        if (r.u16() !== FRAME_MAGIC) throw new Error(`frame ${f} is not a frame (bad magic)`);
        const oldChunks = r.u16();
        const durationMs = r.u16();
        r.skip(2);
        const newChunks = r.u32();
        const chunks = newChunks !== 0 ? newChunks : oldChunks;

        const frame: AsepriteFrame = { durationMs, cels: [] };
        frames.push(frame);

        for (let c = 0; c < chunks; c++) {
            const chunkStart = r.offset;
            const chunkSize = r.u32();
            const type = r.u16();
            const next = chunkStart + chunkSize;

            if (type === CHUNK_LAYER) {
                const flags = r.u16();
                const layerType = r.u16();
                const childLevel = r.u16();
                r.u16(); r.u16(); // default width/height, which the format itself calls ignorable
                const blend = r.u16() as AsepriteBlend;
                const opacity = r.u8();
                r.skip(3);
                layers.push({
                    name: r.string(),
                    childLevel,
                    isGroup: layerType === LAYER_TYPE_GROUP,
                    isTilemap: layerType === LAYER_TYPE_TILEMAP,
                    isBackground: (flags & LAYER_FLAG_BACKGROUND) !== 0,
                    visible: (flags & LAYER_FLAG_VISIBLE) !== 0,
                    opacity,
                    blend,
                });
            } else if (type === CHUNK_CEL) {
                const layerIndex = r.u16();
                const x = r.i16();
                const y = r.i16();
                const opacity = r.u8();
                const celType = r.u16();
                const zIndex = r.i16();
                r.skip(5);
                const background = layers[layerIndex]?.isBackground === true;

                if (celType === CEL_LINKED) {
                    const source = r.u16();
                    const linked = frames[source]?.cels.find((cel) => cel.layer === layerIndex);
                    // A linked cel IS the other frame's pixels; copying the reference keeps
                    // one decode per image however many frames hold it.
                    if (linked) {
                        frame.cels.push({ ...linked, opacity, zIndex, x, y });
                    }
                } else if (celType === CEL_RAW || celType === CEL_COMPRESSED) {
                    const w = r.u16();
                    const h = r.u16();
                    const stored = r.bytesOf(next - r.offset);
                    const raw = celType === CEL_COMPRESSED
                        ? new Uint8Array(inflateSync(Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength)))
                        : stored;
                    frame.cels.push({
                        layer: layerIndex, x, y, width: w, height: h, opacity, zIndex, tilemap: false,
                        pixels: toRgba(raw, w * h, colorDepth, palette, transparentIndex, background),
                    });
                } else if (celType === CEL_COMPRESSED_TILEMAP) {
                    const w = r.u16();
                    const h = r.u16();
                    frame.cels.push({
                        layer: layerIndex, x, y, width: w, height: h, opacity, zIndex,
                        tilemap: true, pixels: null,
                    });
                }
            } else if (type === CHUNK_PALETTE) {
                modernPalette = true;
                r.u32(); // new size, which the first/last pair already bounds
                const first = r.u32();
                const last = r.u32();
                r.skip(8);
                for (let i = first; i <= last && i < 256; i++) {
                    const entryFlags = r.u16();
                    palette[i * 4] = r.u8();
                    palette[i * 4 + 1] = r.u8();
                    palette[i * 4 + 2] = r.u8();
                    palette[i * 4 + 3] = r.u8();
                    if ((entryFlags & 1) !== 0) r.string();
                }
            } else if (type === CHUNK_OLD_PALETTE && !modernPalette) {
                // A file saved by an old build has only this chunk, and without it every
                // indexed pixel would resolve to black. The modern one wins where both are
                // present: it is the one that carries alpha.
                const packets = r.u16();
                let index = 0;
                for (let p = 0; p < packets; p++) {
                    index += r.u8();
                    const stated = r.u8();
                    const count = stated === 0 ? 256 : stated;
                    for (let i = 0; i < count && index < 256; i++, index++) {
                        palette[index * 4] = r.u8();
                        palette[index * 4 + 1] = r.u8();
                        palette[index * 4 + 2] = r.u8();
                        palette[index * 4 + 3] = 255;
                    }
                }
            } else if (type === CHUNK_TAGS) {
                const count = r.u16();
                r.skip(8);
                for (let t = 0; t < count; t++) {
                    const from = r.u16();
                    const to = r.u16();
                    const direction = DIRECTIONS[r.u8()] ?? 'forward';
                    const repeat = r.u16();
                    r.skip(6);
                    r.skip(4); // the deprecated tag colour
                    tags.push({ name: r.string(), from, to, direction, repeat });
                }
            } else if (type === CHUNK_SLICE) {
                const keyCount = r.u32();
                const sliceFlags = r.u32();
                r.u32();
                const name = r.string();
                const keys: AsepriteSliceKey[] = [];
                for (let k = 0; k < keyCount; k++) {
                    const keyFrame = r.u32();
                    const x = r.i32();
                    const y = r.i32();
                    const w = r.u32();
                    const h = r.u32();
                    const center = (sliceFlags & 1) !== 0
                        ? { x: r.i32(), y: r.i32(), width: r.u32(), height: r.u32() }
                        : null;
                    const pivot = (sliceFlags & 2) !== 0 ? { x: r.i32(), y: r.i32() } : null;
                    keys.push({ frame: keyFrame, x, y, width: w, height: h, center, pivot });
                }
                slices.push({ name, keys });
            }

            r.seek(next);
        }

        r.seek(frameStart + frameBytes);
    }

    return { width, height, colorDepth, layers, frames, tags, slices, warnings };
}
