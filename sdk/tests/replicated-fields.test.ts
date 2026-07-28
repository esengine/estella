// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Replication declaration single-sourcing (RC11 N0): `replicated` is
 *        authored at the C++ ES_PROPERTY site, flows through
 *        COMPONENT_META.replicatedFields, and user components declare the same
 *        thing via defineComponent metadata — one accessor over both.
 */
import { describe, it, expect } from 'vitest';
import {
    defineComponent,
    getReplicatedFields,
    clearUserComponents,
} from '../src/ecs/component';
import { COMPONENT_META } from '../src/ecs/component.generated';

describe('replicated single-source (builtins)', () => {
    it('Transform authors its local pose as replicated at the ES_PROPERTY site', () => {
        expect(COMPONENT_META.Transform.replicatedFields).toEqual(['position', 'rotation', 'scale']);
        expect(getReplicatedFields('Transform')).toEqual(['position', 'rotation', 'scale']);
    });

    it('Velocity replicates both fields', () => {
        expect(getReplicatedFields('Velocity')).toEqual(['linear', 'angular']);
    });

    it('an unannotated builtin replicates nothing', () => {
        expect(COMPONENT_META.Sprite.replicatedFields).toBeUndefined();
        expect(getReplicatedFields('Sprite')).toEqual([]);
    });

    it('computed world-space fields are not replicated', () => {
        expect(getReplicatedFields('Transform')).not.toContain('worldPosition');
    });
});

describe('replicated metadata (user components)', () => {
    it('defineComponent surfaces replicatedFields through the same accessor', () => {
        clearUserComponents();
        defineComponent('NetHealth', { hp: 100, maxHp: 100, lastHitBy: 0 }, {
            replicatedFields: ['hp', 'maxHp'],
        });
        expect(getReplicatedFields('NetHealth')).toEqual(['hp', 'maxHp']);
        clearUserComponents();
    });

    it('a replicated name that matches no field fails loud', () => {
        clearUserComponents();
        expect(() =>
            defineComponent('NetTypo', { hp: 100 }, { replicatedFields: ['hpp'] }),
        ).toThrow(/unknown field "hpp"/);
        clearUserComponents();
    });

    it('an unknown component name replicates nothing', () => {
        expect(getReplicatedFields('NoSuchComponent')).toEqual([]);
    });
});
