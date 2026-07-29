// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The two coercions every inspector edit passes through, and the two ways they
// used to destroy a value on the way to the model:
//
//  - an `enum` is not always an int. A C++ enum's options are ordinals, but an
//    option read off an asset (which animation, which armature) IS a name — and
//    `Number('walk')` is NaN, which read back as an empty dropdown showing "()".
//  - a vec/box edit writes ONE axis and merges the rest. Merging onto data that
//    does not carry the field yet (it is at its default, or the runtime owns it)
//    produced a PARTIAL value that nothing downstream could read.
import { describe, it, expect } from 'vitest';
import { toModelValue } from '@/engine/SceneCommands';
import { coerceFieldValue, splitFieldMember, patchFieldMember } from '@/engine/EditorControlSurface';

describe('toModelValue', () => {
    it('keeps a name-valued enum as the name', () => {
        expect(toModelValue({}, 'enum', 'animation', 'walk')).toBe('walk');
        expect(toModelValue({ animation: 'stand' }, 'enum', 'animation', 'jump')).toBe('jump');
    });

    it('still stores an ordinal enum as a number, including a numeric string', () => {
        expect(toModelValue({}, 'enum', 'projectionType', 1)).toBe(1);
        expect(toModelValue({}, 'enum', 'projectionType', true)).toBe(1);
    });

    it('merges a single vec axis onto the rest of the value', () => {
        const cur = { position: { x: 1, y: 2, z: 3 } };
        expect(toModelValue(cur, 'vec3', 'position', [9, NaN, NaN])).toEqual({ x: 9, y: 2, z: 3 });
    });

    it('is given an EFFECTIVE base by the write door, so an omitted field still merges whole', () => {
        // The door merges the component's defaults under its stored data before
        // calling in (see writeField_); this is that contract from the callee's side.
        const effective = { position: { x: 0, y: 0, z: 0 } }; // default, nothing stored
        expect(toModelValue(effective, 'vec3', 'position', [50, NaN, NaN])).toEqual({ x: 50, y: 0, z: 0 });
    });
});

describe('coerceFieldValue (the automation door)', () => {
    const ANIMS = [
        { label: 'stand', value: 'stand' },
        { label: 'walk', value: 'walk' },
    ];

    it('accepts a name for an enum whose options are names', () => {
        expect(coerceFieldValue('enum', 'animation', 'walk', ANIMS)).toBe('walk');
    });

    it('refuses a name the field cannot hold, naming what it can', () => {
        expect(() => coerceFieldValue('enum', 'animation', 'sprint', ANIMS))
            .toThrow(/stand, walk/);
    });

    it('leaves an ordinal enum coercing to a number', () => {
        expect(coerceFieldValue('enum', 'projectionType', '1', [{ label: 'Ortho', value: 1 }])).toBe(1);
        expect(coerceFieldValue('enum', 'projectionType', 2)).toBe(2);
    });
});

// A field path like "Transform.position.x" is what automation reaches for first —
// the MCP tool advertised that exact example while the surface rejected it,
// because the inspector's field is `position`, a whole vec3.
describe('structural field members (the "position.x" door)', () => {
    const typeOf = (k: string) => (({
        position: 'vec3', gap: 'vec2', padding: 'sides', width: 'dimension', content: 'string',
    } as Record<string, string>)[k]) as never;

    it('splits a path only when the base really is a structural field', () => {
        expect(splitFieldMember('position.x', typeOf)).toEqual({ key: 'position', member: 'x', type: 'vec3' });
        expect(splitFieldMember('gap.y', typeOf)).toEqual({ key: 'gap', member: 'y', type: 'vec2' });
        expect(splitFieldMember('padding.left', typeOf)).toEqual({ key: 'padding', member: 'left', type: 'sides' });
        expect(splitFieldMember('width.unit', typeOf)).toEqual({ key: 'width', member: 'unit', type: 'dimension' });
    });

    it('is not a path when the member does not exist, or the field has no members', () => {
        expect(splitFieldMember('position.w', typeOf)).toBeNull();   // vec3 has x/y/z
        expect(splitFieldMember('gap.z', typeOf)).toBeNull();        // vec2 has x/y
        expect(splitFieldMember('content.length', typeOf)).toBeNull(); // a string has none
        expect(splitFieldMember('unknown.x', typeOf)).toBeNull();
        expect(splitFieldMember('position', typeOf)).toBeNull();
    });

    it('writes one member and keeps the rest', () => {
        expect(patchFieldMember('vec3', [1, 2, 3], 'y', 9)).toEqual([1, 9, 3]);
        expect(patchFieldMember('vec2', [4, 5], 'x', 0)).toEqual([0, 5]);
        expect(patchFieldMember('sides', [1, 2, 3, 4], 'bottom', 8)).toEqual([1, 2, 3, 8]);
        expect(patchFieldMember('dimension', { value: 10, unit: 0 }, 'unit', 2)).toEqual({ value: 10, unit: 2 });
    });

    it('fills a short or missing value rather than writing past its end', () => {
        expect(patchFieldMember('vec3', [], 'z', 7)).toEqual([0, 0, 7]);
        expect(patchFieldMember('dimension', null as never, 'value', 3)).toEqual({ value: 3 });
    });

    it('refuses a member that is not a number, and one that does not exist', () => {
        expect(() => patchFieldMember('vec3', [0, 0, 0], 'x', 'left')).toThrow(/expects a number/);
        expect(() => patchFieldMember('vec3', [0, 0, 0], 'w', 1)).toThrow(/no member "w"/);
    });

    it('takes a numeric string, which is what a schema-loose client sends', () => {
        expect(patchFieldMember('vec2', [0, 0], 'y', '12.5')).toEqual([0, 12.5]);
    });
});
