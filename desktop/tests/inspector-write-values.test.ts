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
import { coerceFieldValue } from '@/engine/EditorControlSurface';

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
