// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
/**
 * @file  The macOS icon container, written rather than depended on.
 *
 * `iconutil` is macOS-only and the assembler must run anywhere. The format is a
 * header plus typed blocks, and since 10.7 a block may simply BE a PNG — so the
 * project's icon goes in as its own bytes, with nothing to encode.
 */

/**
 * The block type for each nominal icon size. A type is a SLOT, not a promise
 * about the pixels — macOS scales whatever it finds — so one block is a valid
 * icon file and the largest slot is the one worth filling.
 */
const SIZE_TYPES = [
    [16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'],
    [256, 'ic08'], [512, 'ic09'], [1024, 'ic10'],
];

/** A PNG's pixel size, straight out of IHDR (which is always the first chunk). */
export function pngSize(bytes) {
    const png = Buffer.from(bytes);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (png.length < 24 || !png.subarray(0, 8).equals(signature)) {
        throw new Error('not a PNG (bad signature)');
    }
    if (png.subarray(12, 16).toString('ascii') !== 'IHDR') {
        throw new Error('not a PNG (first chunk is not IHDR)');
    }
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Wrap a square PNG as an `.icns`.
 *
 * NOTHING is resized, as with the Android and iOS icons — the platform scales.
 * The slot is the largest standard size the image covers, so a 300px icon lands
 * in the 256 slot rather than claiming 512.
 *
 * @param {Uint8Array|Buffer} png The icon.
 * @returns {Buffer} the .icns file.
 */
export function pngToIcns(png) {
    const { width, height } = pngSize(png);
    if (width !== height) throw new Error(`icon must be square, got ${width}x${height}`);
    const slot = [...SIZE_TYPES].reverse().find(([size]) => size <= width);
    if (!slot) throw new Error(`icon is ${width}px; the smallest macOS slot is ${SIZE_TYPES[0][0]}px`);

    const data = Buffer.from(png);
    const block = Buffer.alloc(8);
    block.write(slot[1], 0, 'ascii');
    block.writeUInt32BE(data.length + 8, 4);

    const header = Buffer.alloc(8);
    header.write('icns', 0, 'ascii');
    header.writeUInt32BE(8 + block.length + data.length, 4);
    return Buffer.concat([header, block, data]);
}
