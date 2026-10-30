// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { InputState, inputEventCallbacks } from '../src/input/input';
import { InputMap, Axis2D, Button, Virtual } from '../src/input/inputMap';
import { Transform } from '../src/ecs/component';
import { UIEventQueue } from '../src/ui/core/events';
import { Interactable } from '../src/ui/input/interactable';
import { UINode, UIPointerEvents } from '../src/ui/core/ui-node';
import { createVirtualControlSystem, VirtualJoystick, VirtualButton, VirtualJoystickMode, joystickAxis } from '../src/ui/behavior/virtual-controls';
import type { World } from '../src/ecs/world';
import type { Entity } from '../src/types';
import type { ControlPointer } from '../src/ui/input/control-pointers';

function fixture() {
    const entities = new Map<number, Map<object, unknown>>();
    const removals = new Set<(entity: Entity) => void>();
    const world = {
        valid: (e: number) => entities.has(e), isEntityActive: (e: number) => entities.has(e), isDestructionPending: () => false,
        has: (e: number, c: object) => entities.get(e)?.has(c) ?? false,
        get: (e: number, c: object) => entities.get(e)?.get(c),
        insert: (e: number, c: object, v: unknown) => entities.get(e)?.set(c, v),
        getEntitiesWithComponents: (cs: object[]) => [...entities].filter(([, comps]) => cs.every(c => comps.has(c))).map(([e]) => e),
        getWasmModule: () => null, getCppRegistry: () => null,
        onDespawn: (h: (e: Entity) => void) => { removals.add(h); return () => { removals.delete(h); }; },
    } as unknown as World;
    const add = (id: number, component: typeof VirtualButton | typeof VirtualJoystick, patch: Record<string, unknown> = {}) => {
        entities.set(id, new Map());
        world.insert(id as Entity, Transform, { ...Transform._default });
        world.insert(id as Entity, Interactable, { ...Interactable._default });
        world.insert(id as Entity, UINode, { ...UINode._default });
        world.insert(id as Entity, component, { ...component._default, ...patch });
    };
    const input = new InputState(); const pointers = new Map<number, ControlPointer>();
    const events = new UIEventQueue();
    const control = createVirtualControlSystem(world, events);
    const invoke = control.system._fn as unknown as (input: InputState, frame: { pointers: Map<number, ControlPointer> }, time: { delta: number }) => void;
    const tick = () => invoke(input, { pointers }, { delta: 1 / 60 });
    const point = (id: number, entity: number, x: number, y: number, pressed = false) => {
        pointers.set(id, { id, entity: entity as Entity, pressedEntity: pressed ? entity as Entity : null,
            down: true, pressed, layoutX: x, layoutY: y, worldX: x, worldY: y, screenX: 0, screenY: 0 });
    };
    const remove = (id: number) => { for (const h of removals) h(id as Entity); entities.delete(id); };
    return { world, input, pointers, events, tick, point, add, remove, dispose: control.dispose };
}
describe('virtual control ownership and InputMap', () => {
    it('releases a collapsed legacy transform without rearming an already held pointer', () => {
        const f = fixture(); f.add(1, VirtualJoystick); f.point(1, 1, 50, 0, true); f.tick();
        const transform = f.world.get(1 as Entity, Transform);
        f.world.insert(1 as Entity, Transform, { ...transform, worldScale: { x: 0, y: 1, z: 1 } });
        f.point(1, 1, 50, 0); f.tick(); expect(f.input.getVirtual('move')).toEqual({ x: 0, y: 0 });
        f.world.insert(1 as Entity, Transform, transform); f.tick();
        expect(f.input.getVirtual('move')).toEqual({ x: 0, y: 0 });
        f.point(1, 1, 50, 0, true); f.tick(); expect(f.input.getVirtual('move').x).toBe(1); f.dispose();
    });
    it('does not rescan every pointer for every idle or held control', () => {
        const f = fixture();
        for (let entity = 1; entity <= 100; entity++) f.add(entity, VirtualButton);
        for (let pointer = 1; pointer <= 10; pointer++) f.point(pointer, pointer, 0, 0, true);
        f.tick();
        for (const pointer of f.pointers.values()) pointer.pressed = false;
        const values = f.pointers.values.bind(f.pointers);
        let visits = 0;
        f.pointers.values = () => {
            const iterator = values(), next = iterator.next.bind(iterator);
            iterator.next = () => { const result = next(); if (!result.done) visits++; return result; };
            return iterator;
        };
        f.tick();
        expect(visits).toBeLessThanOrEqual(2 * f.pointers.size);
        expect(f.input.getVirtual('fire').x).toBe(1); f.dispose();
    });
    it('refreshes the pointer projection after a change callback cancels another capture', () => {
        const f = fixture(); f.add(1, VirtualButton); f.add(2, VirtualButton, { inputId: 'second' });
        f.point(1, 1, 0, 0, true); f.point(2, 2, 0, 0, true);
        f.events.on(1 as Entity, 'change', () => { f.pointers.delete(2); });
        f.tick(); expect(f.input.getVirtual('fire').x).toBe(1);
        expect(f.input.getVirtual('second').x).toBe(0); f.dispose();
    });
    it('two fingers move and fire at once; cancelling only the button leaves movement held', () => {
        const f = fixture(); f.add(1, VirtualJoystick); f.add(2, VirtualButton);
        const map = new InputMap({ Move: Axis2D(Virtual('move')), Fire: Button(Virtual('fire')) });
        f.point(11, 1, 50, 0, true); f.point(22, 2, 0, 0, true); f.tick(); map.evaluate(f.input);
        expect(map.axis2d('Move').x).toBe(1); expect(map.down('Fire')).toBe(true);
        f.pointers.delete(22); f.point(11, 1, 50, 0); f.tick(); map.evaluate(f.input);
        expect(map.axis2d('Move').x).toBe(1); expect(map.down('Fire')).toBe(false);
        f.dispose();
    });
    it('removal immediately releases only its source, including two controls sharing one input', () => {
        const f = fixture(); f.add(1, VirtualButton); f.add(2, VirtualButton);
        f.point(1, 1, 0, 0, true); f.point(2, 2, 0, 0, true); f.tick();
        f.remove(1); expect(f.input.getVirtual('fire').x).toBe(1);
        f.remove(2); expect(f.input.getVirtual('fire').x).toBe(0); f.dispose();
    });
    it('disabling while dragged releases and cannot rearm an already-held finger', () => {
        const f = fixture(); f.add(1, VirtualJoystick); f.point(7, 1, 50, 0, true); f.tick();
        f.world.insert(1 as Entity, Interactable, { ...Interactable._default, enabled: false });
        f.point(7, 1, 50, 0); f.tick(); expect(f.input.getVirtual('move')).toEqual({ x: 0, y: 0 });
        f.world.insert(1 as Entity, Interactable, { ...Interactable._default }); f.tick();
        expect(f.input.getVirtual('move')).toEqual({ x: 0, y: 0 }); f.dispose();
    });
    it('a follow joystick starts under its own finger; fixed uses the control centre', () => {
        const f = fixture(); f.add(1, VirtualJoystick, { mode: VirtualJoystickMode.Follow });
        f.point(8, 1, 20, 10, true); f.tick(); expect(f.input.getVirtual('move').x).toBe(0);
        f.point(8, 1, 70, 10); f.tick(); expect(f.input.getVirtual('move').x).toBe(1);
        f.pointers.clear(); f.tick(); expect(f.input.getVirtual('move').x).toBe(0); f.dispose();
    });
    it('a tap completed between frames produces one action edge and then releases', () => {
        const f = fixture(); f.add(1, VirtualButton); f.point(8, 1, 0, 0, true);
        Object.assign(f.pointers.get(8)!, { entity: null, down: false });
        const map = new InputMap({ Fire: Button(Virtual('fire')) }); f.tick(); map.evaluate(f.input);
        expect(map.pressed('Fire')).toBe(true);
        f.pointers.clear(); f.tick(); map.evaluate(f.input); expect(map.released('Fire')).toBe(true); f.dispose();
    });
    it('pointer-events none releases output and changing a binding cannot leave the old axis stuck', () => {
        const f = fixture(); f.add(1, VirtualJoystick); f.point(8, 1, 50, 0, true); f.tick();
        f.world.insert(1 as Entity, VirtualJoystick, { ...VirtualJoystick._default, inputId: 'other' });
        f.point(8, 1, 50, 0); f.tick(); expect(f.input.getVirtual('move').x).toBe(0); expect(f.input.getVirtual('other').x).toBe(1);
        f.world.insert(1 as Entity, UINode, { ...UINode._default, pointerEvents: UIPointerEvents.None });
        f.tick(); expect(f.input.getVirtual('other').x).toBe(0); f.dispose();
    });
    it('source summation is independent of write order, and cleanup preserves manual input', () => {
        const input = new InputState(); const owners = [{}, {}, {}];
        input.setVirtualSource(owners[0], 'move', 1); input.setVirtualSource(owners[1], 'move', 1); input.setVirtualSource(owners[2], 'move', -1);
        expect(input.getVirtual('move').x).toBe(1);
        input.setVirtual('other', 0.5); input.removeVirtualSource(owners[0]); expect(input.getVirtual('other').x).toBe(0.5);
    });
    it('global host cancellation clears controls immediately instead of waiting for another frame', () => {
        const input = new InputState(); input.setVirtualSource({}, 'move', 1); input.setVirtual('other', 1);
        inputEventCallbacks(input).onInputCancel?.(); expect(input.getVirtual('move').x).toBe(0); expect(input.getVirtual('other').x).toBe(1);
    });
    it('radial dead zone preserves direction, clamps the rim, and rejects nonfinite input', () => {
        expect(joystickAxis(2, 2, 50, 0.15)).toEqual({ x: 0, y: 0 });
        const axis = joystickAxis(500, 500, 50, 0.15); expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
        expect(axis.x).toBeCloseTo(axis.y); expect(joystickAxis(NaN, 0, 50, 0.15)).toEqual({ x: 0, y: 0 });
    });
});
