// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { packCorners, resolveAutotile, resolveAutotileMatch, resolveWang, resolveWangMatch, TB_N, TB_E } from '../src/tilemap/autotile';

describe('terrain match diagnostics', () => {
    it.each(['edge', 'corner'] as const)('reports exact, nearest and empty %s matches without changing the resolver', mode => {
        const index = { mode, byMask: new Map([[TB_N, 7], [TB_E, 9]]) };
        const north = [true, false, false, false, false, false, false, false];
        expect(resolveAutotileMatch(index, north)).toEqual({ tileId: 7, exact: true, mask: TB_N });
        expect(resolveAutotileMatch(index, [])).toEqual({ tileId: 7, exact: false, mask: 0 });
        expect(resolveAutotile(index, [])).toBe(resolveAutotileMatch(index, []).tileId);
        expect(resolveAutotileMatch({ mode, byMask: new Map() }, [])).toEqual({ tileId: 0, exact: false, mask: 0 });
    });
    it('reports missing Wang combinations, preserving deterministic fallback', () => {
        const key = packCorners(1, 1, 1, 1);
        const index = { byKey: new Map([[key, 3], [packCorners(2, 2, 2, 2), 4]]) };
        expect(resolveWangMatch(index, [1, 1, 1, 1])).toEqual({ tileId: 3, exact: true, key });
        expect(resolveWangMatch(index, [1, 2, 1, 2])).toEqual({ tileId: 3, exact: false, key: packCorners(1, 2, 1, 2) });
        expect(resolveWang(index, [1, 2, 1, 2])).toBe(3);
        expect(resolveWangMatch({ byKey: new Map() }, [])).toEqual({ tileId: 0, exact: false, key: 0 });
    });
});
