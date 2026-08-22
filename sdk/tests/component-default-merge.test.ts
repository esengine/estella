// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Data written before a field grew is still read as that field.
 *
 * A component's fields gain axes: a gravity that was a pair becomes a triple the
 * day the engine learns about depth. Every scene, prefab and save already on disk
 * carries the pair. Overwriting the default wholesale drops what the data does
 * not carry, and the result is not an error — it is a value with a missing
 * component, which reads as zero and draws on a plane the scene left. Two of the
 * engine's own particle scenes went black exactly that way.
 */
import { describe, it, expect } from 'vitest';
import { mergeIntoDefaults, defineComponent, clearUserComponents } from '../src/ecs/component';

describe('mergeIntoDefaults', () => {
    it('fills in the axis older data does not carry', () => {
        const merged = mergeIntoDefaults({ gravity: { x: 0, y: 0, z: 0 } },
                                         { gravity: { x: 1, y: -2 } as never });
        expect(merged.gravity).toEqual({ x: 1, y: -2, z: 0 });
    });

    it('takes every field the data does carry', () => {
        expect(mergeIntoDefaults({ size: { x: 1, y: 1, z: 1 } }, { size: { x: 5, y: 6, z: 7 } }))
            .toEqual({ size: { x: 5, y: 6, z: 7 } });
    });

    it('replaces arrays rather than merging them', () => {
        expect(mergeIntoDefaults({ stops: [1, 2, 3] }, { stops: [9] })).toEqual({ stops: [9] });
    });

    // Two entities that both took the default would otherwise write into one
    // array — the aliasing that makes one entity's edit appear on another.
    it('copies the defaults rather than handing out the same objects', () => {
        const defaults = { pos: { x: 0, y: 0 }, tags: [] as string[] };
        const a = mergeIntoDefaults(defaults);
        const b = mergeIntoDefaults(defaults);
        a.pos.x = 5;
        a.tags.push('one');
        expect(b.pos.x).toBe(0);
        expect(b.tags).toEqual([]);
        expect(defaults.pos.x).toBe(0);
    });

    it('leaves flat fields alone, including nulls and undefined', () => {
        expect(mergeIntoDefaults({ a: 1, b: 'x' }, { a: 2, b: undefined }))
            .toEqual({ a: 2, b: 'x' });
        expect(mergeIntoDefaults({ ref: null as string | null }, { ref: 'set' })).toEqual({ ref: 'set' });
    });

    // The script path merges through `create`; the builtin path through the
    // bridge. Same rule, or a C++ component and a TS one disagree about what an
    // incomplete vector means.
    it('is what a script component create does', () => {
        clearUserComponents();
        const Comp = defineComponent('MergeProbe', { v: { x: 0, y: 0, z: 0 }, n: 1 });
        expect(Comp.create({ v: { x: 3, y: 4 } as never })).toEqual({ v: { x: 3, y: 4, z: 0 }, n: 1 });
        clearUserComponents();
    });
});
