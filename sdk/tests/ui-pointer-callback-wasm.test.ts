// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { defineInputMap, Axis2D, Virtual } from '../src/input/inputMap';
import { Transform } from '../src/ecs/component';
import { createVirtualControlSystem, VirtualJoystick } from '../src/ui/behavior/virtual-controls';
import { Schedule } from '../src/ecs/system';
import { UINode } from '../src/ui/core/ui-node';
import { SystemLabel } from '../src/ecs/systemLabels';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ScreenOverlay } from '../src/ui/core/screen-overlay';
import { UILayoutGeneration } from '../src/ui/layout/ui-layout-generation';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { uiInteractionPlugin } from '../src/ui/input/interaction';
import { UiPointerHitCache, MOUSE_POINTER } from '../src/ui/input/pointerBook';
import { UIEvents } from '../src/ui/core/events';
import { onGestureClick, fireGestureClick, takeGestureFired } from '../src/ui/input/gestureClick';
import { inputRouter } from '../src/input/inputRouter';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
const hit = vi.hoisted(() => ({ entity: null as number | null }));
// Deterministic picking isolates event dispatch over the actual WASM Registry.
vi.mock('../src/ui/util/ui-pick', () => ({
    screenToUiWorld: (_camera: unknown, x: number, y: number) => ({ x, y }),
    screenToUiLayout: (_overlay: unknown, x: number, y: number) => ({ x, y }),
    isScreenEntity: () => true,
    uiPointerRay: () => ({}), uiLayoutRay: () => ({}), uiHitTestWorld: () => hit.entity, uiHitAtScreen: () => hit.entity,
}));

