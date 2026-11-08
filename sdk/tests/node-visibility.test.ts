// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Camera, Sprite, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { BoxCollider2D } from '../src/physics/components';
import { NodeVisibility, NodeVisibilityState } from '../src/imported-scene/nodeVisibility';
import { registerWorldSceneExportFilter, serializeEntityComponents } from '../src/scene/scene';
import { setNestedProperty } from '../src/timeline/TimelineRuntime';
import { createMockModule } from './mocks/wasm';

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
    const state = new NodeVisibilityState();
    registerWorldSceneExportFilter(world, (entity, component, data) => state.exportData(entity, component, data));
    return { world, root, child, leaf, state };
}

describe('hierarchical visual visibility', () => {
    it('composes nested gates without disabling physics or the camera', () => {
        const { world, root, child, leaf, state } = fixture();
        state.update(world);
        expect(world.get(leaf, Sprite).enabled).toBe(false);
        expect(world.get(child, Camera).isActive).toBe(true);
        expect(world.get(child, BoxCollider2D).enabled).toBe(true);
        world.set(root, NodeVisibility, { visible: true }); state.update(world);
        expect(world.get(leaf, Sprite).enabled).toBe(false);
        world.set(child, NodeVisibility, { visible: true }); state.update(world);
        expect(world.get(leaf, Sprite).enabled).toBe(true);
    });

    it('saves authored flags, preserves disabled renderers and makes no stable-frame writes', () => {
        const { world, root, child, leaf, state } = fixture();
        world.insert(child, Sprite, { enabled: false });
        state.update(world);
        expect(serializeEntityComponents(world, leaf).find(c => c.type === 'Sprite')!.data.enabled).toBe(true);
        const write = vi.spyOn(world, 'set'); state.update(world);
        expect(write).not.toHaveBeenCalled();
        world.set(root, NodeVisibility, { visible: true }); world.set(child, NodeVisibility, { visible: true }); state.update(world);
        expect(world.get(child, Sprite).enabled).toBe(false);
    });

    it('restores a reparented renderer and a renderer whose gate was removed', () => {
        const { world, root, child, leaf, state } = fixture();
        state.update(world); world.removeParent(leaf); state.update(world);
        expect(world.get(leaf, Sprite).enabled).toBe(true);
        world.setParent(leaf, root); state.update(world);
        expect(world.get(leaf, Sprite).enabled).toBe(false);
        world.remove(root, NodeVisibility); state.update(world);
        expect(world.get(leaf, Sprite).enabled).toBe(true);
        world.despawn(child); state.update(world);
    });

    it('keeps boolean fields boolean when a timeline supplies numeric samples', () => {
        const data = { visible: true, layer: 3 };
        setNestedProperty(data, 'visible', 0); expect(data.visible).toBe(false);
        setNestedProperty(data, 'visible', 1); expect(data.visible).toBe(true);
        setNestedProperty(data, 'layer', 0); expect(data.layer).toBe(0);
    });
});
