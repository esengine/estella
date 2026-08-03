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
import {
  EXT_TO_TYPE as SHARED, metaTypeForContent, needsContentType, isProjectPlumbing,
} from '../../tools/assetMetaTable.js';

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

    it('types a DragonBones pair by its name suffix (`.json` alone cannot)', () => {
        expect(metaTypeFor('DragonBoy_ske.json')).toBe('dragonbones');
        expect(metaTypeFor('DragonBoy_tex.json')).toBe('dragonbones');
        expect(metaTypeFor('DragonBoy.dbbin')).toBe('dragonbones');
    });
});

// A Spine skeleton exported as JSON is a plain `.json` under whatever name the
// artist chose — and Spine 2.1 has NO binary export, so that is the only form
// such a project can hand the editor. It is typed by the marker inside the file:
// the same one the runtime's version detection reads, so the editor and the
// runtime cannot disagree about what a given `.json` is.
describe('content-typed assets', () => {
    const SKELETON = '{"skeleton":{"hash":"4NGJIALC","spine":"2.1.27","width":1371.35},"bones":[]}';

    it('claims only the files a name cannot type', () => {
        expect(needsContentType('skeleton.json')).toBe(true);
        expect(needsContentType('hero.png')).toBe(false);
        expect(needsContentType('level.tmj')).toBe(false);
        // A name that DOES type it is not up for content review.
        expect(needsContentType('DragonBoy_ske.json')).toBe(false);
    });

    it('types a Spine JSON skeleton as spine', () => {
        expect(metaTypeForContent('skeleton.json', SKELETON)).toBe('spine');
        expect(metaTypeForContent('boy.json', '{"skeleton":{"spine":"4.2.31"},"bones":[]}')).toBe('spine');
        // Pretty-printed exports read the same.
        expect(metaTypeForContent('x.json', '{\n  "skeleton": {\n    "spine": "3.8.99"\n  }\n}')).toBe('spine');
    });

    it('types a `.json` nobody else claims as data', () => {
        // The game's own tables are assets: that is what gives them a uuid, a
        // place in the manifest, and a seat in the build.
        expect(metaTypeForContent('levels.json', '{"levels":[1,2,3]}')).toBe('json');
        // "spine" outside a skeleton header is not a skeleton — it is data.
        expect(metaTypeForContent('notes.json', '{"about":"the spine: 4.2 runtime"}')).toBe('json');
    });

    it('leaves the project\'s own plumbing alone', () => {
        // These are read by the toolchain, not the game; a `.meta` beside them
        // is noise in every project that has ever existed.
        for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json']) {
            expect(needsContentType(name)).toBe(false);
            expect(metaTypeForContent(name, '{}')).toBeNull();
        }
        expect(isProjectPlumbing('a/b/tsconfig.json')).toBe(true);
        expect(isProjectPlumbing('assets/data/levels.json')).toBe(false);
    });

    it('never types a name that is not JSON at all', () => {
        expect(metaTypeForContent('README.md', '# hi')).toBeNull();
        expect(metaTypeForContent('main.ts', 'export {}')).toBeNull();
    });

    it('never overrides a name that already typed the file', () => {
        expect(metaTypeForContent('DragonBoy_ske.json', '{"armature":[]}')).toBe('dragonbones');
        expect(metaTypeForContent('hero.png', SKELETON)).toBe('texture');
    });
});
