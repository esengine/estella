// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    resource-shape.test.ts
 * @brief   The declared layout against the resource it claims to describe.
 *
 * @details `resourceShapes.ts` is a leaf with no imports, so it cannot check
 *          itself: it says `Input` has a `mouseX` and an `isKeyDown`, and only
 *          something that can see the real object knows whether it does. A
 *          field that is not there mirrors as 0 and a method that is not there
 *          mirrors as all-zero bits — both answer, and both answer wrongly.
 */
import { describe, it, expect } from 'vitest';
import {
    RESOURCE_NAMES, RESOURCE_SHAPES, KEY_CODES, resourceBlockBytes, resourceLayout,
    resourceMethodBit,
} from '../src/ecs/resourceShapes';
import { builtinResource, Time } from '../src/ecs/resource';
import { engineAbiParts } from '../src/ecs/aot/abiDigest';
import '../src/input/input';
import '../src/ui/core/ui-camera-info';

describe('a declared resource layout', () => {
    it('names a resource the runtime actually registered', () => {
        // Registration happens in `defineResource`, so a name here with no
        // module importing it would leave a compiled system reading nothing.
        for (const name of RESOURCE_NAMES) {
            expect([name, builtinResource(name) !== undefined]).toEqual([name, true]);
        }
    });

    for (const name of RESOURCE_NAMES) {
        it(`${name}: every declared scalar is a field of that type on the resource`, () => {
            const value = builtinResource(name)!._default as Record<string, unknown>;
            for (const [field, declared] of Object.entries(RESOURCE_SHAPES[name]!.fields)) {
                expect([field, typeof value[field]]).toEqual([field, typeof declared]);
            }
        });

        it(`${name}: every declared method is a method on the resource`, () => {
            const value = builtinResource(name)!._default as Record<string, unknown>;
            for (const method of Object.keys(RESOURCE_SHAPES[name]!.methods ?? {})) {
                expect([method, typeof value[method]]).toEqual([method, 'function']);
            }
        });
    }

    it('Time is built FROM the declaration, so the two cannot drift', () => {
        expect(Time._default).toEqual(RESOURCE_SHAPES['Time']!.fields);
    });

    it('lays bit sets out after the scalars, and sizes the block for both', () => {
        const layout = resourceLayout('Input')!;
        const scalars = layout.filter((m) => m.kind === 'scalar').length;
        expect(layout.slice(0, scalars).every((m) => m.kind === 'scalar')).toBe(true);
        // Room for the last member, not just the last scalar: a block sized to
        // the scalars would have the first mirrored bit land outside it.
        const last = layout[layout.length - 1]!;
        expect(resourceBlockBytes('Input')).toBeGreaterThanOrEqual(
            last.offset + (last.kind === 'bits' ? Math.ceil(last.bits / 8) : 8));
    });

    it('gives every declared key its own bit, and refuses one it does not declare', () => {
        const seen = new Set<string>();
        for (const key of KEY_CODES) {
            const at = resourceMethodBit('Input', 'isKeyDown', key)!;
            expect([key, at !== null]).toEqual([key, true]);
            const slot = `${at.offset}:${at.bit}`;
            expect([key, seen.has(slot)]).toEqual([key, false]);
            seen.add(slot);
        }
        expect(resourceMethodBit('Input', 'isKeyDown', 'KeyNotOnAnyKeyboard')).toBeNull();
        expect(resourceMethodBit('Input', 'isPointerOverUI', 0)).toBeNull();
    });
});

describe('what the engine handshake is taken of', () => {
    const parts = engineAbiParts(4).join('\n');

    it('covers a member offset, so moving one invalidates a built module', () => {
        const valid = resourceLayout('UICameraInfo')!.find((m) => m.name === 'valid')!;
        expect(parts).toContain(`valid@${valid.offset}`);
    });

    it('covers the KEY ORDER, because that is what picks the bit', () => {
        // Swapping two keys moves no member and changes no count; without the
        // table itself in here, a module built before the swap would keep
        // loading and read the wrong key's bit.
        expect(parts).toContain(KEY_CODES.join('/'));
    });

    it('covers which method reads which set', () => {
        expect(parts).toContain('isKeyPressed->keyPressed');
    });
});
