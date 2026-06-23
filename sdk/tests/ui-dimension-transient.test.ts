// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/world';
import { createMockModule } from './mocks/wasm';
import { defineComponent } from '../src/component';
import { serializeScene } from '../src/scene';
import { DimensionUnit, px, percent, auto, isAuto } from '../src/ui/core/dimension';

describe('Dimension foundation (REARCH_GUI F2)', () => {
    it('px/percent/auto build unit-tagged lengths', () => {
        expect(px(10)).toEqual({ value: 10, unit: DimensionUnit.Px });
        expect(percent(50)).toEqual({ value: 50, unit: DimensionUnit.Percent });
        expect(auto()).toEqual({ value: 0, unit: DimensionUnit.Auto });
    });

    it('isAuto distinguishes the content-driven length', () => {
        expect(isAuto(auto())).toBe(true);
        expect(isAuto(px(5))).toBe(false);
        expect(isAuto(percent(100))).toBe(false);
    });
});

describe('transient components (REARCH_GUI F2)', () => {
    let world: World;

    // Components are registered into the active context; create the world first so
    // they land in the context serializeScene/getComponentTypes later read from.
    beforeEach(() => {
        const mod = createMockModule();
        world = new World();
        world.connectCpp(mod.getRegistry(), mod);
    });

    it('records transience on the def (false by default)', () => {
        const Persisted = defineComponent('TestPersisted', { hp: 100 });
        const Frame = defineComponent('TestFrame', { hover: false }, { transient: true });
        expect(Frame.transient).toBe(true);
        expect(Persisted.transient).toBe(false);
    });

    it('serializeScene omits transient components but keeps persisted ones', () => {
        const Persisted = defineComponent('TestPersisted', { hp: 100 });
        const Frame = defineComponent('TestFrame', { hover: false }, { transient: true });
        const e = world.spawn('E');
        world.insert(e, Persisted, { hp: 50 });
        world.insert(e, Frame, { hover: true });

        const scene = serializeScene(world);
        const rec = scene.entities.find(x => x.name === 'E')!;
        const types = rec.components.map(c => c.type);

        expect(types).toContain('TestPersisted');
        expect(types).not.toContain('TestFrame');
    });
});
