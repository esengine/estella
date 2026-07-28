// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// What the inspector's armature and animation dropdowns read. It answers about a
// file the user chose, so every way that file can be wrong has to be an empty list
// rather than a throw — a bad path must not take the inspector down with it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDragonBonesNames } from '../src/dragonbones/skeletonNames';

const SKE = resolve(__dirname, 'assets/dragonbones/DragonBoy_ske.json');

describe('parseDragonBonesNames', () => {
    it('reads a real file`s armatures and their animations', () => {
        const found = parseDragonBonesNames(readFileSync(SKE, 'utf8'));
        expect(found).toEqual([
            { name: 'Dragon', animations: ['stand', 'walk', 'jump', 'fall'] },
        ]);
    });

    it('takes an already-parsed document too', () => {
        const doc = JSON.parse(readFileSync(SKE, 'utf8')) as object;
        expect(parseDragonBonesNames(doc)[0].name).toBe('Dragon');
    });

    it('answers nothing for anything it cannot read', () => {
        // Binary `.dbbin` content, a truncated download, another format entirely,
        // an empty file — all of them are "no names", and none is an exception.
        expect(parseDragonBonesNames(' ')).toEqual([]);
        expect(parseDragonBonesNames('{"armature":')).toEqual([]);
        expect(parseDragonBonesNames('{"not":"dragonbones"}')).toEqual([]);
        expect(parseDragonBonesNames('')).toEqual([]);
    });

    it('skips entries it cannot name instead of inventing one', () => {
        const doc = { armature: [{ animation: [] }, { name: 'Real', animation: [{ name: 'go' }, {}] }] };
        expect(parseDragonBonesNames(doc)).toEqual([{ name: 'Real', animations: ['go'] }]);
    });
});
