// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Play-realm asset ref resolution: uuid refs → manifest, project-relative
 *        paths (spine skel/atlas, …) → the project root, not the play subdir.
 */
import { describe, it, expect } from 'vitest';
import { resolvePlayAssetRef } from '../src/runtime/playRealmRuntime';

const MANIFEST = { 'aaaa': 'estella://project/assets/textures/hero.png' };
const BASE = 'estella://project';

describe('resolvePlayAssetRef', () => {
    it('resolves a uuid ref through the manifest', () => {
        expect(resolvePlayAssetRef('@uuid:AAAA', MANIFEST, BASE)).toBe('estella://project/assets/textures/hero.png');
    });

    it('resolves a project-relative path against the project root (was 404 in the play subdir)', () => {
        expect(resolvePlayAssetRef('assets/spine/spineboy.atlas', MANIFEST, BASE)).toBe('estella://project/assets/spine/spineboy.atlas');
    });

    it('normalizes a leading slash and a trailing slash on the base', () => {
        expect(resolvePlayAssetRef('/assets/spine/x.skel', MANIFEST, 'estella://project/')).toBe('estella://project/assets/spine/x.skel');
    });

    it('leaves a path unchanged when no base is given (shipped game keeps its own manifest)', () => {
        expect(resolvePlayAssetRef('assets/spine/x.atlas', MANIFEST, undefined)).toBe('assets/spine/x.atlas');
    });

    it('throws for a uuid ref missing from the manifest', () => {
        expect(() => resolvePlayAssetRef('@uuid:zzzz', MANIFEST, BASE)).toThrow(/not in play manifest/);
    });

    // .esanim flipbook frames serialize BARE uuids (no @uuid: prefix); those must
    // hit the manifest, not the path branch (which 404s on a uuid-shaped "path").
    it('resolves a bare uuid-shaped ref through the manifest', () => {
        const uuid = 'e43a0ed9-50e9-46d8-b1db-da1c549590a8';
        const manifest = { [uuid]: 'estella://project/assets/textures/idle_0.png' };
        expect(resolvePlayAssetRef(uuid, manifest, BASE)).toBe('estella://project/assets/textures/idle_0.png');
        expect(resolvePlayAssetRef(uuid.toUpperCase(), manifest, BASE)).toBe('estella://project/assets/textures/idle_0.png');
    });

    // Cooked builds: content-addressed staging renames physical files, so a
    // logical path resolves through the pathMap — to the extension-bearing
    // staged path (a .png staged as .ktx2 must sniff as KTX2), same contract
    // as the uuid branch. Leading "/" and "./" spellings hit the same entry.
    describe('cooked pathMap', () => {
        const pathMap = {
            'assets/hero.png': './assets/1234567890abcdef.ktx2',
            'assets/red.esmaterial': './assets/fedcba0987654321.esmaterial',
        };

        it('maps a logical path to its staged file', () => {
            expect(resolvePlayAssetRef('assets/hero.png', {}, undefined, pathMap))
                .toBe('./assets/1234567890abcdef.ktx2');
        });

        it('normalizes leading "/" and "./" spellings', () => {
            expect(resolvePlayAssetRef('/assets/red.esmaterial', {}, undefined, pathMap))
                .toBe('./assets/fedcba0987654321.esmaterial');
            expect(resolvePlayAssetRef('./assets/red.esmaterial', {}, undefined, pathMap))
                .toBe('./assets/fedcba0987654321.esmaterial');
        });

        it('falls through to the path branch for unmapped refs', () => {
            expect(resolvePlayAssetRef('assets/other.png', {}, undefined, pathMap))
                .toBe('assets/other.png');
        });

        it('uuid refs take priority over the pathMap', () => {
            expect(resolvePlayAssetRef('@uuid:AAAA', MANIFEST, undefined, pathMap))
                .toBe('estella://project/assets/textures/hero.png');
        });
    });
});
