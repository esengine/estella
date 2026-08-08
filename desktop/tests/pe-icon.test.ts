// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The icon written into a Windows executable.
 *
 * Read back by a reader written from the PE spec rather than by the writer's own
 * code — the rule the APK and the icns are already held to. What it checks is not
 * "does it parse" but the three things that are wrong in a way nothing reports:
 * a tree the loader cannot binary-search, an existing resource dropped on the
 * floor, and a header that no longer describes the file.
 */
import { describe, it, expect } from 'vitest';
import { setExeIcon } from '../../build-tools/utils/peResource.js';

/** A minimal but STRUCTURALLY REAL PE32+: headers, three sections, and a
 *  resource tree holding a manifest. Enough that a spec reader can walk it. */
function fakePe(withResources = true): Buffer {
    const FILE_ALIGN = 0x200;
    const SECT_ALIGN = 0x1000;
    const peAt = 0x80;
    // Two file-alignment units, as a real link leaves: one is exactly the
    // header's own length here, and a PE with no room for another section
    // header is a different case (asserted below).
    const headerSize = FILE_ALIGN * 2;
    const manifest = Buffer.from('<assembly/>', 'ascii');

    // One resource section: root → type 24 → id 1 → lang 0x409 → the manifest.
    const dirBytes = (16 + 8) * 3;
    const dataEntryAt = dirBytes;
    const blobAt = dataEntryAt + 16;
    const rsrcRva = 0x3000;
    const rsrc = Buffer.alloc(blobAt + manifest.length);
    const dir = (at: number) => { rsrc.writeUInt16LE(1, at + 14); };
    dir(0);
    rsrc.writeUInt32LE(24, 16);
    rsrc.writeUInt32LE((24 | 0x80000000) >>> 0, 20);
    dir(24);
    rsrc.writeUInt32LE(1, 40);
    rsrc.writeUInt32LE((48 | 0x80000000) >>> 0, 44);
    dir(48);
    rsrc.writeUInt32LE(0x409, 64);
    rsrc.writeUInt32LE(dataEntryAt, 68);
    rsrc.writeUInt32LE(rsrcRva + blobAt, dataEntryAt);
    rsrc.writeUInt32LE(manifest.length, dataEntryAt + 4);
    manifest.copy(rsrc, blobAt);

    const sections = [
        { name: '.text', rva: 0x1000, size: 0x100 },
        { name: '.data', rva: 0x2000, size: 0x100 },
        ...(withResources ? [{ name: '.rsrc', rva: rsrcRva, size: rsrc.length }] : []),
    ];
    const raw = headerSize + sections.length * FILE_ALIGN;
    const buf = Buffer.alloc(raw);
    buf.write('MZ', 0, 'ascii');
    buf.writeUInt32LE(peAt, 0x3c);
    buf.write('PE\0\0', peAt, 'ascii');
    buf.writeUInt16LE(0x8664, peAt + 4);              // machine
    buf.writeUInt16LE(sections.length, peAt + 6);
    buf.writeUInt16LE(240, peAt + 20);                // optional header size
    buf.writeUInt16LE(0x20b, peAt + 24);              // PE32+
    buf.writeUInt32LE(SECT_ALIGN, peAt + 24 + 32);
    buf.writeUInt32LE(FILE_ALIGN, peAt + 24 + 36);
    buf.writeUInt32LE(0x4000, peAt + 24 + 56);        // size of image
    buf.writeUInt32LE(headerSize, peAt + 24 + 60);
    const dataDirs = peAt + 24 + 112;
    if (withResources) {
        buf.writeUInt32LE(rsrcRva, dataDirs + 2 * 8);
        buf.writeUInt32LE(rsrc.length, dataDirs + 2 * 8 + 4);
    }
    const table = peAt + 24 + 240;
    sections.forEach((s, i) => {
        const at = table + i * 40;
        buf.write(s.name, at, 'ascii');
        buf.writeUInt32LE(s.size, at + 8);
        buf.writeUInt32LE(s.rva, at + 12);
        buf.writeUInt32LE(FILE_ALIGN, at + 16);
        buf.writeUInt32LE(headerSize + i * FILE_ALIGN, at + 20);
    });
    if (withResources) rsrc.copy(buf, headerSize + 2 * FILE_ALIGN);
    return buf;
}

