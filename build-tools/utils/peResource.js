// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The icon inside a Windows executable — written here, in Node, because
 *        the alternative is a toolchain on the packaging machine.
 *
 * `rcedit.exe` is a Windows-only binary and `wine` is worse; the assembler has to
 * run on any OS, as it does for the APK's binary XML and the macOS icns. What an
 * exe's icon actually is: an `RT_ICON` resource holding one image, and an
 * `RT_GROUP_ICON` naming it — the same pair a `.ico` file carries, in the PE's
 * resource tree.
 *
 * The tree is rebuilt and APPENDED as a new section rather than grown in place:
 * `.rsrc` is not the last section in an MSVC link, so growing it would shift
 * `.reloc` and every file offset after it. Appending moves nothing — the old
 * section's bytes stay where they are, unreferenced, and everything they held is
 * carried into the new tree.
 */

import { decodePng } from './png.js';

/** Resource types, as the PE numbers them. */
const RT_ICON = 3;
const RT_GROUP_ICON = 14;

/** The sizes Windows draws an icon at. An image is scaled to the largest one it
 *  covers — the same rule the macOS icns writer follows, with a smaller ceiling
 *  because 256 is the largest icon the format has. */
const ICON_SIZES = [16, 32, 48, 64, 128, 256];

/** US English. An icon under a language nothing asks for is an icon Explorer
 *  does not draw; this is the one every packer writes. */
const LANG_EN_US = 0x0409;

const align = (n, to) => Math.ceil(n / to) * to;

/**
 * Area-average downscale of RGBA pixels.
 *
 * Not nearest-neighbour: an icon is looked at, and dropping three quarters of a
 * 1024px mark's pixels is visible as ragged edges at every size Windows draws.
 */
function resampleRgba(src, srcW, srcH, dstW, dstH) {
    const out = Buffer.alloc(dstW * dstH * 4);
    for (let y = 0; y < dstH; y++) {
        const y0 = Math.floor((y * srcH) / dstH);
        const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / dstH));
        for (let x = 0; x < dstW; x++) {
            const x0 = Math.floor((x * srcW) / dstW);
            const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / dstW));
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let sy = y0; sy < y1; sy++) {
                for (let sx = x0; sx < x1; sx++) {
                    const at = (sy * srcW + sx) * 4;
                    // Premultiplied while averaging: a transparent pixel's colour
                    // is undefined, and letting it vote turns soft edges grey.
                    const alpha = src[at + 3] / 255;
                    r += src[at] * alpha; g += src[at + 1] * alpha; b += src[at + 2] * alpha;
                    a += src[at + 3];
                    n++;
                }
            }
            const at = (y * dstW + x) * 4;
            const avgA = a / n;
            const un = avgA > 0 ? 255 / avgA : 0;
            out[at] = Math.min(255, Math.round((r / n) * un));
            out[at + 1] = Math.min(255, Math.round((g / n) * un));
            out[at + 2] = Math.min(255, Math.round((b / n) * un));
            out[at + 3] = Math.round(avgA);
        }
    }
    return out;
}

/**
 * One icon image as `RT_ICON` carries it: a BITMAPINFOHEADER, a bottom-up BGRA
 * bitmap, and an AND mask.
 *
 * The header's height is DOUBLED — colour bitmap and mask are one image to the
 * format, and an icon that says its real height draws as its own top half.
 */
function iconImage(rgba, size) {
    const maskStride = align(Math.ceil(size / 8), 4);
    const out = Buffer.alloc(40 + size * size * 4 + maskStride * size);
    out.writeUInt32LE(40, 0);            // biSize
    out.writeInt32LE(size, 4);           // biWidth
    out.writeInt32LE(size * 2, 8);       // biHeight — colour + mask
    out.writeUInt16LE(1, 12);            // biPlanes
    out.writeUInt16LE(32, 14);           // biBitCount
    out.writeUInt32LE(0, 16);            // biCompression = BI_RGB
    out.writeUInt32LE(size * size * 4, 20);
    for (let y = 0; y < size; y++) {
        // Bottom-up, and BGRA rather than RGBA.
        const src = (size - 1 - y) * size * 4;
        let at = 40 + y * size * 4;
        for (let x = 0; x < size; x++) {
            out[at++] = rgba[src + x * 4 + 2];
            out[at++] = rgba[src + x * 4 + 1];
            out[at++] = rgba[src + x * 4];
            out[at++] = rgba[src + x * 4 + 3];
        }
    }
    // The AND mask stays zero: with 32 bits per pixel the alpha channel is the
    // transparency, and a mask that disagreed with it would punch holes.
    return out;
}

