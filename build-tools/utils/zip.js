// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The repo's one ZIP implementation — write and read. Plain ESM so both halves
// reach it: the CLI writes runtime templates, the editor writes playable ad
// bundles and reads a template someone installs from a file.
//
// Written rather than depended on: what is needed is stored/deflated entries in
// one flat archive — no zip64, no encryption, no split volumes — and a dependency
// for that is more surface than the format.
//
// Deterministic by construction: entries carry a FIXED DOS timestamp and are
// written in the order given, so the same input always produces byte-identical
// output. An artifact that changes only because the clock moved is one you cannot
// diff, and a checksum that moves on its own is not a checksum.

import { deflateRawSync, inflateRawSync } from 'zlib';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// 1980-01-01 00:00:00 in DOS date/time — the epoch of the format itself, and the
// conventional stand-in for "no meaningful time" in reproducible archives.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/**
 * Build a ZIP archive holding `entries` ({ name, data }), each deflated.
 *
 * @param {ReadonlyArray<{name: string, data: Buffer}>} entries
 * @returns {Buffer}
 */
export function makeZip(entries) {
    const locals = [];
    const centrals = [];
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

/**
 * Every file under `dir` as zip entries, named relative to it (forward slashes,
 * sorted). Directories are implied by the names — a reader creates them — so no
 * directory entries are written.
 *
 * @param {string} dir
 * @param {string} [prefix] Path to prepend inside the archive.
 * @returns {Array<{name: string, data: Buffer}>}
 */
export function zipTree(dir, prefix = '') {
    const out = [];
    const walk = (abs, rel) => {
        for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const child = path.join(abs, e.name);
            const name = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(child, name);
            else if (e.isFile()) out.push({ name, data: readFileSync(child) });
        }
    };
    walk(dir, prefix);
    return out;
}

/**
 * Read an archive's entries, through its central directory (the authority on what
 * an archive contains — trailing local headers may be stale).
 *
 * @param {Buffer} buf
 * @returns {Array<{name: string, data: Buffer}>}
 */
export function readZip(buf) {
    // The end-of-central-directory record is last, but a comment may follow it.
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');

    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out = [];
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
        const method = buf.readUInt16LE(p + 10);
        const crc = buf.readUInt32LE(p + 16);
        const compressedSize = buf.readUInt32LE(p + 20);
        const size = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        p += 46 + nameLen + extraLen + commentLen;

        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt ZIP entry: ${name}`);
        const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(dataAt, dataAt + compressedSize);
        const data = method === 0 ? Buffer.from(raw)
            : method === 8 ? inflateRawSync(raw)
                : (() => { throw new Error(`unsupported ZIP compression ${method} in ${name}`); })();
        if (data.length !== size || crc32(data) !== crc) throw new Error(`corrupt ZIP entry: ${name}`);
        out.push({ name, data });
    }
    return out;
}

/**
 * Extract an archive into `destDir`.
 *
 * Entry names are checked before anything is written: an archive is untrusted
 * input (it can arrive over the network or from a file someone was handed), and
 * `../` in a name is how a zip writes outside the directory it was extracted to.
 *
 * @param {Buffer} buf
 * @param {string} destDir
 * @returns {string[]} The relative paths written.
 */
export function extractZip(buf, destDir) {
    const entries = readZip(buf);
    const root = path.resolve(destDir);
    for (const { name } of entries) {
        const target = path.resolve(root, name);
        if (name.startsWith('/') || name.includes('\\') || (target !== root && !target.startsWith(root + path.sep))) {
            throw new Error(`unsafe ZIP entry name: ${name}`);
        }
    }
    for (const { name, data } of entries) {
        const target = path.resolve(root, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, data);
    }
    return entries.map((e) => e.name);
}
