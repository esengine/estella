// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where a session's new entity ids come from. Two people editing the same
 *        scene must not both name their first new entity the same thing, or the
 *        merged file has two entities answering to one id.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModel } from '@/engine/SceneModel';

function fixture(highestId: number): SceneData {
    return {
        version: 1,
        name: 'fixture',
        entities: Array.from({ length: highestId }, (_, i) => ({
            id: i + 1,
            name: `E${i + 1}`,
            parent: null,
            children: [],
            components: [],
        })),
    } as unknown as SceneData;
}

describe('source id allocation', () => {
    beforeEach(() => SceneModel.clear());
    afterEach(() => vi.restoreAllMocks());

    it('starts a session at a distance from the ids already in the file', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        SceneModel.adopt(fixture(3), new Map());
        // 3 is the highest in the file; the session starts 0x8000 past it.
        expect(SceneModel.addEntity('New', [])).toBe(3 + 1 + 0x8000);
    });

    it('gives two sessions on the same file different ids', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.25);
        SceneModel.adopt(fixture(3), new Map());
        const first = SceneModel.addEntity('New', []);

        SceneModel.clear();
        vi.spyOn(Math, 'random').mockReturnValue(0.75);
        SceneModel.adopt(fixture(3), new Map());
        const second = SceneModel.addEntity('New', []);

        expect(first).not.toBe(second);
    });

    it('numbers an empty scene from 1 — there is no other version of it to merge', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        SceneModel.adopt(fixture(0), new Map());
        expect(SceneModel.addEntity('First', [])).toBe(1);
    });

    it('keeps allocating upward within one session', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        SceneModel.adopt(fixture(2), new Map());
        const a = SceneModel.addEntity('A', []);
        const b = SceneModel.addEntity('B', []);
        expect(b).toBe(a + 1);
    });
});
