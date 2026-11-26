// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { takePrimaryPointerCancellation } from '../src/input/pointerCancellation';
import { Canvas, Disabled, Transform } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { UIBehaviorPlugin } from '../src/ui/behavior/plugin';
import { ScrollContainer } from '../src/ui/collection/scroll-container';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { UIConsumesDrag } from '../src/ui/input/drag-consumption';
import { UIControlPointers } from '../src/ui/input/control-pointers';
import { UICollections } from '../src/ui/collection/collection-host';
import { UIScroll } from '../src/ui/core/ui-scroll';

describe.skipIf(!HAS_WASM)('scroll motion ownership on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, plugin: UIBehaviorPlugin;
    let entity: Entity, input: InputState;
    const container = () => new ScrollContainer({ viewportSize: { x: 100, y: 100 },
        contentSize: { x: 100, y: 2000 }, decelerationRate: .135 });
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine);
        input = new InputState(); app.insertResource(Input, input);
        app.insertResource(UIEvents, new UIEventQueue());
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, valid: true,
            vpW: 100, vpH: 100, screenW: 100, screenH: 100 });
        plugin = new UIBehaviorPlugin(); plugin.build(app); flushPendingRegistrations(app);
        entity = app.world.spawn(); app.world.insert(entity, UIInteraction, { hovered: true });
        // Refresh the shared WASM layout cache for this registry before pointer projection.
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
    });
    afterEach(() => { app.quit({ keepRenderer: true }); registry.delete(); });
    async function step(y: number) {
        app.getResource(UICameraInfo).worldMouseY = y;
        await app.tick(1 / 60); input.clearFrameState();
    }
    async function drag() {
        input.noteMouseDown(0); await step(0); await step(40); await step(80);
    }
    it('adopts a scene scroll view into its own app when a preview shares the plugin', async () => {
        const previewRegistry = new engine.Registry(), preview = App.new();
        preview.connectCpp(previewRegistry, engine); preview.insertResource(UIEvents, new UIEventQueue());
        plugin.build(preview);
        try {
            const playHost = vi.spyOn(app.getResource(UICollections), 'attachScrollContainer');
            const previewHost = vi.spyOn(preview.getResource(UICollections), 'attachScrollContainer');
            const content = app.world.spawn(); app.world.insert(content, UINode); app.world.setParent(content, entity);
            app.world.insert(entity, UIScroll, { ...UIScroll._default, content });
            await step(0);
            expect(playHost).toHaveBeenCalledWith(entity, expect.any(ScrollContainer));
            expect(previewHost).not.toHaveBeenCalled();
        } finally {
            plugin.cleanup(preview); preview.quit({ keepRenderer: true }); previewRegistry.delete();
        }
    });
    it('a drag at a clamped end cancels the pressed row once, while a tap keeps its click', async () => {
        const scroll = container(), cancelHold = vi.fn();
        plugin.attachScrollContainer(entity, scroll);
        const row = app.world.spawn(); app.world.setParent(row, entity);
        const pointer = { id: 4, down: true, pressed: true, entity: row, pressedEntity: row,
            worldX: 0, worldY: 0, layoutX: 0, layoutY: 0, screenX: 0, screenY: 0 };
        app.insertResource(UIControlPointers, { pointers: new Map([[4, pointer]]), cancelHold });
        input.noteMouseDown(0); await step(0);
        input.noteMouseUp(0); await step(0);
        expect(cancelHold).not.toHaveBeenCalled();
        input.noteMouseDown(0); await step(0); await step(-9); await step(-12);
        expect(scroll.getOffset().y).toBe(0);
        expect(cancelHold.mock.calls).toEqual([[4]]);
    });
    it('a child control consumes drag without preventing the parent wheel scroll', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll);
        const child = app.world.spawn(); app.world.setParent(child, entity);
        app.world.insert(child, UIInteraction, { hovered: true }); app.world.insert(child, UIConsumesDrag);
        await drag(); expect(scroll.getOffset().y).toBe(0);
        input.scrollDeltaY = 30; await step(80); expect(scroll.getOffset().y).toBe(30);
    });
    it('drag consumption on an ancestor protects a nested hit as well', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll);
        const control = app.world.spawn(), leaf = app.world.spawn();
        app.world.setParent(control, entity); app.world.setParent(leaf, control);
        app.world.insert(control, UIConsumesDrag); app.world.insert(leaf, UIInteraction, { hovered: true });
        await drag(); expect(scroll.getOffset().y).toBe(0);
    });
    it('does not dirty native thumb geometry after fractional lengths settle', async () => {
        const scroll = new ScrollContainer({ viewportSize: { x: 100, y: 100 },
            contentSize: { x: 300, y: 300 }, direction: 'both' });
        plugin.attachScrollContainer(entity, scroll); await step(0);
        scroll.scrollBy({ x: 50, y: 50 }); await step(0);
        const { UINode } = await import('../src/ui/core/ui-node');
        const { UIVisual } = await import('../src/ui/core/ui-visual');
        const thumbs = app.world.getEntitiesWithComponents([UINode, UIVisual]);
        expect(thumbs).toHaveLength(2);
        const insert = vi.spyOn(app.world, 'insert');
        try {
            for (let i = 0; i < 120; i++) await step(0);
            expect(insert.mock.calls.filter(([, component]) => component === UINode)).toHaveLength(0);
            for (const thumb of thumbs) expect(app.world.get(thumb, UIVisual).color.a).toBe(0);
        } finally { insert.mockRestore(); }
    });

    it('keeps native scrollbar dimensions finite when content and viewport become empty', async () => {
        const scroll = new ScrollContainer({ viewportSize: { x: 100, y: 100 },
            contentSize: { x: 300, y: 300 }, direction: 'both' });
        plugin.attachScrollContainer(entity, scroll); await step(0);
        scroll.scrollBy({ x: 50, y: 50 }); await step(0);
        const { UINode } = await import('../src/ui/core/ui-node');
        const thumbs = app.world.getEntitiesWithComponents([UINode]);
        expect(thumbs).toHaveLength(2);
        for (const size of [100, 0, 10]) {
            scroll.setSizes({ x: size, y: size }, { x: 0, y: 0 }); await step(0);
            for (const thumb of thumbs) {
                const n = app.world.get(thumb, UINode);
                for (const dimension of [n.width, n.height, n.insetTop, n.insetLeft]) {
                    expect(Number.isFinite(dimension.value)).toBe(true);
                }
            }
        }
        scroll.setSizes({ x: 100, y: 100 }, { x: 300, y: 300 });
        scroll.scrollBy({ x: 50, y: 50 }); await step(0);
        for (const thumb of thumbs) {
            const n = app.world.get(thumb, UINode);
            expect(Math.max(n.width.value, n.height.value)).toBeCloseTo(100 / 3);
        }
    });

    it('a replaced container does not inherit an active pointer drag', async () => {
        const old = container(); plugin.attachScrollContainer(entity, old); await drag();
        expect(old.getOffset().y).toBe(80);
        const next = container(); plugin.attachScrollContainer(entity, next);
        await step(120);
        expect(next.getOffset().y).toBe(0);
        expect(old.getOffset().y).toBe(80);
    });
    it('a replaced container does not inherit the previous content fling', async () => {
        const old = container(); plugin.attachScrollContainer(entity, old); await drag();
        input.noteMouseUp(0); await step(100); await step(100);
        expect(old.getOffset().y).toBeGreaterThan(100);
        const next = container(); plugin.attachScrollContainer(entity, next);
        for (let i = 0; i < 10; i++) await step(100);
        expect(next.getOffset().y).toBe(0);
    });
    it('an editor-owned release cancels the drag without starting a fling', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
        try { inputEventCallbacks(input).onPointerUp(0); } finally { off(); }
        takePrimaryPointerCancellation(input);
        for (let i = 0; i < 10; i++) await step(100);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('a new press before sampling cancellation grabs from the retained offset', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        inputEventCallbacks(input).onInputCancel!();
        input.noteMouseDown(0); await step(200); await step(240);
        expect(scroll.getOffset().y).toBe(120);
        inputEventCallbacks(input).onInputCancel!();
        for (let i = 0; i < 10; i++) await step(300);
        expect(scroll.getOffset().y).toBe(120);
    });
    it.each(['inactive', 'noninteractive'])('a %s captured viewport stops moving', async kind => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        if (kind === 'inactive') app.world.insert(entity, Disabled);
        else app.world.insert(entity, Interactable, { enabled: false });
        await step(120);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('losing all pointer projections cancels capture before the view returns', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        app.getResource(UICameraInfo).valid = false; await step(120);
        app.getResource(UICameraInfo).valid = true; await step(140);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('a hidden viewport stops its captured drag after layout resolves visibility', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        app.world.insert(entity, Canvas); app.world.insert(entity, Transform);
        app.world.insert(entity, UINode, { display: 1 });
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(true);
        await step(120);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('disabling a viewport stops an already released fling', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        input.noteMouseUp(0); await step(100);
        const before = scroll.getOffset().y;
        app.world.insert(entity, Disabled);
        for (let i = 0; i < 10; i++) await step(100);
        expect(scroll.getOffset().y).toBe(before);
    });
    it('host input cancellation stops a released fling before the next frame', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        input.noteMouseUp(0); await step(100); await step(100);
        const before = scroll.getOffset().y;
        expect(before).toBeGreaterThan(100);
        inputEventCallbacks(input).onInputCancel!();
        takePrimaryPointerCancellation(input);
        for (let i = 0; i < 10; i++) await step(100);
        expect(scroll.getOffset().y).toBe(before);
    });
});
