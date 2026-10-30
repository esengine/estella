// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Transform } from '../src/ecs/component';
import { InputState } from '../src/input/input';
import { UINode } from '../src/ui/core/ui-node';
import { UIEventQueue } from '../src/ui/core/events';
import { Interactable } from '../src/ui/input/interactable';
import { createVirtualControlSystem, VirtualJoystick, VirtualJoystickMode } from '../src/ui/behavior/virtual-controls';
import type { ControlPointer } from '../src/ui/input/control-pointers';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('virtual joystick coordinates on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, input: InputState;
    let controls: ReturnType<typeof createVirtualControlSystem>, grand: Entity, parent: Entity, entity: Entity;
    const pointers = new Map<number, ControlPointer>();
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine); input = new InputState(); pointers.clear();
        grand = app.world.spawn(); parent = app.world.spawn(); entity = app.world.spawn();
        app.world.insert(grand, Transform, { position: { x: 7, y: -3, z: 0 }, scale: { x: 2, y: 1, z: 1 } });
        app.world.insert(parent, Transform, { position: { x: -30, y: 15, z: 0 },
            rotation: { x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) } });
        app.world.insert(entity, Transform, { position: { x: 10, y: 20, z: 0 } });
        app.world.setParent(parent, grand); app.world.setParent(entity, parent);
        app.world.insert(entity, UINode); app.world.insert(entity, Interactable);
        app.world.insert(entity, VirtualJoystick, { deadZone: 0, radius: 50 });
        engine.transform_update(registry);
        controls = createVirtualControlSystem(app.world, new UIEventQueue());
    });
    afterEach(() => { controls.dispose(); app.quit({ keepRenderer: true }); registry.delete(); });
    const point = (x: number, y: number, pressed: boolean) => {
        const c = Math.SQRT1_2, worldX = 7 + 2 * (-30 + c * (10 + x) - c * (20 + y));
        const worldY = -3 + 15 + c * (10 + x) + c * (20 + y);
        pointers.set(1, { id: 1, entity, pressedEntity: pressed ? entity : null, down: true, pressed,
            layoutX: worldX, layoutY: worldY, worldX, worldY, screenX: 0, screenY: 0 });
    };
    const tick = () => (controls.system._fn as (...args: unknown[]) => void)(input, { pointers }, { delta: 1 / 60 });
    it.each([[25, 0], [0, 25], [15, 20]])('preserves local direction and strength at (%s, %s) through sheared ancestors', (x, y) => {
        point(x, y, true); tick();
        expect(input.getVirtual('move').x).toBeCloseTo(x / 50, 5);
        expect(input.getVirtual('move').y).toBeCloseTo(y / 50, 5);
    });
    it('keeps a follow joystick origin in the same local coordinate space', () => {
        app.world.update(entity, VirtualJoystick, data => { data.mode = VirtualJoystickMode.Follow; });
        point(10, -5, true); tick(); expect(input.getVirtual('move')).toEqual({ x: 0, y: 0 });
        point(10, 20, false); tick();
        expect(input.getVirtual('move').x).toBeCloseTo(0, 5);
        expect(input.getVirtual('move').y).toBeCloseTo(.5, 5);
    });
    it('releases a capture when its transform collapses and requires a fresh press after restoration', () => {
        point(25, 0, true); tick();
        app.world.update(grand, Transform, data => { data.scale.x = 0; }); engine.transform_update(registry);
        point(25, 0, false); tick(); expect(input.getVirtual('move')).toEqual({ x: 0, y: 0 });
        app.world.update(grand, Transform, data => { data.scale.x = 2; }); engine.transform_update(registry);
        tick(); expect(input.getVirtual('move')).toEqual({ x: 0, y: 0 });
        point(25, 0, true); tick(); expect(input.getVirtual('move').x).toBeCloseTo(.5, 5);
    });
});
