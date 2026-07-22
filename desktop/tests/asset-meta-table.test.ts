// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Guards the single source for the `.meta` type vocabulary. The CLI
// (tools/asset-meta.js) and the editor mint door (electron/assetMeta.ts) both
// derive from tools/assetMetaTable.js; they used to hand-mirror it and had
// drifted (`.esanim` minted as `animation` from the CLI but `animclip` from the
// editor; `.esanimator` had no CLI entry, so an imported animator controller
// never got a `.meta`).
import { describe, it, expect } from 'vitest';
import { EXT_TO_TYPE, metaTypeFor } from '../electron/assetMeta';
import { EXT_TO_TYPE as SHARED } from '../../tools/assetMetaTable.js';

describe('.meta type table (single source)', () => {
    it('the editor mint door re-exports the shared table verbatim', () => {
        expect(EXT_TO_TYPE).toBe(SHARED);
    });

    it('mints the canonical type for every engine authoring format', () => {
        expect(metaTypeFor('x.esanim')).toBe('animclip');
        expect(metaTypeFor('x.esanimclip')).toBe('animclip');
        expect(metaTypeFor('x.estimeline')).toBe('animation');
        expect(metaTypeFor('x.estileset')).toBe('tileset');
        expect(metaTypeFor('x.estilemap')).toBe('tilemap');
        expect(metaTypeFor('x.esfsm')).toBe('statemachine');
        expect(metaTypeFor('x.esbt')).toBe('behaviortree');
        expect(metaTypeFor('x.eslocale')).toBe('locale');
        expect(metaTypeFor('x.inputmap')).toBe('inputmap');
    });

    it('mints a type for an imported .esanimator (regression: was unknown → no meta)', () => {
        expect(metaTypeFor('player.esanimator')).toBe('animatorcontroller');
    });

    it('is case-insensitive and null for unknown extensions', () => {
        expect(metaTypeFor('X.ESANIM')).toBe('animclip');
        expect(metaTypeFor('notes.txt')).toBeNull();
        expect(metaTypeFor('README.md')).toBeNull();
    });
});
