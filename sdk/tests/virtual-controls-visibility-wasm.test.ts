// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Transform } from '../src/ecs/component';
import { InputState } from '../src/input/input';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { UIEventQueue } from '../src/ui/core/events';
import { Interactable } from '../src/ui/input/interactable';
import { createVirtualControlSystem, VirtualButton, VirtualJoystick } from '../src/ui/behavior/virtual-controls';
import type { ControlPointer } from '../src/ui/input/control-pointers';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('virtual controls read authored visibility on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, input: InputState;
    let controls: ReturnType<typeof createVirtualControlSystem>;
    let parent: Entity, entity: Entity;
    const pointers = new Map<number, ControlPointer>();
    const layout = () => engine.uiLayout_update(registry, -100, -100, 100, 100, true);
    const point = (pressed: boolean) => pointers.set(1, {
        id: 1, entity, pressedEntity: pressed ? entity : null, pressed, down: true,
        layoutX: 50, layoutY: 0, worldX: 50, worldY: 0, screenX: 0, screenY: 0,
    });
    const tick = () => (controls.system._fn as (...args: unknown[]) => void)(input, { pointers }, { delta: 1 / 60 });
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine); input = new InputState(); pointers.clear();
        parent = app.world.spawn(); entity = app.world.spawn();
        for (const node of [parent, entity]) { app.world.insert(node, Transform); app.world.insert(node, UINode); }
        app.world.insert(parent, Canvas); app.world.setParent(entity, parent); app.world.insert(entity, Interactable);
        controls = createVirtualControlSystem(app.world, new UIEventQueue());
    });
    afterEach(() => { controls.dispose(); app.quit({ keepRenderer: true }); registry.delete(); });

    for (const type of [VirtualButton, VirtualJoystick] as const) {
        it.each(['self', 'ancestor'] as const)(`${type._name} releases when %s hides before layout and needs a fresh press`, target => {
            app.world.insert(entity, type);
            layout(); point(true); tick();
            const id = type === VirtualButton ? 'fire' : 'move';
            expect(input.getVirtual(id).x).toBe(1);
            app.world.update(target === 'self' ? entity : parent, UINode, node => { node.display = UIDisplay.None; });
            expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(false);
            point(false); tick(); expect(input.getVirtual(id).x).toBe(0);
            app.world.update(target === 'self' ? entity : parent, UINode, node => { node.display = UIDisplay.Flex; });
            tick(); expect(input.getVirtual(id).x).toBe(0);
            point(true); tick(); expect(input.getVirtual(id).x).toBe(1);
        });
    }
    it('accepts a fresh press after showing even while the resolved cache is hidden', () => {
        app.world.insert(entity, VirtualButton);
        app.world.update(parent, UINode, node => { node.display = UIDisplay.None; }); layout();
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(true);
        app.world.update(parent, UINode, node => { node.display = UIDisplay.Flex; });
        point(true); tick(); expect(input.getVirtual('fire').x).toBe(1);
    });
    it('observes an ancestor hidden by an earlier control change callback', () => {
        controls.dispose();
        const events = new UIEventQueue();
        controls = createVirtualControlSystem(app.world, events);
        app.world.insert(entity, VirtualButton);
        const second = app.world.spawn();
        app.world.insert(second, Transform); app.world.insert(second, UINode); app.world.insert(second, Interactable);
        app.world.insert(second, VirtualButton, { inputId: 'second' }); app.world.setParent(second, parent);
        layout(); point(true);
        pointers.set(2, { ...pointers.get(1)!, id: 2, entity: second, pressedEntity: second });
        events.on(entity, 'change', () => {
            app.world.update(parent, UINode, node => { node.display = UIDisplay.None; });
        });
        tick(); expect(input.getVirtual('second').x).toBe(0);
        point(false); tick(); expect(input.getVirtual('fire').x).toBe(0);
    });
});
