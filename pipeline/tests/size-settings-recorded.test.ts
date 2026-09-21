// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A build compared against the last one blames the right thing.
 *
 * The comparison exists to separate "you shipped more" from "you packed it
 * differently". Three settings that pack it differently — source maps, the
 * engine's brotli, the engine 分包 — reached the export and were never written
 * into the record, so flipping one reported 1.4MB of content nobody wrote.
 *
 * The gate next door proves every packaging setting has DECLARED an effect.
 * This proves the declaration is wired: a lever named there actually lands in
 * the record, and a build that flips it says so.
 */
import { describe, it, expect } from 'vitest';
import {
    compareSizes, sizeSettingsOf, PACKAGING_SIZE_ROLE,
    type SizeRecord, type SizeSettings,
} from '../src/export/sizeHistory';

const record = (settings: SizeSettings, bytes: number): SizeRecord => ({
    at: '2026-09-21T00:00:00.000Z',
    platform: 'wechat',
    settings,
    initialBytes: bytes,
    lazyBytes: 0,
    remoteBytes: 0,
    packageBytes: bytes,
    totalBytes: bytes,
    fileCount: 1,
    files: [{ path: 'wasm/esengine.wasm', bytes, kind: 'engine', bucket: 'initial' }],
});

/** Every role that names a SizeSettings key, deduplicated. */
const LEVERS = [...new Set(Object.values(PACKAGING_SIZE_ROLE))]
    .filter((r): r is keyof SizeSettings => r !== 'content' && r !== 'inert');

describe('the settings a measurement is recorded with', () => {
    it('carries every lever the role table names', () => {
        const all = Object.fromEntries(LEVERS.map((k) => [k, true])) as SizeSettings;
        expect(Object.keys(sizeSettingsOf(all)).sort()).toEqual([...LEVERS].sort());
    });

    it('leaves out what the export was not told, so "off" and "unset" stay apart', () => {
        expect(sizeSettingsOf({ minify: false })).toEqual({ minify: false });
    });

    // The failing shape, one lever at a time: same content, packed differently.
    it.each(LEVERS)('names %s when a build flips it, instead of blaming content', (lever) => {
        const before = record({ [lever]: false }, 1_800_000);
        const after = record({ [lever]: true }, 360_000);
        const diff = compareSizes(before, after);
        expect(diff.settingsChanged).toContain(lever);
    });

    it('says nothing changed when the settings and the files are the same', () => {
        const same = { compressWasm: true, minify: true };
        const diff = compareSizes(record(same, 360_000), record(same, 360_000));
        expect(diff.settingsChanged).toEqual([]);
        expect(diff.changes).toEqual([]);
    });
});
