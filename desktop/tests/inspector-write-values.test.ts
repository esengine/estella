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
import { coerceEnumInput } from '@/engine/schema';
import type { InspectorFieldValue } from '@/types';

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
        expect(coerceFieldValue('enum', 'animation', 'walk', { options: ANIMS })).toBe('walk');
    });

    it('refuses a name the field cannot hold, naming what it can', () => {
        expect(() => coerceFieldValue('enum', 'animation', 'sprint', { options: ANIMS }))
            .toThrow(/stand, walk/);
    });

    it('leaves an ordinal enum coercing to a number', () => {
        expect(coerceFieldValue('enum', 'projectionType', '1', { options: [{ label: 'Ortho', value: 1 }] })).toBe(1);
        expect(coerceFieldValue('enum', 'projectionType', 2)).toBe(2);
    });

    // A C++ enum is as closed as a skeleton's animation list; only the spelling of
    // its options differed, and that is what this door used to key off. Writing
    // BlendMode 99 is the ordinal version of writing animation "sprint".
    it('refuses an ordinal the enum does not define, naming what it does', () => {
        const MODES = [{ label: 'Alpha', value: 0 }, { label: 'Additive', value: 1 }];
        expect(coerceFieldValue('enum', 'blendMode', 1, { options: MODES })).toBe(1);
        expect(() => coerceFieldValue('enum', 'blendMode', 99, { options: MODES })).toThrow(/Additive/);
    });

    // An open numeric enum takes any LAYER, and a layer is a whole number — the
    // control refused 7.5 while this door wrote it.
    it('takes an unnamed layer but not a fractional one', () => {
        const LAYERS = [{ label: 'back', value: 0 }];
        expect(coerceFieldValue('enum', 'layer', 7, { options: LAYERS, open: true })).toBe(7);
        expect(() => coerceFieldValue('enum', 'layer', 7.5, { options: LAYERS, open: true })).toThrow(/whole number/);
    });

    // An OPEN source offers suggestions, not a closed set: a locale key with no
    // table entry yet is the normal authoring order, not a typo. The refusal above
    // and the acceptance here are the same rule reading the source's own
    // declaration — before, this path guessed from the value being a string and so
    // refused a perfectly good new key.
    it('accepts a name outside the options when the source is open', () => {
        const KEYS = [{ label: 'menu.play', value: 'menu.play' }];
        expect(coerceFieldValue('enum', 'i18nKey', 'menu.quit', { options: KEYS, open: true })).toBe('menu.quit');
        expect(() => coerceFieldValue('enum', 'i18nKey', 'menu.quit', { options: KEYS })).toThrow(/menu\.play/);
    });

    // The declared range is a property of the FIELD, so it has to bind whoever
    // writes it. The control clamps a drag and a keystroke to it; this door
    // refuses, because a caller that asked for 5 wants to hear that it can't have
    // it rather than discover 1 stored later.
    it('holds a numeric field to its declared range', () => {
        expect(coerceFieldValue('number', 'opacity', 0.5, { min: 0, max: 1 })).toBe(0.5);
        expect(() => coerceFieldValue('number', 'opacity', 5, { min: 0, max: 1 })).toThrow(/at most 1/);
        expect(() => coerceFieldValue('number', 'opacity', -1, { min: 0, max: 1 })).toThrow(/at least 0/);
        // An unranged field is unchanged — most fields declare no bounds at all.
        expect(coerceFieldValue('number', 'x', 1e6)).toBe(1e6);
    });

    // A flag IS a bit, and the options ARE the bits that exist. The control can
    // only toggle those; this door took any number, so a mask with bits nothing
    // declares went into the component and no layer ever matched it.
    it('holds a bitmask to the bits its options declare', () => {
        const BITS = [{ label: 'Default', value: 1 }, { label: 'Player', value: 2 }];
        expect(coerceFieldValue('flags', 'categoryBits', 3, { options: BITS })).toBe(3);
        expect(() => coerceFieldValue('flags', 'categoryBits', 8, { options: BITS })).toThrow(/declared bits/);
        expect(() => coerceFieldValue('flags', 'categoryBits', 1.5, { options: BITS })).toThrow(/whole number/);
        // With no options to go on, any mask passes — the same "nothing knowable
        // here" fallback the enum branch takes.
        expect(coerceFieldValue('flags', 'categoryBits', 0xffff)).toBe(0xffff);
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
        expect(patchFieldMember('vec3', [] as unknown as InspectorFieldValue, 'z', 7)).toEqual([0, 0, 7]);
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

// The one rule every writer of an enum asks: the inspector control (where the
// input is typed text) and the automation door (where it is whatever a client
// sent). They used to answer it separately and disagree — on whether a name
// outside an open source was legal, and then on whether 7.5 was a sorting layer.
describe('coerceEnumInput (what an enum field may be handed)', () => {
    const LAYERS = [{ label: 'back', value: 0 }, { label: 'ground', value: 1 }];
    const ANIMS = [{ label: 'stand', value: 'stand' }, { label: 'walk', value: 'walk' }];

    it('takes an option by value, and by the label a person actually types', () => {
        expect(coerceEnumInput(1, LAYERS, true)).toBe(1);
        expect(coerceEnumInput('ground', LAYERS, true)).toBe(1);
        expect(coerceEnumInput('  GROUND ', LAYERS, true)).toBe(1);
        expect(coerceEnumInput('walk', ANIMS, false)).toBe('walk');
    });

    it('takes an ordinal spelled as text, which is how a text transport sends it', () => {
        expect(coerceEnumInput('1', LAYERS, false)).toBe(1);
        expect(coerceEnumInput('0', LAYERS, false)).toBe(0);
    });

    it('takes a whole number past the named layers when the source is open', () => {
        expect(coerceEnumInput('7', LAYERS, true)).toBe(7);
        expect(coerceEnumInput(7, LAYERS, true)).toBe(7);
        expect(coerceEnumInput('-3', LAYERS, true)).toBe(-3);
    });

    it('refuses a number that is not a layer index — the same answer on both doors', () => {
        expect(coerceEnumInput('7.5', LAYERS, true)).toBeNull();
        expect(coerceEnumInput('nope', LAYERS, true)).toBeNull();
    });

    it('takes a new name for an open name source, and refuses one for a closed one', () => {
        expect(coerceEnumInput('menu.quit', ANIMS, true)).toBe('menu.quit');
        expect(coerceEnumInput('sprint', ANIMS, false)).toBeNull();
        expect(coerceEnumInput(99, LAYERS, false)).toBeNull();
    });

    it('refuses an empty input — that is a cleared box, not a value', () => {
        expect(coerceEnumInput('   ', LAYERS, true)).toBeNull();
        expect(coerceEnumInput('', ANIMS, true)).toBeNull();
    });
});
