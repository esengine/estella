// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Play-realm asset ref resolution: uuid refs → manifest, project-relative
 *        paths (spine skel/atlas, …) → the project root, not the play subdir.
 */
import { describe, it, expect } from 'vitest';
import { resolvePlayAssetRef } from '../src/playRealmRuntime';

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
});
