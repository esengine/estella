import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { AppContext, getDefaultContext, setDefaultContext } from '../src/ecs/context';
import { defineComponent, getUserComponents, renderableComponents, unregisterComponent } from '../src/ecs/component';

function isolated(run: (context: AppContext, world: World) => void) {
    const previous = getDefaultContext(), context = new AppContext();
    setDefaultContext(context);
    try { run(context, new World()); }
    finally { setDefaultContext(previous); }
}

describe('group component inspection', () => {
    it('shares one current script-name index between scalar and group inspection', () => isolated((_context, world) => {
        for (let i = 0; i < 200; i++) defineComponent('Unused' + i, { value: 0 });
        const a = defineComponent('GroupFirst', { value: 1 }), b = defineComponent('GroupSecond', { value: 2 });
        const entities = Array.from({ length: 100 }, () => world.spawn());
        for (const entity of entities) { world.insert(entity, b); world.insert(entity, a); }
        const input = [entities[1], entities[0], ...entities];
        const iterator = vi.spyOn(getUserComponents(), Symbol.iterator);
        const expected = input.map(() => ['GroupSecond', 'GroupFirst']);
        expect(world.getComponentTypes(entities[0])).toEqual(expected[0]);
        expect(world.getComponentTypesBatch(input)).toEqual(expected);
        expect(input.map(entity => world.getComponentTypes(entity))).toEqual(expected);
        expect(iterator).toHaveBeenCalledTimes(1);
        iterator.mockRestore();
        world.remove(entities[0], b);
        expect(world.getComponentTypesBatch(input)).toEqual(input.map(entity => world.getComponentTypes(entity)));
        world.despawn(entities[1]);
        expect(world.getComponentTypesBatch(input)).toEqual(input.map(entity => world.getComponentTypes(entity)));
        expect(world.getComponentTypesBatch([])).toEqual([]);
    }));

    it('refreshes the name and renderer indexes after a same-size registry replacement', () => isolated((context, world) => {
        const old = defineComponent('PreviousRenderer', { visible: true }, { renderableField: 'visible' });
        const next = defineComponent('CurrentRenderer', { visible: true }, { renderableField: 'visible' });
        context.componentRegistry.clear();
        context.componentRegistry.set('Renderer', old);
        const entity = world.spawn();
        world.insert(entity, old);
        expect(world.getComponentTypes(entity)).toEqual(['Renderer']);
        expect(renderableComponents()).toContain(old);
        context.componentRegistry.set('Renderer', next);
        expect(world.getComponentTypes(entity)).toEqual([]);
        expect(renderableComponents()).toContain(next);
        expect(renderableComponents()).not.toContain(old);
        world.insert(entity, next);
        expect(world.getComponentTypesBatch([entity])).toEqual([['Renderer']]);
        context.reset();
        context.componentRegistry.set('RestoredRenderer', old);
        expect(world.getComponentTypes(entity)).toEqual(['RestoredRenderer']);
    }));

    it('follows aliases, same-size catalogue edits and replacement registrations', () => isolated((context, world) => {
        const component = defineComponent('Original', { value: 1 }), entity = world.spawn();
        world.insert(entity, component);
        context.componentRegistry.set('Alias', component);
        expect(world.getComponentTypesBatch([entity])).toEqual([['Original']]);
        unregisterComponent('Original');
        expect(world.getComponentTypesBatch([entity])).toEqual([world.getComponentTypes(entity)]);
        expect(world.getComponentTypesBatch([entity])).toEqual([['Alias']]);
        context.componentRegistry.delete('Alias');
        context.componentRegistry.set('Renamed', component);
        expect(world.getComponentTypesBatch([entity])).toEqual([['Renamed']]);
        context.componentRegistry.clear();
        const replacement = defineComponent('Renamed', { value: 2 });
        expect(world.getComponentTypesBatch([entity])).toEqual([[]]);
        world.insert(entity, replacement);
        expect(world.getComponentTypesBatch([entity])).toEqual([world.getComponentTypes(entity)]);
        expect(world.getComponentTypesBatch([entity])).toEqual([['Renamed']]);
    }));

    it('uses the current context on every group read', () => isolated((_context, world) => {
        const component = defineComponent('ContextComponent', { value: 0 }), entity = world.spawn();
        world.insert(entity, component);
        expect(world.getComponentTypesBatch([entity])).toEqual([['ContextComponent']]);
        const previous = getDefaultContext();
        setDefaultContext(new AppContext());
        try {
            expect(world.getComponentTypesBatch([entity])).toEqual([[]]);
            defineComponent('DifferentContextComponent', { value: 0 });
            expect(world.getComponentTypesBatch([entity])).toEqual([[]]);
            defineComponent('ContextComponent', { value: 0 });
            expect(world.getComponentTypesBatch([entity])).toEqual([world.getComponentTypes(entity)]);
            expect(world.getComponentTypesBatch([entity])).toEqual([['ContextComponent']]);
        } finally { setDefaultContext(previous); }
        expect(world.getComponentTypesBatch([entity])).toEqual([['ContextComponent']]);
    }));
});