describe.skipIf(!HAS_WASM)('pointer callback lifecycle on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); setEditorMode(false); setPlayMode(false);
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine);
        app.insertResource(Input, new InputState());
        app.insertResource(UICameraInfo, { valid: false } as any);
        app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
        app.insertResource(UILayoutGeneration, { generation: 0 });
        uiInteractionPlugin.build(app); flushPendingRegistrations(app);
    });
    afterEach(() => {
        uiInteractionPlugin.cleanup(app);
        vi.restoreAllMocks();
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp(); registry.delete();
    });
    it('evaluates a registered InputMap after virtual controls in the same frame', async () => {
        const map = defineInputMap({ Move: Axis2D(Virtual('move')) });
        flushPendingRegistrations(app);
        const virtual = createVirtualControlSystem(app.world, app.getResource(UIEvents));
        app.addSystemToSchedule(Schedule.PreUpdate, virtual.system, { runAfter: [SystemLabel.UIInteraction] });
        const entity = app.world.spawn(); hit.entity = entity;
        app.world.insert(entity, Transform); app.world.insert(entity, Interactable);
        app.world.insert(entity, UINode);
        app.world.insert(entity, VirtualJoystick);
        const state = app.getResource(Input), callbacks = inputEventCallbacks(state);
        callbacks.onTouchStart!(5, 50, 600); await app.tick(1 / 60);
        expect(state.getVirtual('move').x).toBeCloseTo(1);
        expect(map.axis2d('Move').x).toBeCloseTo(1);
        state.clearFrameState(); callbacks.onTouchCancel!(5); await app.tick(1 / 60);
        expect(map.axis2d('Move')).toEqual({ x: 0, y: 0 });
        virtual.dispose();
    });
    it('keeps the replacement touch held and projects its current position', async () => {
        const entity = app.world.spawn(); hit.entity = entity; app.world.insert(entity, Interactable);
        const input = app.getResource(Input), callbacks = inputEventCallbacks(input);
        callbacks.onTouchStart!(3, 10, 0); await app.tick(1 / 60); input.clearFrameState();
        callbacks.onTouchEnd!(3); callbacks.onTouchStart!(3, 150, 0);
        const clicks = vi.fn(); app.getResource(UIEvents).on(entity, 'click', clicks);
        await app.tick(1 / 60);
        expect(clicks).toHaveBeenCalledOnce();
        expect(app.world.get(entity, UIInteraction).pressed).toBe(true);
        expect(app.getResource(ScreenOverlay).pointerX).toBe(150);
        input.clearFrameState(); callbacks.onTouchEnd!(3); await app.tick(1 / 60);
        expect(clicks).toHaveBeenCalledTimes(2);
        expect(app.world.get(entity, UIInteraction).pressed).toBe(false);
    });
    it('a consumed primary release cancels the actual WASM control instead of clicking it', async () => {
        const entity = app.world.spawn(); hit.entity = entity; app.world.insert(entity, Interactable);
        const input = app.getResource(Input), callbacks = inputEventCallbacks(input), clicked = vi.fn();
        app.getResource(UIEvents).on(entity, 'click', clicked);
        callbacks.onPointerDown(0, 0, 0); await app.tick(1 / 60); input.clearFrameState();
        const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
        try { callbacks.onPointerUp(0); } finally { off(); }
        input.clearFrameState(); await app.tick(1 / 60);
        expect(clicked).not.toHaveBeenCalled();
        expect(app.world.get(entity, UIInteraction)).toMatchObject({ pressed: false, justReleased: false });
    });
    it('expires a cancelled gesture marker before a later quick click on real WASM', async () => {
        const entity = app.world.spawn(); hit.entity = entity; app.world.insert(entity, Interactable);
        const input = app.getResource(Input), clicked = vi.fn();
        onGestureClick(app.world, entity, () => {
            clicked(); app.world.update(entity, Interactable, value => { value.enabled = false; });
        });
        app.getResource(UIEvents).on(entity, 'click', () => {
            if (!takeGestureFired(app.world, entity)) clicked();
        });
        input.noteMouseDown(0); await app.tick(1 / 60); input.clearFrameState();
        inputRouter.dispatchPointerUp(0); input.noteMouseUp(0); await app.tick(1 / 60); input.clearFrameState();
        app.world.update(entity, Interactable, value => { value.enabled = true; });
        input.noteMouseDown(0); input.noteMouseUp(0); await app.tick(1 / 60);
        expect(clicked).toHaveBeenCalledTimes(2);
    });
    it('cleans gesture registrations and markers across real WASM target lifetimes', () => {
        const before = app.world.getStorageSizes().despawnCallbacks;
        for (let i = 0; i < 1000; i++) {
            const entity = app.world.spawn(); const clicked = vi.fn();
            onGestureClick(app.world, entity, clicked);
            expect(fireGestureClick(app.world, entity)).toBe(true);
            app.world.despawn(entity);
            expect(fireGestureClick(app.world, entity)).toBe(false);
            expect(takeGestureFired(app.world, entity)).toBe(false);
            expect(clicked).toHaveBeenCalledOnce();
        }
        expect(app.world.getStorageSizes().despawnCallbacks).toBe(before + 1);
    });
    it('does not retain past touch IDs across 1000 real interaction updates', async () => {
        const entity = app.world.spawn(); hit.entity = entity;
        app.world.insert(entity, Interactable, { enabled: true });
        const input = app.getResource(Input);
        const retain = vi.spyOn(UiPointerHitCache.prototype, 'retain');
        for (let id = 0; id < 1000; id++) {
            input.touches.set(id, { id, x: 10, y: 20 });
            input.touchesStarted.set(id, { id, x: 10, y: 20 });
            input.endTouch(id);
            await app.tick(1 / 60);
            const cache = retain.mock.contexts[0] as UiPointerHitCache;
            expect([...cache.keys()]).toEqual([id]);
            input.clearFrameState();
        }
        await app.tick(1 / 60);
        const cache = retain.mock.contexts[0] as UiPointerHitCache;
        expect([...cache.keys()]).toEqual([MOUSE_POINTER]);
    });
    for (const mutation of ['disable', 'despawn'] as const) {
        it.each(['hover_enter', 'press', 'release'])(`${mutation} during %s stops later events`, async phase => {
            const entity = app.world.spawn(); hit.entity = entity;
            app.world.insert(entity, Interactable, { enabled: true });
            const kinds: string[] = [];
            for (const kind of ['hover_enter', 'press', 'release', 'click']) {
                app.getResource(UIEvents).on(entity, kind, () => {
                    kinds.push(kind);
                    if (kind !== phase) return;
                    if (mutation === 'despawn') app.world.despawn(entity);
                    else app.world.update(entity, Interactable, data => { data.enabled = false; });
                });
            }
            const input = app.getResource(Input);
            input.noteMouseDown(0); input.noteMouseUp(0);
            await app.tick(1 / 60);
            const order = ['hover_enter', 'press', 'release'];
            expect(kinds).toEqual(order.slice(0, order.indexOf(phase) + 1));
            expect(input.pointerOverUI).toBe(false);
            if (mutation === 'despawn') expect(app.world.valid(entity)).toBe(false);
            else expect(app.world.get(entity, UIInteraction)).toMatchObject({
                hovered: false, pressed: false, justPressed: false, justReleased: false,
            });
        });
    }
});
