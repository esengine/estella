// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A PE32+ executable that is structurally real, for the tests that hand
 *        one to something which reads or rewrites it.
 *
 * One generator, for the same reason the PNG one is: the assembler's Windows test
 * used a seven-byte string as an executable, which was enough until the icon
 * writer started parsing what it was given.
 */

/** A minimal but STRUCTURALLY REAL PE32+: headers, three sections, and a
 *  resource tree holding a manifest. Enough that a spec reader can walk it. */
export function fakePe(withResources = true): Buffer {
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

/** A reader written from the PE format, not from the writer. */
export function readResources(exe: Buffer): { type: number; id: number; lang: number; data: Buffer }[] {
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
        if (named !== 0) throw new Error('named resource entries are not written');
        let previous = -1;
        for (let i = 0; i < ids; i++) {
            const e = at + 16 + i * 8;
            const id = exe.readUInt32LE(e);
            const child = exe.readUInt32LE(e + 4);
            // The loader BINARY-SEARCHES each directory, so an out-of-order tree
            // parses and then cannot be looked up.
            if (id <= previous) throw new Error(`resource ids out of order: ${id} after ${previous}`);
            previous = id;
            if (child & 0x80000000) walk(child & 0x7fffffff, [...path, id]);
            else {
                const rva = exe.readUInt32LE(base + child);
                const size = exe.readUInt32LE(base + child + 4);
                const file = fileOf(rva);
                if (file < 0) throw new Error('a data entry points outside every section');
                out.push({ type: path[0], id: path[1], lang: id, data: exe.subarray(file, file + size) });
            }
        }
    };
    walk(0, []);
    return out;
}
