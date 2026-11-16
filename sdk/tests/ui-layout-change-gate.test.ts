// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it } from 'vitest';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { defineComponent } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { changeGate } from '../src/ui/layout/layout';

const Box = defineComponent('GateBox', { width: 0 });
const Flow = defineComponent('GateFlow', { gap: 0 });

describe('the layout solves once for each change, whichever pass meets it', () => {
    beforeEach(() => setDefaultContext(new AppContext()));

    it('asks for the first solve, then for none until something is written', () => {
        const world = new World();
        const entity = world.spawn();
        world.insert(entity, Box, { width: 10 });
        const changed = changeGate(world, [Box, Flow]);
        expect(changed()).toBe(true);
        expect(changed()).toBe(false);
        world.advanceTick();
        expect(changed()).toBe(false);
    });

    it('sees a write made in the same tick after the last solve, once', () => {
        const world = new World();
        const entity = world.spawn();
        world.insert(entity, Box, { width: 10 });
        const changed = changeGate(world, [Box, Flow]);
        changed();
        world.update(entity, Box, (box) => { box.width = 20; });
        expect(changed()).toBe(true);
        expect(changed()).toBe(false);
    });

    it('counts a component arriving or leaving as a change', () => {
        const world = new World();
        const entity = world.spawn();
        world.insert(entity, Box, { width: 10 });
        const changed = changeGate(world, [Box, Flow]);
        changed();
        world.insert(entity, Flow, { gap: 4 });
        expect(changed()).toBe(true);
        world.remove(entity, Flow);
        expect(changed()).toBe(true);
        world.despawn(entity);
        expect(changed()).toBe(true);
        expect(changed()).toBe(false);
    });

    it('ignores components it was not given', () => {
        const Other = defineComponent('GateOther', { value: 0 });
        const world = new World();
        const entity = world.spawn();
        world.insert(entity, Other, { value: 1 });
        const changed = changeGate(world, [Box, Flow]);
        changed();
        world.update(entity, Other, (o) => { o.value = 2; });
        expect(changed()).toBe(false);
    });
});
