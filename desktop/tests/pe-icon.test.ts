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
import { solidPng } from './helpers/png';
import { fakePe, readResources } from './helpers/pe';




describe('the icon inside a Windows executable', () => {
    it('writes an icon and the group that names it', () => {
        const out = setExeIcon(fakePe(), solidPng(64, [10, 20, 30, 255]));
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
        const res = readResources(setExeIcon(fakePe(), solidPng(32, [1, 2, 3, 255])));
        const manifest = res.find((r) => r.type === 24);
        expect(manifest?.data.toString('ascii')).toBe('<assembly/>');
    });

    it('leaves the headers describing the file it produced', () => {
        const before = fakePe();
        const after = setExeIcon(before, solidPng(64, [0, 0, 0, 255]));
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
        const res = readResources(setExeIcon(fakePe(), solidPng(1024, [200, 100, 50, 255])));
        const icon = res.find((r) => r.type === 3)!;
        expect(icon.data.readInt32LE(4)).toBe(256);
        // 256 is written as ZERO in the group entry — the field is one byte.
        expect(res.find((r) => r.type === 14)!.data[6]).toBe(0);
    });

    it('takes a size the format has, not the picture\'s own', () => {
        const res = readResources(setExeIcon(fakePe(), solidPng(100, [0, 255, 0, 255])));
        expect(res.find((r) => r.type === 3)!.data.readInt32LE(4)).toBe(64);
    });

    it('refuses what it cannot honestly write', () => {
        expect(() => setExeIcon(fakePe(), solidPng(8, [0, 0, 0, 255]))).toThrow(/smallest Windows slot/);
        expect(() => setExeIcon(Buffer.alloc(64), solidPng(32, [0, 0, 0, 255]))).toThrow(/not a PE/);
    });

    it('gives an executable with no resources at all one', () => {
        const res = readResources(setExeIcon(fakePe(false), solidPng(32, [4, 5, 6, 255])));
        expect(res.map((r) => r.type).sort((a, b) => a - b)).toEqual([3, 14]);
    });
});