/** A real PNG of one flat colour — decodePng reads it, so a stub will not do. */
function png(size: number, rgba: [number, number, number, number]): Buffer {
    const zlib = require('node:zlib') as typeof import('node:zlib');
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        const row = y * (size * 4 + 1);
        for (let x = 0; x < size; x++) {
            raw[row + 1 + x * 4] = rgba[0];
            raw[row + 2 + x * 4] = rgba[1];
            raw[row + 3 + x * 4] = rgba[2];
            raw[row + 4 + x * 4] = rgba[3];
        }
    }
    const chunk = (type: string, body: Buffer) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(body.length, 0);
        head.write(type, 4, 'ascii');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])) >>> 0, 0);
        return Buffer.concat([head, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;   // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function crc32(buf: Buffer): number {
    let c = ~0;
    for (const byte of buf) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c;
}

/** A reader written from the PE format, not from the writer. */
function readResources(exe: Buffer): { type: number; id: number; lang: number; data: Buffer }[] {
    const pe = exe.readUInt32LE(0x3c);
    const optSize = exe.readUInt16LE(pe + 20);
    const count = exe.readUInt16LE(pe + 6);
    const table = pe + 24 + optSize;
    const sections = Array.from({ length: count }, (_, i) => {
        const at = table + i * 40;
        return {
            rva: exe.readUInt32LE(at + 12),
            size: Math.max(exe.readUInt32LE(at + 8), exe.readUInt32LE(at + 16)),
            file: exe.readUInt32LE(at + 20),
        };
    });
    const fileOf = (rva: number) => {
        const s = sections.find((x) => rva >= x.rva && rva < x.rva + x.size);
        return s ? s.file + (rva - s.rva) : -1;
    };
    const dirRva = exe.readUInt32LE(pe + 24 + 112 + 2 * 8);
    const base = fileOf(dirRva);
    const out: { type: number; id: number; lang: number; data: Buffer }[] = [];
    const walk = (offset: number, path: number[]) => {
        const at = base + offset;
        const named = exe.readUInt16LE(at + 12);
        const ids = exe.readUInt16LE(at + 14);
        expect(named, 'named entries are not written').toBe(0);
        let previous = -1;
        for (let i = 0; i < ids; i++) {
            const e = at + 16 + i * 8;
            const id = exe.readUInt32LE(e);
            const child = exe.readUInt32LE(e + 4);
            // The loader BINARY-SEARCHES each directory, so a tree whose ids are
            // out of order parses and then cannot be looked up.
            expect(id, 'directory ids ascend').toBeGreaterThan(previous);
            previous = id;
            if (child & 0x80000000) walk(child & 0x7fffffff, [...path, id]);
            else {
                const rva = exe.readUInt32LE(base + child);
                const size = exe.readUInt32LE(base + child + 4);
                const file = fileOf(rva);
                expect(file, 'a data entry points into a section').toBeGreaterThanOrEqual(0);
                out.push({ type: path[0], id: path[1], lang: id, data: exe.subarray(file, file + size) });
            }
        }
    };
    walk(0, []);
    return out;
}

describe('the icon inside a Windows executable', () => {
    it('writes an icon and the group that names it', () => {
        const out = setExeIcon(fakePe(), png(64, [10, 20, 30, 255]));
        const res = readResources(out);
        const icon = res.find((r) => r.type === 3);
        const group = res.find((r) => r.type === 14);
        expect(icon).toBeDefined();
        expect(group).toBeDefined();

        // The image's header height is DOUBLED — the format counts the colour
        // bitmap and the mask as one image, and an icon that says its real height
        // draws as the top half of itself.
        expect(icon!.data.readInt32LE(4)).toBe(64);
        expect(icon!.data.readInt32LE(8)).toBe(128);
        expect(icon!.data.readUInt16LE(14)).toBe(32);

        // And the group has to agree with it, byte count included: Windows reads
        // the size from here, not from the resource entry.
        expect(group!.data.readUInt16LE(4)).toBe(1);
        expect(group!.data[6]).toBe(64);
        expect(group!.data.readUInt32LE(14)).toBe(icon!.data.length);
        expect(group!.data.readUInt16LE(18)).toBe(icon!.id);
    });

    it('carries over what the executable already had', () => {
        // The manifest is what tells Windows the app is DPI-aware and which
        // common-controls version it wants; losing it is a visibly blurry app.
        const res = readResources(setExeIcon(fakePe(), png(32, [1, 2, 3, 255])));
        const manifest = res.find((r) => r.type === 24);
        expect(manifest?.data.toString('ascii')).toBe('<assembly/>');
    });

    it('leaves the headers describing the file it produced', () => {
        const before = fakePe();
        const after = setExeIcon(before, png(64, [0, 0, 0, 255]));
        const pe = after.readUInt32LE(0x3c);
        expect(after.readUInt16LE(pe + 6)).toBe(before.readUInt16LE(pe + 6) + 1);

        // Every section must fit inside SizeOfImage, or the loader refuses the
        // image outright — the failure that is a dialog, not a wrong icon.
        const table = pe + 24 + after.readUInt16LE(pe + 20);
        const sections = after.readUInt16LE(pe + 6);
        const sizeOfImage = after.readUInt32LE(pe + 24 + 56);
        for (let i = 0; i < sections; i++) {
            const at = table + i * 40;
            expect(after.readUInt32LE(at + 12) + after.readUInt32LE(at + 8)).toBeLessThanOrEqual(sizeOfImage);
            // And inside the file it was written to.
            expect(after.readUInt32LE(at + 20) + after.readUInt32LE(at + 16)).toBeLessThanOrEqual(after.length);
        }
    });

    it('scales down to the largest slot the format has', () => {
        // 256 is the ceiling: a 1024px mark is what the template ships, and an
        // icon larger than the format allows is one Windows does not draw.
        const res = readResources(setExeIcon(fakePe(), png(1024, [200, 100, 50, 255])));
        const icon = res.find((r) => r.type === 3)!;
        expect(icon.data.readInt32LE(4)).toBe(256);
        // 256 is written as ZERO in the group entry — the field is one byte.
        expect(res.find((r) => r.type === 14)!.data[6]).toBe(0);
    });

    it('takes a size the format has, not the picture\'s own', () => {
        const res = readResources(setExeIcon(fakePe(), png(100, [0, 255, 0, 255])));
        expect(res.find((r) => r.type === 3)!.data.readInt32LE(4)).toBe(64);
    });

    it('refuses what it cannot honestly write', () => {
        expect(() => setExeIcon(fakePe(), png(8, [0, 0, 0, 255]))).toThrow(/smallest Windows slot/);
        expect(() => setExeIcon(Buffer.alloc(64), png(32, [0, 0, 0, 255]))).toThrow(/not a PE/);
    });

    it('gives an executable with no resources at all one', () => {
        const res = readResources(setExeIcon(fakePe(false), png(32, [4, 5, 6, 255])));
        expect(res.map((r) => r.type).sort((a, b) => a - b)).toEqual([3, 14]);
    });
});