/** The GRPICONDIR that names the image above — what an `.ico` file's header is. */
function iconGroup(size, byteLength, iconId) {
    const out = Buffer.alloc(6 + 14);
    out.writeUInt16LE(0, 0);             // reserved
    out.writeUInt16LE(1, 2);             // type = icon
    out.writeUInt16LE(1, 4);             // one image
    // 256 is written as 0: the field is a byte, and 256 does not fit in one.
    out[6] = size === 256 ? 0 : size;
    out[7] = size === 256 ? 0 : size;
    out[8] = 0;                          // colours in palette (0 = not paletted)
    out[9] = 0;
    out.writeUInt16LE(1, 10);            // planes
    out.writeUInt16LE(32, 12);           // bits per pixel
    out.writeUInt32LE(byteLength, 14);
    out.writeUInt16LE(iconId, 18);
    return out;
}

/** Where a PE keeps the things this rewrites. */
function peLayout(exe) {
    const pe = exe.readUInt32LE(0x3c);
    if (exe.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE executable');
    const optSize = exe.readUInt16LE(pe + 20);
    const magic = exe.readUInt16LE(pe + 24);
    if (magic !== 0x20b && magic !== 0x10b) throw new Error(`unknown PE optional header ${magic}`);
    return {
        pe,
        sections: exe.readUInt16LE(pe + 6),
        sectionTable: pe + 24 + optSize,
        sectionAlignment: exe.readUInt32LE(pe + 24 + 32),
        fileAlignment: exe.readUInt32LE(pe + 24 + 36),
        sizeOfImage: pe + 24 + 56,
        sizeOfHeaders: exe.readUInt32LE(pe + 24 + 60),
        // The data directories follow the optional header's fixed part, whose
        // length is the one thing PE32 and PE32+ disagree about.
        dataDirs: pe + 24 + (magic === 0x20b ? 112 : 96),
    };
}

function sectionsOf(exe, layout) {
    const out = [];
    for (let i = 0; i < layout.sections; i++) {
        const at = layout.sectionTable + i * 40;
        out.push({
            at,
            name: exe.toString('ascii', at, at + 8).replace(/\0+$/, ''),
            virtualSize: exe.readUInt32LE(at + 8),
            virtualAddress: exe.readUInt32LE(at + 12),
            rawSize: exe.readUInt32LE(at + 16),
            rawPointer: exe.readUInt32LE(at + 20),
        });
    }
    return out;
}

/** Read the existing tree into `[{type, id, lang, data}]`, flattened. */
function readResources(exe, layout) {
    const rva = exe.readUInt32LE(layout.dataDirs + 2 * 8);
    if (!rva) return [];
    const sections = sectionsOf(exe, layout);
    const owner = sections.find((s) => rva >= s.virtualAddress
        && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize));
    if (!owner) throw new Error('the resource directory points outside every section');
    const base = owner.rawPointer + (rva - owner.virtualAddress);
    const fileOf = (r) => {
        const s = sections.find((x) => r >= x.virtualAddress
            && r < x.virtualAddress + Math.max(x.virtualSize, x.rawSize));
        return s ? s.rawPointer + (r - s.virtualAddress) : -1;
    };

    const out = [];
    const walk = (offset, path) => {
        const dir = base + offset;
        const named = exe.readUInt16LE(dir + 12);
        const ids = exe.readUInt16LE(dir + 14);
        for (let i = 0; i < named + ids; i++) {
            const e = dir + 16 + i * 8;
            const nameOrId = exe.readUInt32LE(e);
            const child = exe.readUInt32LE(e + 4);
            // A NAMED entry at any level is dropped: nothing this writes uses one,
            // and carrying a name would mean carrying its string table too.
            if (nameOrId & 0x80000000) continue;
            if (child & 0x80000000) {
                walk(child & 0x7fffffff, [...path, nameOrId]);
            } else {
                const dataRva = exe.readUInt32LE(base + child);
                const size = exe.readUInt32LE(base + child + 4);
                const file = fileOf(dataRva);
                if (file < 0) continue;
                const [type, id] = [...path, nameOrId];
                out.push({ type, id, lang: nameOrId, data: exe.subarray(file, file + size) });
            }
        }
    };
    walk(0, []);
    return out;
}

