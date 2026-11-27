import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app/app';
import type { ESEngineModule } from '../src/wasm';
import { entityIndex } from '../src/types';
import { World } from '../src/ecs/world';
import { Sprite, MeshRenderer, Transform, Disabled, defineComponent, ensureBuiltinComponentsRegistered, unregisterComponent } from '../src/ecs/component';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { TextInput } from '../src/ui/text/text-input';
import { worldSnapshot } from '../src/runtime/worldSnapshot';
import { hasVisibility, isEntityVisible, setEntityVisible } from '../src/ecs/entityUtils';
import { serializeScene } from '../src/scene/scene';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('snapshot visibility with borrowed core values', () => {
    let module: ESEngineModule;
    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });

    it.each([['Sprite', Sprite, 'texture', 'png'], ['MeshRenderer', MeshRenderer, 'mesh', 'esmesh']] as const)(
        'preserves the current unresolved %s asset in inspection and scene saves', async (type, component, field, extension) => {
            const registry = new module.Registry(), world = new World();
            world.connectCpp(registry, module);
            const app = { world, hasResource: () => false } as unknown as App;
            const completions: Array<() => void> = [];
            world.setAssetFieldResolver(() => new Promise<void>(resolve => { completions.push(resolve); }));
            try {
                const entity = world.spawn('Asset');
                const read = () => world.get(entity, component) as unknown as Record<string, unknown>;
                const inspect = () => worldSnapshot(app, entity, false).selected?.components.find(c => c.type === type)?.data[field];
                const save = () => serializeScene(world).entities[0].components.find(c => c.type === type)?.data[field];
                const before = `assets/old.${extension}`, after = `assets/new.${extension}`;
                world.insert(entity, component, { [field]: before } as never);
                expect(read()[field]).toBe(0);
                expect(inspect()).toBe(before);
                expect(save()).toBe(before);
                world.update(entity, component, data => { data.enabled = false; });
                expect(inspect()).toBe(before);

                world.set(entity, component, { ...read(), [field]: after } as never);
                completions[0]();
                await Promise.resolve();
                expect(inspect()).toBe(after);
                expect(save()).toBe(after);
                completions[1]();
                await Promise.resolve();
                expect(read()[field]).toBe(0);
                world.update(entity, component, data => { data.enabled = true; });
                expect(inspect()).toBe(after);
                expect(save()).toBe(after);

                world.update(entity, component, data => { (data as unknown as Record<string, unknown>)[field] = 0; });
                expect(inspect()).toBe(0);
                expect(save()).toBe(0);
            } finally { world.disconnectCpp(); registry.delete(); }
        },
    );

    it('captures detached script records and pooled values in both snapshot modes', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        const Meter = defineComponent('SnapshotMeter', { count: 2, enabled: true });
        const Path = defineComponent('SnapshotPath', { points: [{ x: 1 }] });
        try {
            const entity = world.spawn('Path');
            world.insert(entity, Meter);
            world.insert(entity, Path);
            const detail = worldSnapshot(app, entity, false).selected!;
            const full = worldSnapshot(app, entity, true).selected!;
            const saved = serializeScene(world).entities[0].components;
            world.update(entity, Meter, meter => { meter.count = 5; });
            world.update(entity, Path, path => { path.points[0].x = 5; });
            expect(detail.components).toEqual(saved);
            expect(full.components).toEqual(saved);

            const captured = detail.components.find(c => c.type === Path._name)!.data as { points: { x: number }[] };
            captured.points[0].x = 7;
            expect(world.get(entity, Path).points[0].x).toBe(5);
            expect(full.components).toEqual(saved);
        } finally {
            world.disconnectCpp(); registry.delete();
            unregisterComponent(Meter._name); unregisterComponent(Path._name);
        }
    });

    it('retains cyclic script relationships in the detached snapshot', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        type Graph = { links: Graph[]; runtimeOnly: boolean };
        const Graph = defineComponent<Graph>('SnapshotGraph', { links: [], runtimeOnly: true }, { transientFields: ['runtimeOnly'] });
        try {
            const entity = world.spawn();
            world.insert(entity, Graph);
            world.update(entity, Graph, graph => { graph.links.push(graph); });
            const detail = worldSnapshot(app, entity, false).selected!.components.find(c => c.type === Graph._name)!;
            const data = detail.data as Omit<Graph, 'runtimeOnly'>;
            expect(data).not.toBe(world.get(entity, Graph));
            expect(data.links[0]).toBe(data);
            expect(data).not.toHaveProperty('runtimeOnly');
            expect(world.get(entity, Graph).runtimeOnly).toBe(true);
        } finally {
            world.disconnectCpp(); registry.delete();
            unregisterComponent(Graph._name);
        }
    });

    it('inspects authored text without carrying live input focus into scene edits', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        try {
            const field = world.spawn('Search');
            world.insert(field, TextInput, { value: 'Estella', focused: true });

            const details = worldSnapshot(app, field, false).selected?.components.find(c => c.type === 'TextInput');
            const full = worldSnapshot(app, field, true).selected?.components.find(c => c.type === 'TextInput');
            const saved = serializeScene(world).entities[0].components.find(c => c.type === 'TextInput');
            expect(details).toEqual(saved);
            expect(full).toEqual(saved);
            expect(details?.data).toMatchObject({ value: 'Estella' });
            expect(details?.data).not.toHaveProperty('focused');
            expect(world.get(field, TextInput).focused).toBe(true);
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it.each(['Sprite', 'MeshRenderer'] as const)('includes a native-added %s in selected component data', (type) => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        try {
            const seed = world.spawn('Seed'), entity = world.spawn('Selection');
            if (type === 'Sprite') {
                world.insert(seed, Sprite, { enabled: false });
                registry.addSprite(entity, registry.getSprite(seed));
            } else {
                world.insert(seed, MeshRenderer, { enabled: false });
                registry.addMeshRenderer(entity, registry.getMeshRenderer(seed));
            }
            expect(world.getComponentTypes(entity)).toContain(type);
            const detail = worldSnapshot(app, entity, false).selected;
            expect(detail).toMatchObject({ id: entity, hidden: true });
            expect(detail?.components).toContainEqual({ type, data: expect.objectContaining({ enabled: false }) });
            const full = worldSnapshot(app, entity, true);
            expect(full.selected).toEqual(detail);
            expect(full.tree?.entities.find(row => row.id === entity)?.components).toContainEqual({ type, data: {} });
            expect(hasVisibility(world, entity)).toBe(true);
            expect(isEntityVisible(world, entity)).toBe(false);
            setEntityVisible(world, entity, true);
            expect(worldSnapshot(app, entity, false).selected?.hidden).toBe(false);
            expect(isEntityVisible(world, entity)).toBe(true);
            if (type === 'Sprite') registry.removeSprite(entity);
            else registry.removeMeshRenderer(entity);
            expect(worldSnapshot(app, entity, false).selected?.components).toEqual([]);
            expect(detail?.components).toContainEqual({ type, data: expect.objectContaining({ enabled: false }) });
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it('reports a surviving child as a root after native destruction of its parent', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        try {
            const parent = world.spawn('Parent');
            const child = world.spawn('Child');
            world.setParent(child, parent);
            registry.destroy(parent);
            expect(registry.hasParent(child)).toBe(false);
            expect(worldSnapshot(app, child, false).selected).toMatchObject({ parent: null, name: 'Child' });
            const snapshot = worldSnapshot(app, parent, true);
            expect(snapshot.selected).toBeNull();
            expect(snapshot.tree!.entities.map(e => e.id)).toEqual([child]);
            expect(worldSnapshot(app, parent, false).selected).toBeNull();
            expect(serializeScene(world).entities).toMatchObject([{ id: child, parent: null }]);
            const replacement = world.spawn('Replacement');
            expect(entityIndex(replacement)).toBe(entityIndex(parent));
            expect(serializeScene(world).entities.map(e => e.id)).toEqual([child, replacement]);
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it('keeps snapshots self-contained when an SDK entity is parented to a native-only handle', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        try {
            const child = world.spawn('Child');
            const native = registry.create();
            registry.setParent(child, native);
            expect(registry.getParent(child).entity).toBe(native);
            expect(worldSnapshot(app, child, false).selected!.parent).toBeNull();
            expect(worldSnapshot(app, child, true).tree!.entities).toMatchObject([{ id: child, parent: null }]);
            expect(serializeScene(world).entities).toMatchObject([{ id: child, parent: null }]);
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it.each([[true, true], [false, true], [true, false]])('reflects native parent edits with bulk inspection %s and reader %s', (bulk, reader) => {
        const registry = new module.Registry(), world = new World();
        if (!bulk) registry.getBuiltinComponentNames = undefined;
        world.connectCpp(registry, module);
        if (!reader) {
            const read = world.resolveGetter.bind(world);
            world.resolveGetter = (component, mode) => component._name === 'Parent' ? null : read(component, mode);
        }
        const app = { world, hasResource: () => false } as unknown as App;
        try {
            const warm = world.spawn('Warm group'), group = world.spawn('Native group'), child = world.spawn('Child');
            world.setParent(child, warm); world.removeParent(child);
            world.insert(child, Disabled);
            registry.setParent(child, group);
            const before = worldSnapshot(app, child, true);
            expect(before.selected!.parent).toBe(group);
            expect(before.tree!.entities.find(e => e.id === child)!.parent).toBe(group);
            expect(before.tree!.entities.find(e => e.id === group)!.children).toEqual([child]);
            const saved = serializeScene(world);
            expect(saved.entities.find(e => e.id === child)).toMatchObject({ name: 'Child', parent: group });
            expect(saved.entities.find(e => e.id === group)!.children).toEqual([child]);
            expect(worldSnapshot(app, child, false).selected!.parent).toBe(group);
            expect(worldSnapshot(app, group, false).selected!.children).toEqual([child]);
            world.setParent(child, warm);
            registry.removeParent(child);
            const after = worldSnapshot(app, child, true);
            expect(after.selected!.parent).toBeNull();
            expect(after.tree!.entities.find(e => e.id === child)!.parent).toBeNull();
            expect(after.tree!.entities.find(e => e.id === warm)!.children).toEqual([]);
            const updated = serializeScene(world);
            expect(updated.entities.find(e => e.id === child)!.parent).toBeNull();
            expect(updated.entities.find(e => e.id === warm)!.children).toEqual([]);
            expect(worldSnapshot(app, child, false).selected!.parent).toBeNull();
            expect(before.selected!.parent).toBe(group);
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it('keeps selected hierarchy in tree order after reparenting, reordering and disabled children', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        try {
            const group = world.spawn('Group'), other = world.spawn('Other');
            const first = world.spawn('First'), second = world.spawn('Second'), third = world.spawn('Third');
            world.setParent(second, group); world.setParent(first, group); world.setParent(third, group);
            world.insert(second, Disabled);
            const verify = (entity: typeof group) => {
                const full = worldSnapshot(app, entity, true);
                expect(worldSnapshot(app, entity, false).selected).toEqual(full.selected);
                const row = full.tree!.entities.find(e => e.id === entity)!;
                expect(full.selected!.parent).toEqual(row.parent);
                expect(full.selected!.children).toEqual(row.children);
            };
            verify(group);
            expect(worldSnapshot(app, group, false).selected!.children).toEqual([first, second, third]);
            // A small group in a large scene should not enumerate unrelated entities.
            for (let i = 0; i < 64; i++) world.spawn();
            const enumerate = world.getAllEntities;
            world.getAllEntities = () => { throw new Error('small group detail enumerated the world'); };
            try {
                expect(worldSnapshot(app, group, false).selected!.children).toEqual([first, second, third]);
            } finally { world.getAllEntities = enumerate; }
            world.applyEntityOrder([third, second, first, group, other]);
            verify(group);
            expect(worldSnapshot(app, group, false).selected!.children).toEqual([third, second, first]);
            registry.setParent(second, other); verify(group); verify(other); verify(second);
            world.setParent(first, other); verify(group); verify(other); verify(first);
            world.removeParent(first); world.despawn(third); verify(group); verify(first);
            expect(worldSnapshot(app, group, false).selected!.children).toEqual([]);
            const all = world.getAllEntities;
            world.getAllEntities = () => { throw new Error('leaf detail enumerated the world'); };
            expect(worldSnapshot(app, first, false).selected).toMatchObject({ parent: null, children: [] });
            world.getAllEntities = all;
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it('does not substitute a recycled native entity for a destroyed selection', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        try {
            const old = world.spawn('Old selection');
            world.insert(old, Sprite, { enabled: false });
            expect(worldSnapshot(app, old, false).selected?.name).toBe('Old selection');
            world.despawn(old);
            const replacement = world.spawn('Replacement');
            world.insert(replacement, Sprite, { enabled: true });
            expect(replacement).not.toBe(old);
            expect(entityIndex(replacement)).toBe(entityIndex(old));
            expect(worldSnapshot(app, old, false).selected).toBeNull();
            const snapshot = worldSnapshot(app, old, true);
            expect(snapshot.selected).toBeNull();
            expect(snapshot.tree!.entities.map(e => e.id)).toEqual([replacement]);
            expect(worldSnapshot(app, replacement, false).selected).toMatchObject({ name: 'Replacement', hidden: false });
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it('keeps opposite flags and selected values independent across snapshots', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        const a = world.spawn('Shown'), b = world.spawn('Hidden'), ui = world.spawn('UI');
        try {
            world.insert(a, Transform); world.insert(b, Transform);
            world.insert(a, Sprite, { enabled: true }); world.insert(b, Sprite, { enabled: false });
            world.insert(ui, Sprite, { enabled: false }); world.insert(ui, UINode, { display: UIDisplay.Flex });
            const before = worldSnapshot(app, b, true);
            expect(before.tree!.entities.find(e => e.id === a)).toMatchObject({ hidden: false });
            expect(before.tree!.entities.find(e => e.id === b)).toMatchObject({ hidden: true });
            expect(before.tree!.entities.find(e => e.id === ui)).toMatchObject({ hidden: false });
            const selected = before.selected!.components.find(c => c.type === 'Sprite')!.data;
            expect(selected.enabled).toBe(false);
            world.update(a, Sprite, data => { data.enabled = false; });
            world.update(b, Sprite, data => { data.enabled = true; });
            world.update(ui, UINode, data => { data.display = UIDisplay.None; });
            const after = worldSnapshot(app, b, true);
            expect(after.tree!.entities.find(e => e.id === a)).toMatchObject({ hidden: true });
            expect(after.selected).toMatchObject({ hidden: false });
            expect(after.tree!.entities.find(e => e.id === ui)).toMatchObject({ hidden: true });
            expect(selected.enabled).toBe(false);
            expect(before.selected!.hidden).toBe(true);
        } finally { world.disconnectCpp(); registry.delete(); }
    });
});
