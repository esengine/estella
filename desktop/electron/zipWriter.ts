// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A minimal ZIP writer, for the ad networks that upload a ZIP rather than a
 *        bare HTML file (Google App campaigns).
 *
 *        Written rather than depended on: what a playable needs is one deflated
 *        entry at the archive root, which is the simplest case the format has — no
 *        directories, no zip64, no encryption. A dependency for that would be more
 *        surface than the format.
 *
 *        Deterministic by construction: entries carry a FIXED DOS timestamp, so the
 *        same input always produces byte-identical output. An export that changes
 *        only because the clock moved is an export you cannot diff.
 */
import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
    /** Path inside the archive. Networks want `index.html` at the root. */
    name: string;
    data: Buffer;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// 1980-01-01 00:00:00 in DOS date/time — the epoch of the format itself, and the
// conventional stand-in for "no meaningful time" in reproducible archives.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Build a ZIP archive holding `entries`, each deflated at the archive root. */
export function makeZip(entries: readonly ZipEntry[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const compressed = deflateRawSync(entry.data, { level: 9 });
        const crc = crc32(entry.data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);      // version needed
        local.writeUInt16LE(0x0800, 6);  // UTF-8 names
        local.writeUInt16LE(8, 8);       // deflate
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);      // no extra field
        locals.push(local, name, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);    // version made by
        central.writeUInt16LE(20, 6);    // version needed
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);    // extra
        central.writeUInt16LE(0, 32);    // comment
        central.writeUInt16LE(0, 34);    // disk
        central.writeUInt16LE(0, 36);    // internal attrs
        central.writeUInt32LE(0, 38);    // external attrs
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);

        offset += local.length + name.length + compressed.length;
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);             // this disk
    end.writeUInt16LE(0, 6);             // disk with central dir
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);            // no archive comment

    return Buffer.concat([...locals, ...centrals, end]);
}
