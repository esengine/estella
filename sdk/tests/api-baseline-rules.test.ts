// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The direction of the api-surface baseline rules.
 *
 * `--check-baseline` forgives some shape changes to a released @public symbol
 * and fails others, and the difference is a DIRECTION: a surface that grew
 * breaks nobody who already used it, a surface that shrank does. The forgiving
 * half is the half that can quietly stop guarding, so it is pinned here — a
 * union that lost a member must still fail.
 */
import { describe, it, expect } from 'vitest';
import { isAdditiveMembers, isWidenedUnion } from '../../tools/lib/apiSnapshot.mjs';

describe('api baseline: what counts as additive', () => {
    const A = "'texture' | 'material' | 'font'";
    const B = "'texture' | 'material' | 'font' | 'mesh'";

    it('a union that gained a member is additive', () => {
        expect(isWidenedUnion(A, B)).toBe(true);
    });

    it('a union that LOST a member is not', () => {
        expect(isWidenedUnion(B, A)).toBe(false);
    });

    it('a union whose member was renamed is not — the old value stopped being legal', () => {
        expect(isWidenedUnion(A, "'texture' | 'material' | 'fonts' | 'mesh'")).toBe(false);
    });

    it('an unchanged union is not additive (nothing was gained)', () => {
        expect(isWidenedUnion(A, A)).toBe(false);
    });

    it('non-literal unions are left alone — widening `string` proves nothing', () => {
        expect(isWidenedUnion('string | number', 'string | number | boolean')).toBe(false);
    });

    it('an interface gaining an OPTIONAL member is additive', () => {
        expect(isAdditiveMembers('a: string', 'a: string\nb: number | undefined')).toBe(true);
    });

    it('an interface gaining a REQUIRED member is not', () => {
        expect(isAdditiveMembers('a: string', 'a: string\nb: number')).toBe(false);
    });

    it('an interface that lost a member is not', () => {
        expect(isAdditiveMembers('a: string\nb: number | undefined', 'a: string')).toBe(false);
    });
});
