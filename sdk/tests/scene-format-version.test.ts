// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-format-version.test.ts
 * @brief   The format version answers one question — older, current, or newer —
 *          and a dotted version cannot answer it.
 *
 *          `parseFloat` reads "1.10" as 1.1 and sorts it BELOW "1.2", and reads
 *          "1.0.1" as 1, dropping the patch. While only "1.0" is ever written
 *          every test passes either way — these are the cases that separate them,
 *          so the tenth revision of the format cannot count as older than the
 *          second.
 */
import { describe, it, expect } from 'vitest';
import {
    SCENE_FORMAT_VERSION,
    parseSceneFormatVersion,
    migrateSceneData,
    type SceneData,
} from '../src/scene/scene';

const scene = (version: unknown): SceneData =>
    ({ version, name: 'test', entities: [] } as unknown as SceneData);

describe('scene format version', () => {
    it('is an integer, so ordering is ordering', () => {
        expect(Number.isInteger(SCENE_FORMAT_VERSION)).toBe(true);
        expect(SCENE_FORMAT_VERSION).toBeGreaterThan(0);
    });

    it('orders the way parseFloat could not', () => {
        expect(parseSceneFormatVersion(10)).toBeGreaterThan(parseSceneFormatVersion(2));
        expect(parseSceneFormatVersion(10)).toBeGreaterThan(parseSceneFormatVersion(9));
        // The old reading: "1.10" → 1.1 < "1.2" → 1.2. Both are format 1 now.
        expect(parseSceneFormatVersion('1.10')).toBe(parseSceneFormatVersion('1.2'));
    });

    it('reads every legacy spelling as format 1', () => {
        for (const legacy of ['1.0', '1', '1.0.1', '1.2', '1.10']) {
            expect(parseSceneFormatVersion(legacy)).toBe(1);
        }
    });

    it('treats a missing or unreadable version as the oldest format, not zero', () => {
        for (const bad of [undefined, null, '', 'nonsense', {}, [], NaN, 0, -3, 1.5]) {
            expect(parseSceneFormatVersion(bad)).toBe(1);
        }
    });

    it('migrating stamps the integer and reports integers', () => {
        const result = migrateSceneData(scene('1.0'));
        expect(result.data.version).toBe(SCENE_FORMAT_VERSION);
        expect(result.fromVersion).toBe(1);
        expect(result.toVersion).toBe(SCENE_FORMAT_VERSION);
    });

    it('a legacy file still loads', () => {
        expect(() => migrateSceneData(scene('1.0'))).not.toThrow();
        expect(() => migrateSceneData(scene(1))).not.toThrow();
    });

    it('a file from a newer engine is refused', () => {
        expect(() => migrateSceneData(scene(SCENE_FORMAT_VERSION + 1)))
            .toThrow(/newer than this engine supports/);
    });

    it('a two-digit future version is refused, not mistaken for an old one', () => {
        // The case the old comparison got backwards: parseFloat("1.10") < 1.2 read
        // a tenth-revision file as older and would have "migrated" it.
        expect(() => migrateSceneData(scene(10))).toThrow(/newer than this engine supports/);
    });
});
