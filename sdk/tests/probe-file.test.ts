// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { decodeProbeFile, encodeProbeFile, fromHalfBits, isBinaryProbeFile, PROBE_FILE_VERSION, toHalfBits }
    from '../src/lightmap/probeFile';

/** A grid whose every number differs, so a value read from the wrong place shows. */
function grid(res: [number, number, number], sky: boolean) {
    const probes = res[0] * res[1] * res[2];
    const irradiance = Array.from({ length: probes * 27 }, (_, i) => Math.sin(i * 0.37) * 3 + (i % 7) * 0.01);
    const skyVisibility = sky ? Array.from({ length: probes * 9 }, (_, i) => (i % 11) / 10) : undefined;
    return { version: PROBE_FILE_VERSION, resolution: res, irradiance, ...(skyVisibility ? { skyVisibility } : {}) };
}

/** What a half float keeps of a number: about one part in two thousand. */
const closeAsHalf = (got: ArrayLike<number>, want: ArrayLike<number>) => {
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) expect(Math.abs(got[i] - want[i])).toBeLessThanOrEqual(Math.abs(want[i]) / 1024 + 1e-7);
};

describe('the .esprobes file', () => {
    it('writes half floats that read back as the nearest half', () => {
        expect(toHalfBits(1)).toBe(0x3c00);
        expect(toHalfBits(-2)).toBe(0xc000);
        expect(toHalfBits(0.5)).toBe(0x3800);
        expect(toHalfBits(65504)).toBe(0x7bff);
        expect(toHalfBits(1e9)).toBe(0x7bff);
        expect(toHalfBits(2 ** -24)).toBe(1);
        expect(toHalfBits(0)).toBe(0);
        for (const v of [1, -2, 0.5, 65504, 2 ** -24, 0.1, 3.14159, -1234.5]) {
            expect(Math.abs(fromHalfBits(toHalfBits(v)) - v)).toBeLessThanOrEqual(Math.abs(v) / 2048 + 2 ** -25);
        }
    });

    it('is binary, versioned, and under a quarter the size the JSON was', () => {
        const doc = grid([13, 3, 9], false);
        const bytes = encodeProbeFile(doc);
        expect(isBinaryProbeFile(bytes)).toBe(true);
        expect(bytes.length).toBe(20 + 13 * 3 * 9 * 27 * 2);
        const json = JSON.stringify({ version: 1, resolution: doc.resolution, irradiance: doc.irradiance.map((v) => Number(v.toPrecision(6))) });
        expect(bytes.length * 4).toBeLessThan(json.length);
    });

    it('reads back what it wrote, with and without sky visibility', () => {
        for (const sky of [false, true]) {
            const doc = grid([4, 2, 3], sky);
            const read = decodeProbeFile(encodeProbeFile(doc));
            expect(read.version).toBe(PROBE_FILE_VERSION);
            expect(read.resolution).toEqual([4, 2, 3]);
            closeAsHalf(read.irradiance, doc.irradiance);
            if (sky) closeAsHalf(read.skyVisibility!, doc.skyVisibility!);
            else expect(read.skyVisibility).toBeUndefined();
        }
    });

    it('still reads a version 1 JSON grid exactly', () => {
        const irradiance = Array.from({ length: 2 * 27 }, (_, i) => i * 0.123457);
        const text = JSON.stringify({ version: 1, resolution: [2, 1, 1], irradiance, skyVisibility: new Array(18).fill(0.25) });
        const read = decodeProbeFile(new TextEncoder().encode(text));
        expect(read.version).toBe(1);
        expect(read.resolution).toEqual([2, 1, 1]);
        expect(Array.from(read.irradiance)).toEqual(Array.from(Float32Array.from(irradiance)));
        expect(Array.from(read.skyVisibility!)).toEqual(new Array(18).fill(0.25));
    });

    it('refuses a version it does not know, by name, in either form', () => {
        const bytes = encodeProbeFile(grid([1, 1, 1], false));
        new DataView(bytes.buffer).setUint16(4, 3, true);
        expect(() => decodeProbeFile(bytes, 'a.esprobes')).toThrow(/a\.esprobes is a version 3 probe file/);
        const json = new TextEncoder().encode(JSON.stringify({ version: 7, resolution: [1, 1, 1], irradiance: new Array(27).fill(0) }));
        expect(() => decodeProbeFile(json, 'b.esprobes')).toThrow(/b\.esprobes is a version 7 probe document/);
        const unversioned = new TextEncoder().encode(JSON.stringify({ resolution: [1, 1, 1], irradiance: new Array(27).fill(0) }));
        expect(() => decodeProbeFile(unversioned, 'c.esprobes')).toThrow(/version undefined/);
    });

    it('refuses a file whose length does not match its grid', () => {
        const bytes = encodeProbeFile(grid([2, 2, 2], true));
        expect(() => decodeProbeFile(bytes.subarray(0, bytes.length - 2), 'short.esprobes')).toThrow(/want \d+ bytes/);
        const json = new TextEncoder().encode(JSON.stringify({ version: 1, resolution: [2, 1, 1], irradiance: new Array(27).fill(0) }));
        expect(() => decodeProbeFile(json, 'half.esprobes')).toThrow(/want 54 coefficients, got 27/);
        expect(() => decodeProbeFile(new TextEncoder().encode('not a grid'), 'junk.esprobes')).toThrow(/neither/);
        expect(() => encodeProbeFile({ version: 2, resolution: [2, 1, 1], irradiance: new Array(27).fill(0) })).toThrow(/want 54/);
    });
});
