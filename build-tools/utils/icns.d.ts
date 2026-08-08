// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for icns.js, which is plain ESM so the CLI runs it unbuilt.

/** A PNG's pixel size, from IHDR. Throws when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array | Buffer): { width: number; height: number };

/** Wrap a square PNG as a macOS `.icns`. Nothing is resized; the slot is the
 *  largest standard size the image covers. Throws when it cannot be wrapped
 *  honestly (not square, not a PNG, smaller than the smallest slot). */
export function pngToIcns(png: Uint8Array | Buffer): Buffer;
