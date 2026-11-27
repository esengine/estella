// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { findDocumentAsset, resolveDocumentRef, resolveIndexedProjectRef, resolveIndexedSiblingRef, resolveRelativePath } from '../src/asset/documentRef';

describe('authored document references', () => {
    const material = 'assets/mats/m.esmaterial';
    it('preserves indexed identities, builtins and standalone URLs', () => {
        const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000';
        for (const ref of [uuid, '@uuid:' + uuid, 'builtin:model', '//cdn.net/a.png', 'https://cdn.net/a.png', 'data:image/png;base64,Ag==']) {
            expect(resolveDocumentRef(material, ref)).toBe(ref);
            expect(findDocumentAsset(material, ref, () => 'wrong')).toBeUndefined();
        }
    });
    it('joins against the document path and preserves URL query text and local roots', () => {
        expect(resolveDocumentRef(material, '../textures/a.png')).toBe('assets/textures/a.png');
        expect(resolveDocumentRef(material, 'assets/textures/a.png')).toBe('assets/textures/a.png');
        expect(resolveDocumentRef('estella://project/mats/m.esmaterial?v=/old', '../textures/a.png?key=/a/../b'))
            .toBe('estella://project/textures/a.png?key=/a/../b');
        expect(resolveDocumentRef('/game/mats/m.esmaterial', '..\\textures\\a.png')).toBe('/game/textures/a.png');
        expect(resolveDocumentRef('mats/m.esmaterial', '../../a.png')).toBe('a.png');
        expect(resolveRelativePath('../sets/b.tsj', '../a.png')).toBe('../a.png');
    });
    it('honours qualified paths and the owner format’s preference for older unqualified names', () => {
        const files = new Set(['a.png', 'assets/mats/a.png', 'b.png']);
        const lookup = (name: string) => files.has(name) ? name : undefined;
        expect(findDocumentAsset(material, './a.png', lookup)).toBe('assets/mats/a.png');
        expect(findDocumentAsset(material, './b.png', lookup)).toBeUndefined();
        expect(findDocumentAsset(material, '/a.png', lookup, 'document')).toBe('a.png');
        expect(findDocumentAsset(material, 'a.png', lookup)).toBe('a.png');
        expect(findDocumentAsset(material, 'a.png', lookup, 'document')).toBe('assets/mats/a.png');
    });

    it('matches a local file with a URL suffix without changing literal names or unindexed URLs', () => {
        const files = new Set(['art.png', 'assets/mats/art.png', 'assets/mats/literal#tile.png']);
        const known = (path: string) => files.has(path);
        expect(resolveIndexedSiblingRef(material, 'art.png?v=2#layer', known)).toBe('assets/mats/art.png');
        expect(resolveIndexedProjectRef(material, 'art.png?v=2#layer', known)).toBe('art.png');
        expect(resolveIndexedSiblingRef(material, './art.png?v=2#layer', known)).toBe('assets/mats/art.png');
        expect(resolveIndexedSiblingRef(material, '/art.png?v=2#layer', known)).toBe('art.png');
        expect(resolveIndexedSiblingRef(material, './literal#tile.png', known)).toBe('assets/mats/literal#tile.png');
        expect(resolveIndexedSiblingRef(material, './missing.png?v=2#layer', known)).toBe('assets/mats/missing.png?v=2#layer');
        expect(resolveIndexedSiblingRef(material, 'https://cdn.test/art.png?v=2#layer', known)).toBe('https://cdn.test/art.png?v=2#layer');
    });
});
