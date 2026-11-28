// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { bindRenderSurface } from '../src/app/surface';
import { CameraViewAPI } from '../src/camera/Camera';
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
import { UIBehaviorPlugin } from '../src/ui/behavior/plugin';
import { ScrollContainer } from '../src/ui/collection/scroll-container';
import { UiPointerHitCache, MOUSE_POINTER } from '../src/ui/input/pointerBook';
import { UIEvents } from '../src/ui/core/events';
import { onGestureClick, fireGestureClick, takeGestureFired } from '../src/ui/input/gestureClick';
import { inputRouter } from '../src/input/inputRouter';
import { webAdapter } from '../src/platform/web';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
const hit = vi.hoisted(() => ({ entity: null as number | null, wheelTarget: null as number | null }));
// Deterministic picking isolates event dispatch over the actual WASM Registry.
vi.mock('../src/ui/util/ui-pick', () => ({
    screenToUiWorld: (_camera: unknown, x: number, y: number) => ({ x, y }),
    screenToUiLayout: (_overlay: unknown, x: number, y: number) => ({ x, y }),
    isScreenEntity: () => true,
    uiPointerRay: () => ({}), uiLayoutRay: () => ({}), uiHitTestWorld: () => hit.entity,
    uiHitAtScreen: (_world: unknown, _cam: unknown, _overlay: unknown, x: number) =>
        x >= 200 && hit.wheelTarget !== null ? hit.wheelTarget : hit.entity,
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
        hit.wheelTarget = null;
        uiInteractionPlugin.cleanup(app);
        vi.restoreAllMocks();
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp(); registry.delete();
    });
    it('initializes new controls and repairs removed interaction state without a pointer hit', async () => {
        hit.entity = null;
        const original = app.world.spawn();
        app.world.insert(original, Interactable);
        await app.tick(1 / 60);
        expect(app.world.has(original, UIInteraction)).toBe(true);

        app.world.remove(original, UIInteraction);
        const added = app.world.spawn();
        app.world.insert(added, Interactable);
        const unrelated = app.world.spawn();
        await app.tick(1 / 60);
        expect(app.world.has(original, UIInteraction)).toBe(true);
        expect(app.world.has(added, UIInteraction)).toBe(true);
        expect(app.world.has(unrelated, UIInteraction)).toBe(false);
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
    it('projects UI and camera input using the window that owns the render canvas', async () => {
        const frame = document.body.appendChild(document.createElement('iframe'));
        const canvas = frame.contentDocument!.createElement('canvas');
        Object.defineProperty(frame.contentWindow, 'devicePixelRatio', { value: 2 });
        bindRenderSurface(app, { canvas }, { kind: 'gl-context', handle: 0 });
        const camera = app.getResource(UICameraInfo);
        Object.assign(camera, {
            valid: true, screenW: 800, screenH: 600, vpX: 0, vpY: 0, vpW: 800, vpH: 600,
            viewProjection: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        });
        const callbacks = inputEventCallbacks(app.getResource(Input));
        try {
            callbacks.onPointerMove(100, 50, 0, 0);
            await app.tick(1 / 60);
            expect(camera.worldMouseX).toBe(200);
            expect(camera.worldMouseY).toBe(500);
            expect(app.getResource(ScreenOverlay)).toMatchObject({ pointerX: 200, pointerY: 500 });
            const point = new CameraViewAPI(app).pointerToWorld(100, 50);
            expect(point?.x).toBeCloseTo(-0.5);
            expect(point?.y).toBeCloseTo(2 / 3);
            document.adoptNode(canvas);
            await app.tick(1 / 60);
            expect(camera.worldMouseX).toBe(100);
            expect(camera.worldMouseY).toBe(550);
        } finally { frame.remove(); }
    });
    it('maps camera and UI pointers through the canvas content box and frame size', async () => {
        const canvas = document.body.appendChild(document.createElement('canvas'));
        canvas.width = 800;
        canvas.height = 600;
        let resize: ((rect: DOMRectReadOnly) => void) | undefined;
        vi.spyOn(window, 'ResizeObserver').mockImplementation(function (callback: ResizeObserverCallback) {
            const observer = { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
            resize = contentRect => callback([{ target: canvas, contentRect } as unknown as ResizeObserverEntry], observer);
            return observer;
        });
        bindRenderSurface(app, { canvas }, { kind: 'gl-context', handle: 0 });
        const camera = app.getResource(UICameraInfo);
        Object.assign(camera, {
            valid: true, screenW: 800, screenH: 600, vpX: 0, vpY: 0, vpW: 800, vpH: 600,
            viewProjection: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        });
        const overlay = app.getResource(ScreenOverlay);
        overlay.surfaceW = 800;
        const callbacks = inputEventCallbacks(app.getResource(Input));
        try {
            callbacks.onPointerMove(105.5, 54.25, 0, 0);
            await app.tick(1 / 60);
            resize?.(new DOMRect(5.25, 4.125, 401, 200.5));
            await app.tick(1 / 60);
            expect(camera.worldMouseX).toBeCloseTo(200);
            expect(camera.worldMouseY).toBeCloseTo(450);
            expect(overlay.pointerX).toBeCloseTo(200);
            expect(overlay.pointerY).toBeCloseTo(450);
            const view = new CameraViewAPI(app);
            expect(view.pointerToWorld(105.5, 54.25)?.x).toBeCloseTo(-0.5);
            resize?.(new DOMRect(5.25, 4.125, 200.5, 100.25));
            await app.tick(1 / 60);
            expect(overlay.pointerX).toBeCloseTo(400);
            expect(overlay.pointerY).toBeCloseTo(300);
        } finally { canvas.remove(); }
    });
    it('scrolls the control under a wheel event without a preceding move', async () => {
        const behavior = new UIBehaviorPlugin();
        behavior.build(app);
        const left = app.world.spawn(), right = app.world.spawn();
        hit.entity = left;
        hit.wheelTarget = right;
        const container = () => new ScrollContainer({ viewportSize: { x: 100, y: 100 }, contentSize: { x: 100, y: 1000 } });
        const leftScroll = container(), rightScroll = container();
        for (const entity of [left, right]) app.world.insert(entity, Interactable);
        behavior.attachScrollContainer(left, leftScroll);
        behavior.attachScrollContainer(right, rightScroll);
        const canvas = document.body.appendChild(document.createElement('canvas'));
        webAdapter.bindInputEvents(inputEventCallbacks(app.getResource(Input)), canvas);
        try {
            await app.tick(1 / 60);
            const wheel = (x: number, deltaY: number) => {
                const event = new WheelEvent('wheel', { deltaY });
                Object.defineProperties(event, { offsetX: { value: x }, offsetY: { value: 80 } });
                canvas.dispatchEvent(event);
            };
            wheel(250, 30);
            await app.tick(1 / 60);
            expect(leftScroll.getOffset().y).toBe(0);
            expect(rightScroll.getOffset().y).toBe(30);

            app.getResource(Input).clearFrameState();
            wheel(100, 20);
            wheel(250, -20);
            const move = new MouseEvent('mousemove');
            Object.defineProperties(move, { offsetX: { value: 100 }, offsetY: { value: 80 } });
            canvas.dispatchEvent(move);
            expect(app.getResource(Input).getScrollDelta()).toEqual({ x: 0, y: 0 });
            await app.tick(1 / 60);
            expect(leftScroll.getOffset().y).toBe(20);
            expect(rightScroll.getOffset().y).toBe(10);
        } finally {
            webAdapter.unbindInputEvents();
            canvas.remove();
            behavior.cleanup(app);
        }
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
    it('cancels a held web button on blur without invoking its gesture click', async () => {
        const entity = app.world.spawn(); hit.entity = entity; app.world.insert(entity, Interactable);
        const input = app.getResource(Input), gesture = vi.fn();
        onGestureClick(app.world, entity, gesture);
        const canvas = document.body.appendChild(document.createElement('canvas'));
        const mouse = (type: string) => {
            const event = new MouseEvent(type, { button: 0, bubbles: true });
            Object.defineProperties(event, { offsetX: { value: 0 }, offsetY: { value: 0 } });
            canvas.dispatchEvent(event);
        };
        webAdapter.bindInputEvents(inputEventCallbacks(input), canvas);
        try {
            mouse('mousedown');
            await app.tick(1 / 60);
            expect(app.world.get(entity, UIInteraction).pressed).toBe(true);
            window.dispatchEvent(new Event('blur'));
            expect(gesture).not.toHaveBeenCalled();
            await app.tick(1 / 60);
            expect(app.world.get(entity, UIInteraction)).toMatchObject({ pressed: false, justReleased: false });
            mouse('mousedown');
            await app.tick(1 / 60);
            mouse('mouseup');
            expect(gesture).toHaveBeenCalledOnce();
        } finally {
            webAdapter.unbindInputEvents();
            canvas.remove();
        }
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
