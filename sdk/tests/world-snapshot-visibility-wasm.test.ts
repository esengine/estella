import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app/app';
import type { ESEngineModule } from '../src/wasm';
import { entityIndex } from '../src/types';
import { World } from '../src/ecs/world';
import { Sprite, Transform, Disabled, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { worldSnapshot } from '../src/runtime/worldSnapshot';
import { serializeScene } from '../src/scene/scene';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('snapshot visibility with borrowed core values', () => {
    let module: ESEngineModule;
    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
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
