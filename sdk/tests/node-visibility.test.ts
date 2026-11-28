// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { Camera, MeshRenderer, Sprite, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { BoxCollider2D } from '../src/physics/components';
import { NodeVisibility, NodeVisibilityState } from '../src/imported-scene/nodeVisibility';
import { registerWorldSceneExportFilter, serializeEntityComponents } from '../src/scene/scene';
import { setNestedProperty } from '../src/timeline/TimelineRuntime';
import { createMockModule } from './mocks/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

function fixture() {
    ensureBuiltinComponentsRegistered();
    const module = createMockModule(), world = new World();
    world.connectCpp(module.getRegistry(), module);
    const root = world.spawn('root'), child = world.spawn('child'), leaf = world.spawn('leaf');
    world.setParent(child, root); world.setParent(leaf, child);
    world.insert(root, NodeVisibility, { visible: false });
    world.insert(child, NodeVisibility, { visible: false });
    world.insert(child, Camera, { isActive: true });
    world.insert(child, BoxCollider2D, { enabled: true });
    world.insert(leaf, Sprite, { enabled: true });
    const state = new NodeVisibilityState(world);
    registerWorldSceneExportFilter(world, (entity, component, data) => state.exportData(entity, component, data));
    return { world, root, child, leaf, state };
}

describe('hierarchical visual visibility', () => {
    it.skipIf(!HAS_WASM)('keeps a large mixed render subtree hidden across steady frames', async () => {
        const app = App.new(), module = await loadWasmModule(), registry = new module.Registry();
        app.connectCpp(registry, module, { ownedRegistry: true });
        const world = app.world;
        const state = new NodeVisibilityState(world);
        try {
            const root = world.spawn();
            world.insert(root, NodeVisibility, { visible: false });
            const renderers = Array.from({ length: 2048 }, (_, i) => {
                const entity = world.spawn();
                const def = i % 2 ? MeshRenderer : Sprite;
                world.insert(entity, def, { enabled: true });
                world.setParent(entity, root);
                return { entity, def };
            });
            state.update();
            for (let i = 0; i < 16; i++) state.update();
            if (process.env.ESTELLA_BENCH_NODE_VISIBILITY === '1') {
                const elapsed = Array.from({ length: 21 }, () => {
                    const start = performance.now();
                    state.update();
                    return performance.now() - start;
                }).sort((a, b) => a - b);
                console.log(`${renderers.length} hidden renderers, steady frame median ${elapsed[10].toFixed(3)} ms`);
            }
            expect(renderers.every(({ entity, def }) => !world.get(entity, def).enabled)).toBe(true);
            const changed = renderers[41];
            const read = vi.spyOn(world, 'get');
            try {
                state.update();
                const rendererReads = () => read.mock.calls.filter(([, def]) => def === MeshRenderer || def === Sprite);
                expect(rendererReads()).toHaveLength(0);
                world.update(changed.entity, changed.def, data => { data.enabled = true; });
                read.mockClear();
                state.update();
                expect(rendererReads().map(([entity]) => entity)).toEqual([changed.entity]);
            } finally { read.mockRestore(); }
            expect(world.get(changed.entity, changed.def).enabled).toBe(false);
            world.set(root, NodeVisibility, { visible: true });
            state.update();
            expect(renderers.every(({ entity, def }) => world.get(entity, def).enabled)).toBe(true);
        } finally { state.dispose(); app.quit({ keepRenderer: true }); }
    });

    it('composes nested gates without disabling physics or the camera', () => {
        const { world, root, child, leaf, state } = fixture();
        state.update();
        expect(world.get(leaf, Sprite).enabled).toBe(false);
        expect(world.get(child, Camera).isActive).toBe(true);
        expect(world.get(child, BoxCollider2D).enabled).toBe(true);
        world.set(root, NodeVisibility, { visible: true }); state.update();
        expect(world.get(leaf, Sprite).enabled).toBe(false);
        world.set(child, NodeVisibility, { visible: true }); state.update();
        expect(world.get(leaf, Sprite).enabled).toBe(true);
    });

    it('saves authored flags, preserves disabled renderers and makes no stable-frame writes', () => {
        const { world, root, child, leaf, state } = fixture();
        world.insert(child, Sprite, { enabled: false });
        state.update();
        expect(serializeEntityComponents(world, leaf).find(c => c.type === 'Sprite')!.data.enabled).toBe(true);
        const write = vi.spyOn(world, 'set'); state.update();
        expect(write).not.toHaveBeenCalled();
        world.set(root, NodeVisibility, { visible: true }); world.set(child, NodeVisibility, { visible: true }); state.update();
        expect(world.get(child, Sprite).enabled).toBe(false);
    });

    it('restores a reparented renderer and a renderer whose gate was removed', () => {
        const { world, root, child, leaf, state } = fixture();
        state.update(); world.removeParent(leaf); state.update();
        expect(world.get(leaf, Sprite).enabled).toBe(true);
        world.setParent(leaf, root); state.update();
        expect(world.get(leaf, Sprite).enabled).toBe(false);
        world.remove(root, NodeVisibility); state.update();
        expect(world.get(leaf, Sprite).enabled).toBe(true);
        world.despawn(child); state.update();
    });

    it('saves and restores the replacement renderer flag rather than the removed instance', () => {
        const { world, root, child, leaf, state } = fixture();
        state.update();
        world.remove(leaf, Sprite);
        world.insert(leaf, Sprite, { enabled: false });
        expect(serializeEntityComponents(world, leaf).find(c => c.type === 'Sprite')!.data.enabled).toBe(false);
        state.update();
        world.set(root, NodeVisibility, { visible: true });
        world.set(child, NodeVisibility, { visible: true });
        state.update();
        expect(world.get(leaf, Sprite).enabled).toBe(false);
    });

    it('keeps an unresolved imported mesh reference while hiding and showing it', () => {
        const { world, root, child, leaf, state } = fixture();
        world.insertWithUnresolvedAssets(leaf, MeshRenderer, { enabled: true }, new Map([['mesh', 'assets/body.esmesh']]));
        const saved = () => serializeEntityComponents(world, leaf).find(c => c.type === 'MeshRenderer')!.data;
        expect(saved()).toMatchObject({ enabled: true, mesh: 'assets/body.esmesh' });
        state.update();
        expect(world.get(leaf, MeshRenderer).enabled).toBe(false);
        expect(saved()).toMatchObject({ enabled: true, mesh: 'assets/body.esmesh' });
        world.set(root, NodeVisibility, { visible: true });
        world.set(child, NodeVisibility, { visible: true });
        state.update();
        expect(world.get(leaf, MeshRenderer).enabled).toBe(true);
        expect(saved()).toMatchObject({ enabled: true, mesh: 'assets/body.esmesh' });
    });

    it('keeps boolean fields boolean when a timeline supplies numeric samples', () => {
        const data = { visible: true, layer: 3 };
        setNestedProperty(data, 'visible', 0); expect(data.visible).toBe(false);
        setNestedProperty(data, 'visible', 1); expect(data.visible).toBe(true);
        setNestedProperty(data, 'layer', 0); expect(data.layer).toBe(0);
    });
});