/** Serialize `[{type, id, lang, data}]` into a resource section placed at @p rva. */
function writeResources(entries, rva) {
    const byType = new Map();
    for (const e of entries) {
        if (!byType.has(e.type)) byType.set(e.type, new Map());
        const byId = byType.get(e.type);
        if (!byId.has(e.id)) byId.set(e.id, []);
        byId.get(e.id).push(e);
    }
    // ID entries must be ASCENDING: the loader binary-searches them, so an
    // out-of-order tree parses and then cannot be looked up.
    const types = [...byType.keys()].sort((a, b) => a - b);

    let dirBytes = 16 + types.length * 8;
    for (const t of types) {
        const byId = byType.get(t);
        dirBytes += 16 + byId.size * 8;
        for (const list of byId.values()) dirBytes += 16 + list.length * 8;
    }
    const dataEntryCount = entries.length;
    const dataEntriesAt = dirBytes;
    let blobsAt = align(dataEntriesAt + dataEntryCount * 16, 8);

    let total = blobsAt;
    for (const e of entries) total = align(total + e.data.length, 8);
    const out = Buffer.alloc(total);

    const writeDir = (at, count) => {
        out.writeUInt32LE(0, at);        // characteristics
        out.writeUInt32LE(0, at + 4);    // timestamp
        out.writeUInt32LE(0, at + 8);    // version
        out.writeUInt16LE(0, at + 12);   // named entries — none, see readResources
        out.writeUInt16LE(count, at + 14);
    };

    let cursor = 16 + types.length * 8;
    let dataEntry = dataEntriesAt;
    let blob = blobsAt;
    writeDir(0, types.length);
    types.forEach((type, i) => {
        const typeEntryAt = 16 + i * 8;
        out.writeUInt32LE(type, typeEntryAt);
        out.writeUInt32LE((cursor | 0x80000000) >>> 0, typeEntryAt + 4);

        const byId = byType.get(type);
        const ids = [...byId.keys()].sort((a, b) => a - b);
        const idDirAt = cursor;
        writeDir(idDirAt, ids.length);
        cursor += 16 + ids.length * 8;

        ids.forEach((id, j) => {
            const idEntryAt = idDirAt + 16 + j * 8;
            out.writeUInt32LE(id, idEntryAt);
            out.writeUInt32LE((cursor | 0x80000000) >>> 0, idEntryAt + 4);

            const langs = byId.get(id);
            const langDirAt = cursor;
            writeDir(langDirAt, langs.length);
            cursor += 16 + langs.length * 8;

            langs.forEach((entry, k) => {
                const langEntryAt = langDirAt + 16 + k * 8;
                out.writeUInt32LE(entry.lang, langEntryAt);
                out.writeUInt32LE(dataEntry, langEntryAt + 4);
                // An RVA, not an offset into this section — the one field in the
                // tree that is not section-relative.
                out.writeUInt32LE(rva + blob, dataEntry);
                out.writeUInt32LE(entry.data.length, dataEntry + 4);
                out.writeUInt32LE(0, dataEntry + 8);    // code page
                out.writeUInt32LE(0, dataEntry + 12);
                entry.data.copy(out, blob);
                blob = align(blob + entry.data.length, 8);
                dataEntry += 16;
            });
        });
    });
    return out;
}

