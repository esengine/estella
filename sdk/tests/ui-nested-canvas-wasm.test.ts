// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Canvas, Camera, SceneOwner, Transform } from '../src/ecs/component';
import { collectCameras } from '../src/camera/CameraPlugin';
import { UINode, UIPositionType } from '../src/ui/core/ui-node';
import { UIVisual } from '../src/ui/core/ui-visual';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { px } from '../src/ui/core/dimension';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('nested canvas layout and ordering on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let world: World;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); });
    afterEach(() => {
        for (const entity of world.getAllEntities()) if (world.valid(entity)) world.despawn(entity);
        world.disconnectCpp(); registry.delete();
    });
    it('fits cameras to the outer canvas when the nested canvas was enumerated first', () => {
        const child = world.spawn(), root = world.spawn(), camera = world.spawn();
        // Different aspects under FixedWidth tell the canvases apart: the outer one
        // (4:3 on a 4:3 screen) leaves orthoSize 300 as it is, the nested one (8:3) doubles it.
        world.insert(child, Canvas, { designResolution: { x: 160, y: 60 }, scaleMode: 0 });
        world.insert(root, Canvas, { designResolution: { x: 800, y: 600 }, scaleMode: 0 });
        world.setParent(child, root);
        world.insert(camera, Transform); world.insert(camera, Camera, { isActive: true, orthoSize: 300 });
        expect(collectCameras(engine, registry, 800, 600, world)[0].halfH).toBeCloseTo(300);
    });
    it('uses the running scene canvas for scene-filtered camera collection', () => {
        const paused = world.spawn(), running = world.spawn(), camera = world.spawn();
        world.insert(paused, Canvas, { designResolution: { x: 160, y: 60 }, scaleMode: 0 });
        world.insert(paused, SceneOwner, { scene: 'paused' });
        world.insert(running, Canvas, { designResolution: { x: 800, y: 600 }, scaleMode: 0 });
        world.insert(running, SceneOwner, { scene: 'running' });
        world.insert(camera, Transform); world.insert(camera, Camera, { isActive: true, orthoSize: 300 });
        expect(collectCameras(engine, registry, 800, 600, world, new Set(['running']))[0].halfH).toBeCloseTo(300);
    });
    it.each([false, true])('lays out nested canvases once, even when the child was created first: %s', childFirst => {
        const child = childFirst ? world.spawn() : null;
        const root = world.spawn(), container = world.spawn(), nested = child ?? world.spawn();
        const leaf = world.spawn(), sibling = world.spawn();
        for (const [entity, width, height] of [[root, 800, 600], [container, 400, 300], [nested, 160, 120], [leaf, 40, 20], [sibling, 30, 20]] as const) {
            world.insert(entity, Transform); world.insert(entity, UIVisual); world.insert(entity, Interactable);
            world.insert(entity, UINode, { position: UIPositionType.Absolute, width: px(width), height: px(height), insetLeft: px(0), insetTop: px(0) });
        }
        world.update(nested, UINode, node => { node.insetLeft = px(20); });
        if (childFirst) world.insert(nested, Canvas, { layer: 3 });
        world.insert(root, Canvas, { layer: 1 });
        if (!childFirst) world.insert(nested, Canvas, { layer: 3 });
        world.setParent(container, root); world.setParent(nested, container); world.setParent(leaf, nested); world.setParent(sibling, root);
        engine.uiLayout_update(registry, -400, -300, 400, 300, true);
        world.ensureTransformsComposed();
        expect(world.get(nested, Transform).position.x).toBeCloseTo(-100);
        engine.uiRenderOrder_update(registry);
        expect([root, container, nested, leaf, sibling].map(entity => engine.ui_getRenderOrder!(registry, entity))).toEqual([0,1,2,3,4]);
        expect([root, container, sibling].map(entity => engine.ui_getCullBit!(registry, entity))).toEqual([2,2,2]);
        expect([nested, leaf].map(entity => engine.ui_getCullBit!(registry, entity))).toEqual([8,8]);
        const point = world.get(leaf, Transform).worldPosition;
        expect(world.getEntitiesWithComponents([UIInteraction])).toEqual([]);
        engine.uiHitTest_updateDomains!(registry, point.x, point.y, 100, 0, 0, -1,
            point.x, point.y, 100, 0, 0, -1);
        expect(engine.uiHitTest_getHitEntity()).toBe(leaf);
        expect([root, container, nested, leaf, sibling].some(entity => registry.hasUIInteraction(entity))).toBe(false);
        world.insert(leaf, UIInteraction, { hovered: true });
        expect(world.getEntitiesWithComponents([UIInteraction])).toEqual([leaf]);
    });
});
