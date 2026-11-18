// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    probeFile.ts
 * @brief   The `.esprobes` file: one writer and one reader, so the editor's bake, the CLI's and the runtime agree on
 *          the bytes.
 *
 * Version 2 is binary: a grid is hundreds to thousands of probes, 27 numbers each, and as JSON text it was about 263
 * bytes a probe where this is 54. The numbers are half floats, which is what the runtime keeps them in on the GPU
 * anyway (ProbeStore's atlas is RGBA16F).
 *
 *   offset  size  what
 *   0       4     'ESPV'
 *   4       2     version, 2
 *   6       2     flags: bit 0 = sky visibility follows the irradiance
 *   8       12    probes along x, y and z (u32 each)
 *   20      2*27n the irradiance: nine RGB coefficients per probe, x fastest then y then z
 *   ...     2*9n  the sky's visibility, nine coefficients per probe, when flag bit 0 is set
 *
 * Version 3 is a SPARSE grid (lightmap/probes planProbes): the header as above, the resolution being the finest
 * grid's, then
 *
 *   20      4     bricks, b
 *   24      16b   per brick: its first finest-brick cell x, y, z and its span in those cells (u32 each)
 *   ...     2*27n the irradiance, n = b * 125: each brick's (BRICK_CELLS+1)^3 probes, x fastest, brick after brick
 *   ...     2*9n  the sky's visibility, when flag bit 0 is set
 *
 * A grid with no bricks is written as version 2, so a dense bake reads as it did. Little-endian throughout.
 * Version 1, the JSON document, is still read: every grid baked before version 2 is one.
 */

/** A solved grid: what a bake produces and what a load hands the engine. */
export interface ProbeVolumeDocument {
    /** The version the file was written as; a document about to be written carries the one it will be. */
    version: number;
    /** Probes along x, y and z. */
    resolution: [number, number, number];
    /** Nine RGB coefficients per probe, x fastest then y then z. */
    irradiance: ArrayLike<number>;
    /** Baked with sky occlusion: nine coefficients per probe of how much of the sky each sees, and the irradiance
     *  then holds the lights alone. Absent otherwise (the irradiance holds the sky as it was). */
    skyVisibility?: ArrayLike<number>;
    /** A sparse grid: four ints a brick (first finest-brick cell x, y, z and its span), and the irradiance and sky
     *  visibility then hold PROBES_PER_BRICK probes a brick, in turn. Absent for a dense grid. */
    bricks?: ArrayLike<number>;
}

/** The version encodeProbeFile writes for a dense grid. */
export const PROBE_FILE_VERSION = 2;
/** The version it writes for a sparse one, and the newest decodeProbeFile reads. */
export const PROBE_FILE_SPARSE_VERSION = 3;
/** Probes a brick of a sparse grid carries: 5 a side, its far faces included. */
export const PROBES_PER_BRICK = 125;

const MAGIC = [0x45, 0x53, 0x50, 0x56]; // 'ESPV'
const HEADER_BYTES = 20;
const FLAG_SKY = 1;
/** The largest finite half float. A coefficient past it is clamped rather than written as infinity. */
const HALF_MAX = 65504;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A number as the nearest half float's bits (round to nearest even), clamped to the finite range. */
export function toHalfBits(value: number): number {
    if (Number.isNaN(value)) return 0x7e00;
    f32[0] = Math.max(-HALF_MAX, Math.min(HALF_MAX, value));
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exponent = (x >>> 23) & 0xff;
    let mantissa = x & 0x7fffff;
    if (exponent < 103) return sign; // below half's smallest subnormal
    if (exponent < 113) {
        // Subnormal: shift the implicit one in, then round to nearest even.
        mantissa |= 0x800000;
        const shift = 126 - exponent;
        const half = mantissa >>> shift;
        const rest = mantissa & ((1 << shift) - 1);
        const midway = 1 << (shift - 1);
        return sign | (half + (rest > midway || (rest === midway && (half & 1)) ? 1 : 0));
    }
    let bits = ((exponent - 112) << 10) | (mantissa >>> 13);
    const rest = mantissa & 0x1fff;
    if (rest > 0x1000 || (rest === 0x1000 && (bits & 1))) bits += 1;
    return sign | bits;
}

/** A half float's bits as a number. */
export function fromHalfBits(h: number): number {
    const sign = h & 0x8000 ? -1 : 1;
    const exponent = (h >>> 10) & 0x1f;
    const mantissa = h & 0x3ff;
    if (exponent === 0) return sign * mantissa * 2 ** -24;
    if (exponent === 31) return mantissa ? NaN : sign * Infinity;
    return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/** Probes in a resolution, or an error naming what is wrong with it. */
function probeCount(resolution: unknown, where: string): number {
    const r = resolution as number[];
    if (!Array.isArray(r) || r.length !== 3 || r.some((n) => !Number.isInteger(n) || n < 1)) {
        throw new Error(`${where}: a probe volume is three positive probe counts, got ${JSON.stringify(resolution)}`);
    }
    return r[0] * r[1] * r[2];
}

/** The file's bytes for a grid: version 2 for a dense one, version 3 for one with bricks. */
export function encodeProbeFile(doc: ProbeVolumeDocument): Uint8Array {
    const brickInts = doc.bricks?.length ?? 0;
    if (brickInts % 4 !== 0) throw new Error(`encodeProbeFile: ${brickInts} brick ints are not four a brick`);
    const brickCount = brickInts / 4;
    const cells = probeCount(doc.resolution, 'encodeProbeFile');
    const probes = brickCount > 0 ? brickCount * PROBES_PER_BRICK : cells;
    if (doc.irradiance.length !== probes * 27) {
        throw new Error(`encodeProbeFile: ${probes} probes want ${probes * 27} coefficients, got ${doc.irradiance.length}`);
    }
    const sky = doc.skyVisibility;
    if (sky && sky.length !== probes * 9) {
        throw new Error(`encodeProbeFile: ${probes} probes want ${probes * 9} sky visibility coefficients, got ${sky.length}`);
    }
    const values = probes * 27 + (sky ? probes * 9 : 0);
    const table = brickCount > 0 ? 4 + brickCount * 16 : 0;
    const bytes = new Uint8Array(HEADER_BYTES + table + values * 2);
    const view = new DataView(bytes.buffer);
    bytes.set(MAGIC, 0);
    view.setUint16(4, brickCount > 0 ? PROBE_FILE_SPARSE_VERSION : PROBE_FILE_VERSION, true);
    view.setUint16(6, sky ? FLAG_SKY : 0, true);
    for (let a = 0; a < 3; a++) view.setUint32(8 + a * 4, doc.resolution[a], true);
    let at = HEADER_BYTES;
    if (brickCount > 0) {
        view.setUint32(at, brickCount, true);
        at += 4;
        for (let i = 0; i < brickInts; i++, at += 4) view.setUint32(at, doc.bricks![i]!, true);
    }
    for (let i = 0; i < doc.irradiance.length; i++, at += 2) view.setUint16(at, toHalfBits(doc.irradiance[i]), true);
    if (sky) for (let i = 0; i < sky.length; i++, at += 2) view.setUint16(at, toHalfBits(sky[i]), true);
    return bytes;
}

/** Whether these bytes start the way a version 2 (or later) file does. */
export function isBinaryProbeFile(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * A grid from a file's bytes: version 2 as written above, or version 1's JSON. A version this build does not know is
 * refused by name rather than read as whatever its bytes happen to look like.
 */
export function decodeProbeFile(bytes: Uint8Array, where = '.esprobes'): ProbeVolumeDocument {
    if (isBinaryProbeFile(bytes)) {
        if (bytes.length < HEADER_BYTES) throw new Error(`${where}: ${bytes.length} bytes is shorter than its header`);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const version = view.getUint16(4, true);
        if (version !== PROBE_FILE_VERSION && version !== PROBE_FILE_SPARSE_VERSION) {
            throw new Error(`${where} is a version ${version} probe file; this engine reads versions 1 to ${PROBE_FILE_SPARSE_VERSION}`);
        }
        const flags = view.getUint16(6, true);
        const resolution: [number, number, number] = [view.getUint32(8, true), view.getUint32(12, true), view.getUint32(16, true)];
        const cells = probeCount(resolution, where);
        const sky = (flags & FLAG_SKY) !== 0;
        let at = HEADER_BYTES;
        let bricks: Int32Array | undefined;
        if (version === PROBE_FILE_SPARSE_VERSION) {
            if (bytes.length < HEADER_BYTES + 4) throw new Error(`${where}: a sparse grid with no brick count`);
            const count = view.getUint32(at, true);
            at += 4;
            if (count === 0 || bytes.length < at + count * 16) throw new Error(`${where}: ${count} bricks do not fit its ${bytes.length} bytes`);
            bricks = new Int32Array(count * 4);
            for (let i = 0; i < bricks.length; i++, at += 4) bricks[i] = view.getUint32(at, true);
        }
        const probes = bricks ? (bricks.length / 4) * PROBES_PER_BRICK : cells;
        const want = at + (probes * 27 + (sky ? probes * 9 : 0)) * 2;
        if (bytes.length !== want) {
            throw new Error(`${where}: ${resolution.join('x')} probes${bricks ? ` in ${bricks.length / 4} bricks` : ''}`
                + `${sky ? ' with sky visibility' : ''} want ${want} bytes, got ${bytes.length}`);
        }
        const irradiance = new Float32Array(probes * 27);
        for (let i = 0; i < irradiance.length; i++, at += 2) irradiance[i] = fromHalfBits(view.getUint16(at, true));
        let skyVisibility: Float32Array | undefined;
        if (sky) {
            skyVisibility = new Float32Array(probes * 9);
            for (let i = 0; i < skyVisibility.length; i++, at += 2) skyVisibility[i] = fromHalfBits(view.getUint16(at, true));
        }
        return { version, resolution, irradiance, ...(skyVisibility ? { skyVisibility } : {}), ...(bricks ? { bricks } : {}) };
    }

    let data: { version?: unknown; resolution?: unknown; irradiance?: unknown; skyVisibility?: unknown };
    try {
        data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error(`${where} is neither a binary probe file nor a version 1 JSON document`);
    }
    if (data.version !== 1) {
        throw new Error(`${where} is a version ${JSON.stringify(data.version)} probe document; this engine reads versions 1 to ${PROBE_FILE_SPARSE_VERSION}`);
    }
    const probes = probeCount(data.resolution, where);
    const res = data.resolution as [number, number, number];
    const irradiance = data.irradiance;
    if (!Array.isArray(irradiance) || irradiance.length !== probes * 27) {
        throw new Error(`${where}: ${res.join('x')} probes want ${probes * 27} coefficients, got `
            + `${Array.isArray(irradiance) ? irradiance.length : 0}`);
    }
    const sky = data.skyVisibility;
    if (sky !== undefined && (!Array.isArray(sky) || sky.length !== probes * 9)) {
        throw new Error(`${where}: ${res.join('x')} probes want ${probes * 9} sky visibility coefficients, got `
            + `${Array.isArray(sky) ? sky.length : 0}`);
    }
    return {
        version: 1,
        resolution: [res[0], res[1], res[2]],
        irradiance: Float32Array.from(irradiance as number[]),
        ...(sky ? { skyVisibility: Float32Array.from(sky as number[]) } : {}),
    };
}
