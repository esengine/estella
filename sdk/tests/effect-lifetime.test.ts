// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { advanceLifetimes } from '../src/particle/effectLifetime';

describe('a one-shot that removes itself', () => {
    it('counts from the frame it first runs, and is due once it has run its seconds', () => {
        const ages = new Map<number, number>();
        const secs = () => 0.05;
        expect(advanceLifetimes(ages, [7], secs, 1 / 60)).toEqual([]);   // first frame: age 0
        expect(advanceLifetimes(ages, [7], secs, 1 / 60)).toEqual([]);   // 1/60
        expect(advanceLifetimes(ages, [7], secs, 1 / 60)).toEqual([]);   // 2/60
        expect(advanceLifetimes(ages, [7], secs, 1 / 60)).toEqual([7]);  // 3/60 = 0.05
    });

    it('forgets an entity that went some other way, and gives a new one its own clock', () => {
        const ages = new Map<number, number>([[1, 3]]);
        expect(advanceLifetimes(ages, [2], () => 1, 0.5)).toEqual([]);
        expect(ages.has(1)).toBe(false);
        expect(ages.get(2)).toBe(0);
    });

    it('holds still while the game is paused', () => {
        const ages = new Map<number, number>();
        advanceLifetimes(ages, [3], () => 1, 0.5);
        for (let i = 0; i < 100; i++) expect(advanceLifetimes(ages, [3], () => 1, 0)).toEqual([]);
    });
});