/**
 * Give @p exe the icon in @p png.
 *
 * @param {Buffer} exe A Windows executable.
 * @param {Buffer} png A square PNG; scaled down to the largest icon size it
 *   covers, because 256 is the largest the format has.
 * @returns {Buffer} the executable, with its icon replaced.
 */
export function setExeIcon(exe, png) {
    const image = decodePng(png);
    if (image.width !== image.height) throw new Error('an icon must be square');
    const size = [...ICON_SIZES].reverse().find((s) => s <= image.width);
    if (!size) throw new Error(`a ${image.width}px icon is under the smallest Windows slot (16)`);

    const rgba = image.channels === 4
        ? image.data
        : Buffer.from(Uint8Array.from({ length: image.width * image.height * 4 }, (_, i) => (
            i % 4 === 3 ? 255 : image.data[Math.floor(i / 4) * image.channels + (i % 4)]
        )));
    const scaled = size === image.width ? rgba : resampleRgba(rgba, image.width, image.height, size, size);
    const icon = iconImage(scaled, size);

    const layout = peLayout(exe);
    const kept = readResources(exe, layout)
        .filter((e) => e.type !== RT_ICON && e.type !== RT_GROUP_ICON);
    const entries = [
        ...kept,
        { type: RT_ICON, id: 1, lang: LANG_EN_US, data: icon },
        { type: RT_GROUP_ICON, id: 1, lang: LANG_EN_US, data: iconGroup(size, icon.length, 1) },
    ];

    const sections = sectionsOf(exe, layout);
    if (layout.sectionTable + (layout.sections + 1) * 40 > layout.sizeOfHeaders) {
        throw new Error('no room in the PE header for another section');
    }
    const end = sections.reduce((n, s) => Math.max(n, s.virtualAddress + s.virtualSize), 0);
    const rva = align(end, layout.sectionAlignment);
    const tree = writeResources(entries, rva);
    const rawPointer = align(exe.length, layout.fileAlignment);
    const rawSize = align(tree.length, layout.fileAlignment);

    const out = Buffer.alloc(rawPointer + rawSize);
    exe.copy(out);
    tree.copy(out, rawPointer);

    const header = layout.sectionTable + layout.sections * 40;
    out.fill(0, header, header + 40);
    out.write('.rsrc', header, 'ascii');
    out.writeUInt32LE(tree.length, header + 8);
    out.writeUInt32LE(rva, header + 12);
    out.writeUInt32LE(rawSize, header + 16);
    out.writeUInt32LE(rawPointer, header + 20);
    // Initialized data, read-only: what a resource section is, and what the
    // loader maps it as.
    out.writeUInt32LE(0x40000040, header + 36);

    out.writeUInt16LE(layout.sections + 1, layout.pe + 6);
    out.writeUInt32LE(align(rva + tree.length, layout.sectionAlignment), layout.sizeOfImage);
    out.writeUInt32LE(rva, layout.dataDirs + 2 * 8);
    out.writeUInt32LE(tree.length, layout.dataDirs + 2 * 8 + 4);
    // The checksum covers the whole file; a stale one is what makes an executable
    // "corrupt" to the tools that check it. Zero means "not computed", which is
    // what a linker leaves unless asked, so a zero stays zero.
    const checksumAt = layout.pe + 24 + 64;
    if (out.readUInt32LE(checksumAt) !== 0) out.writeUInt32LE(peChecksum(out, checksumAt), checksumAt);
    return out;
}

/** The PE checksum: a 16-bit ones'-complement sum of the file, plus its length,
 *  with the checksum field itself read as zero. */
function peChecksum(buf, checksumAt) {
    let sum = 0;
    for (let at = 0; at + 1 < buf.length; at += 2) {
        if (at === checksumAt) { at += 2; continue; }
        sum += buf.readUInt16LE(at);
        sum = (sum & 0xffff) + (sum >>> 16);
    }
    if (buf.length % 2) {
        sum += buf[buf.length - 1];
        sum = (sum & 0xffff) + (sum >>> 16);
    }
    return (sum + buf.length) >>> 0;
}
