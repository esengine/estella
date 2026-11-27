// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Transform, registerComponent } from '../src/ecs/component';
import { ContentRect } from '../src/ui/core/content-rect';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { UINode } from '../src/ui/core/ui-node';
import { spawnUIEntity } from '../src/ui/core/compose';
import { px } from '../src/ui/core/dimension';
import { ScreenOverlay, defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { ScreenLayout, screenLayoutRect, screenProjection } from '../src/ui/core/screen-layout';
import { UILayoutGeneration } from '../src/ui/layout/ui-layout-generation';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { uiInteractionPlugin } from '../src/ui/input/interaction';
import { UIBehaviorPlugin } from '../src/ui/behavior/plugin';
import { ScrollContainer } from '../src/ui/collection/scroll-container';
import { webAdapter } from '../src/platform/web';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('the UI hit test on a frame where nothing changed (WASM)', () => {
    let module: ESEngineModule;
    let app: App | undefined;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;

    beforeAll(async () => { module = await loadWasmModule(); });
    afterEach(() => {
        vi.restoreAllMocks();
        if (app) uiInteractionPlugin.cleanup(app);
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    function boot(withButton = true): { a: App; input: InputState; button: Entity; root: Entity } {
        setDefaultContext(new AppContext());
        registry = new module.Registry();
        const a = App.new();
        app = a;
        a.connectCpp(registry, module);
        const input = new InputState();
        a.insertResource(Input, input);
        const layout = screenLayoutRect(null, 100, 100);
        a.insertResource(ScreenLayout, layout);
        a.insertResource(ScreenOverlay, { ...defaultScreenOverlay(), active: true, projection: screenProjection(layout),
            vpW: 100, vpH: 100, surfaceW: 100, surfaceH: 100 });
        a.insertResource(UICameraInfo, structuredClone(UICameraInfo._default));
        registerComponent('ContentRect', ContentRect);
        uiLayoutPlugin.build(a);
        uiInteractionPlugin.build(a);
        flushPendingRegistrations(a);
        const root = spawnUIEntity({ world: a.world, node: { width: px(100), height: px(100) } });
        a.world.insert(root, Canvas);
        const button = spawnUIEntity({ world: a.world, parent: root, node: { width: px(withButton ? 100 : 1), height: px(withButton ? 100 : 1) } });
        if (withButton) a.world.insert(button, Interactable);
        input.mouseX = 50;
        input.mouseY = 50;
        return { a, input, button, root };
    }

    function countHitTests(): () => number {
        const domains = vi.spyOn(module as Required<ESEngineModule>, 'uiHitTest_updateDomains');
        const single = vi.spyOn(module, 'uiHitTest_update');
        return () => domains.mock.calls.length + single.mock.calls.length;
    }

    async function frames(a: App, n: number): Promise<void> {
        for (let i = 0; i < n; i++) await a.tick(1 / 60);
    }

    it('reuses consecutive wheel misses and tests again after a scroll callback changes the hit', async () => {
        const { a, input, button } = boot();
        const behavior = new UIBehaviorPlugin();
        behavior.build(a);
        const container = new ScrollContainer({ viewportSize: { x: 100, y: 100 }, contentSize: { x: 100, y: 300 } });
        behavior.attachScrollContainer(button, container);
        const wheel = inputEventCallbacks(input).onWheel;
        await frames(a, 2);
        const hitTests = countHitTests();
        try {
            for (let i = 0; i < 12; i++) wheel(0, 1, 125, 50);
            await frames(a, 1);
            expect(hitTests()).toBe(2); // final cursor hover, then the wheel batch
            expect(container.getOffset().y).toBe(0);
            input.clearFrameState();
            const stop = container.onScroll(() => {
                a.world.update(button, Interactable, component => { component.enabled = false; });
            });
            wheel(0, 10, 50, 50);
            wheel(0, 10, 50, 50);
            await frames(a, 1);
            expect(container.getOffset().y).toBe(10);
            stop();
        } finally { behavior.cleanup(a); }
    });

    it('keeps fractional positioned deltas out of the hovered wheel fallback', async () => {
        const { a, input, button } = boot();
        const behavior = new UIBehaviorPlugin();
        behavior.build(a);
        const container = new ScrollContainer({ viewportSize: { x: 100, y: 100 }, contentSize: { x: 100, y: 300 } });
        behavior.attachScrollContainer(button, container);
        const wheel = inputEventCallbacks(input).onWheel;
        const offsets: number[] = [];
        const stop = container.onScroll(offset => offsets.push(offset.y));
        try {
            await frames(a, 2);
            wheel(0, 1);
            wheel(0, 0.1, 125, 50);
            wheel(0, -1);
            input.mouseX = 50;
            await frames(a, 1);
            expect(offsets).toEqual([]);
            input.clearFrameState();

            wheel(0, 1);
            wheel(0, 0.1, 125, 50);
            input.scrollDeltaY += 2;
            input.mouseX = 50;
            await frames(a, 1);
            expect(offsets).toEqual([3]);
        } finally {
            stop();
            behavior.cleanup(a);
        }
    });

    it.each(['blur', 'hold'])('drops the rest of a wheel batch when a scroll listener causes %s', async kind => {
        const { a, input, button } = boot();
        const behavior = new UIBehaviorPlugin();
        behavior.build(a);
        const container = new ScrollContainer({ viewportSize: { x: 100, y: 100 }, contentSize: { x: 100, y: 300 } });
        behavior.attachScrollContainer(button, container);
        const canvas = document.body.appendChild(document.createElement('canvas'));
        const callbacks = inputEventCallbacks(input);
        webAdapter.bindInputEvents(callbacks, canvas);
        const offsets: number[] = [];
        let release: (() => void) | undefined;
        const stop = container.onScroll(offset => {
            offsets.push(offset.y);
            if (offsets.length !== 1) return;
            if (kind === 'blur') window.dispatchEvent(new Event('blur'));
            else release = a.holdExecution();
        });
        try {
            await frames(a, 2);
            callbacks.onWheel(0, 10, 50, 50);
            callbacks.onWheel(0, 20, 50, 50);
            await frames(a, 1);
            expect(offsets).toEqual([10]);
            expect(input.getScrollDelta()).toEqual({ x: 0, y: 0 });
            release?.();
            callbacks.onWheel(0, 7, 50, 50);
            await frames(a, 1);
            expect(offsets).toEqual([10, 17]);
        } finally {
            release?.();
            stop();
            webAdapter.unbindInputEvents();
            canvas.remove();
            behavior.cleanup(a);
        }
    });

    it('skips the hit test while nothing moves, and runs it again once the layout changes', async () => {
        const { a, button } = boot();
        await frames(a, 4);
        expect(a.world.get(button, UIInteraction).hovered).toBe(true);
        const generation = a.getResource(UILayoutGeneration).generation;
        const hitTests = countHitTests();

        await frames(a, 5);
        expect(hitTests()).toBe(0);
        expect(a.getResource(UILayoutGeneration).generation).toBe(generation);
        expect(a.world.get(button, UIInteraction).hovered).toBe(true);

        a.world.update(button, UINode, node => { node.width = px(10); node.height = px(10); });
        await frames(a, 1);
        expect(a.getResource(UILayoutGeneration).generation).toBeGreaterThan(generation);
        expect(hitTests()).toBeGreaterThan(0);
        expect(a.world.get(button, UIInteraction).hovered).toBe(false);
    });

    it('notices an interactable moved under a still pointer, and ignores anything else that moves', async () => {
        const { a } = boot(false);
        const area = a.world.spawn();
        a.world.insert(area, Transform, { position: { x: 500, y: 500, z: 0 } });
        a.world.insert(area, ContentRect, { size: { x: 20, y: 20 }, pivot: { x: 0.5, y: 0.5 } });
        a.world.insert(area, Interactable);
        const mover = a.world.spawn();
        a.world.insert(mover, Transform);
        await frames(a, 4);
        expect(a.world.get(area, UIInteraction).hovered).toBe(false);
        const hitTests = countHitTests();

        for (let i = 1; i <= 4; i++) {
            a.world.update(mover, Transform, t => { t.position.x = i * 10; });
            await frames(a, 1);
        }
        expect(hitTests()).toBe(0);

        a.world.update(area, Transform, t => { t.position.x = 0; t.position.y = 0; });
        await frames(a, 1);
        expect(hitTests()).toBeGreaterThan(0);
        expect(a.world.get(area, UIInteraction).hovered).toBe(true);
    });

    it('notices the camera moving what a still pointer points at in the world', async () => {
        const { a } = boot(false);
        const view = (x: number) => new Float32Array([0.02, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, -0.001, 0, -0.02 * x, 0, 0, 1]);
        Object.assign(a.getResource(UICameraInfo), { viewProjection: view(0), vpW: 100, vpH: 100, screenW: 100, screenH: 100, valid: true });
        const area = a.world.spawn();
        a.world.insert(area, Transform, { position: { x: 30, y: 0, z: 0 } });
        a.world.insert(area, ContentRect, { size: { x: 20, y: 20 }, pivot: { x: 0.5, y: 0.5 } });
        a.world.insert(area, Interactable);
        await frames(a, 4);
        expect(a.world.get(area, UIInteraction).hovered).toBe(false);
        const hitTests = countHitTests();
        await frames(a, 3);
        expect(hitTests()).toBe(0);

        a.getResource(UICameraInfo).viewProjection = view(30);
        await frames(a, 1);
        expect(hitTests()).toBeGreaterThan(0);
        expect(a.world.get(area, UIInteraction).hovered).toBe(true);
    });

    it('reads UIInteraction only for what a pointer is over, not for every control', async () => {
        const { a, root } = boot();
        for (let i = 0; i < 50; i++) {
            const e = spawnUIEntity({ world: a.world, parent: root, node: { width: px(1), height: px(1) } });
            a.world.insert(e, Interactable);
        }
        await frames(a, 4);
        const get = vi.spyOn(a.world, 'get');
        await frames(a, 3);
        const reads = get.mock.calls.filter(([, component]) => component === UIInteraction).length;
        expect(reads).toBeLessThanOrEqual(3);
    });
});
