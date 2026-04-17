import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite, Canvas } from '../src/component';
import type { TransformData } from '../src/component';
import { UIRect } from '../src/ui/core/ui-rect';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { scrollViewPlugin } from '../src/ui/ScrollViewPlugin';
import { uiInteractionPlugin } from '../src/ui/UIInteractionPlugin';
import { ScrollView } from '../src/ui/ScrollView';
import type { ScrollViewData } from '../src/ui/ScrollView';
import { UIInteraction } from '../src/ui/behavior/interactable';
import { Interactable } from '../src/ui/behavior/interactable';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('ScrollView (WASM)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createApp() {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);

        const vp = new Float32Array(16);
        vp[0] = 1 / 400;
        vp[5] = 1 / 300;
        vp[10] = 1;
        vp[15] = 1;
        app.insertResource(UICameraInfo, {
            viewProjection: vp,
            vpX: 0, vpY: 0, vpW: 800, vpH: 600,
            screenW: 800, screenH: 600,
            worldLeft: -400, worldBottom: -300, worldRight: 400, worldTop: 300,
            worldMouseX: 0, worldMouseY: 0,
            valid: true,
        });
        app.insertResource(Input, new InputState());
        app.insertResource(UIEvents, new UIEventQueue());

        app.addPlugin(uiLayoutPlugin);
        app.addPlugin(uiRenderOrderPlugin);
        app.addPlugin(uiInteractionPlugin);
        app.addPlugin(scrollViewPlugin);

        return { app, registry };
    }

    function disposeApp(app: App, registry: CppRegistry): void {
        const world = app.world;
        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as any).delete();
    }

    function createScrollView(app: App, contentHeight: number) {
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const scrollEntity = world.spawn();
        world.setParent(scrollEntity, root);
        world.insert(scrollEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(scrollEntity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 300, y: 200 }, pivot: { x: 0.5, y: 0.5 },
        });

        const contentEntity = world.spawn();
        world.setParent(contentEntity, scrollEntity);
        world.insert(contentEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(contentEntity, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });

        world.insert(scrollEntity, ScrollView, {
            contentEntity,
            horizontalEnabled: false,
            verticalEnabled: true,
            contentWidth: 0,
            contentHeight,
            scrollX: 0,
            scrollY: 0,
            inertia: true,
            decelerationRate: 0.135,
        });

        return { root, scrollEntity, contentEntity };
    }

    it('scrollY clamps between 0 and maxScrollY when elastic=false', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        const sv0 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv0.elastic = false;
        world.insert(scrollEntity, ScrollView, sv0);

        await app.tick(1 / 60);

        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(sv.scrollY).toBe(0);

        sv.scrollY = 500;
        world.insert(scrollEntity, ScrollView, sv);
        await app.tick(1 / 60);

        const svAfter = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(svAfter.scrollY).toBeLessThanOrEqual(400);
        expect(svAfter.scrollY).toBeGreaterThanOrEqual(0);

        disposeApp(app, registry);
    });

    it('contentHeight=0 prevents scrolling when elastic=false', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 0);
        const world = app.world;

        const sv0 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv0.elastic = false;
        world.insert(scrollEntity, ScrollView, sv0);

        await app.tick(1 / 60);

        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv.scrollY = 100;
        world.insert(scrollEntity, ScrollView, sv);
        await app.tick(1 / 60);

        const svAfter = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(svAfter.scrollY).toBe(0);

        disposeApp(app, registry);
    });

    it('content entity position updates with scrollY', async () => {
        const { app, registry } = createApp();
        const { scrollEntity, contentEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv.scrollY = 200;
        world.insert(scrollEntity, ScrollView, sv);
        await app.tick(1 / 60);

        const contentTransform = world.get(contentEntity, Transform) as TransformData;
        expect(contentTransform.position.y).toBe(200);

        disposeApp(app, registry);
    });

    it('wheel scroll down (positive deltaY) should increase scrollY', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        // Tick once to init layout
        await app.tick(1 / 60);

        // Manually set UIInteraction.hovered and inject scroll delta
        // to test scroll direction without full hit test
        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });

        const inputState = app.getResource(Input);
        // Simulate wheel scroll down: browser gives positive deltaY
        inputState.scrollDeltaY = 120;

        await app.tick(1 / 60);

        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        // Scrolling down → scrollY should increase (content moves up, revealing below)
        expect(sv.scrollY).toBeGreaterThan(0);

        disposeApp(app, registry);
    });

    it('rubber-band limits over-scroll during wheel input', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });

        const inputState = app.getResource(Input);

        // Scroll far past top (negative) with many wheel events
        for (let i = 0; i < 100; i++) {
            inputState.scrollDeltaY = -120;
            await app.tick(1 / 60);
        }

        const sv1 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        // viewH=200: rubber-band should limit over-scroll to roughly viewH
        expect(sv1.scrollY).toBeLessThan(0);
        expect(sv1.scrollY).toBeGreaterThan(-200);

        disposeApp(app, registry);
    });

    it('elastic bounces back during continuous small wheel deltas (momentum scroll)', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });

        const inputState = app.getResource(Input);

        // Initial strong scroll past top
        inputState.scrollDeltaY = -200;
        await app.tick(1 / 60);

        const sv1 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(sv1.scrollY).toBeLessThan(0);

        // Simulate OS momentum: decaying small scroll deltas (never exactly 0)
        for (let i = 0; i < 60; i++) {
            inputState.scrollDeltaY = -1;
            await app.tick(1 / 60);
        }

        const svFinal = world.get(scrollEntity, ScrollView) as ScrollViewData;
        // Elastic should have pulled scrollY back toward 0 despite continuous small deltas
        expect(Math.abs(svFinal.scrollY)).toBeLessThan(10);

        disposeApp(app, registry);
    });

    it('elastic bounces back even while hover remains active (no more wheel events)', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });

        const inputState = app.getResource(Input);
        inputState.scrollDeltaY = -120;
        await app.tick(1 / 60);

        const sv1 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(sv1.scrollY).toBeLessThan(0);

        // Stop scrolling but keep hovered=true (cursor still over ScrollView)
        inputState.scrollDeltaY = 0;
        for (let i = 0; i < 60; i++) {
            await app.tick(1 / 60);
        }
        const svFinal = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(Math.abs(svFinal.scrollY)).toBeLessThan(1);

        disposeApp(app, registry);
    });

    it('elastic: over-scroll past top should NOT instantly clamp, then spring back', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        // Set scrollY to negative (over-scrolled past top)
        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv.scrollY = -50;
        world.insert(scrollEntity, ScrollView, sv);

        // After one tick, elastic spring should NOT hard-clamp to 0
        // It should be between -50 and 0 (partially pulled back)
        await app.tick(1 / 60);
        const sv1 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(sv1.scrollY).toBeGreaterThan(-50);
        expect(sv1.scrollY).toBeLessThan(0); // NOT instantly clamped to 0

        // After many ticks, should converge close to 0
        for (let i = 0; i < 120; i++) {
            await app.tick(1 / 60);
        }
        const svFinal = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(Math.abs(svFinal.scrollY)).toBeLessThan(1);

        disposeApp(app, registry);
    });

    it('wheel scroll UP past top should bounce back to 0', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });

        const inputState = app.getResource(Input);
        inputState.scrollDeltaY = -120;

        await app.tick(1 / 60);

        const sv1 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(sv1.scrollY).toBeLessThan(0);

        inputState.scrollDeltaY = 0;

        for (let i = 0; i < 120; i++) {
            world.insert(scrollEntity, UIInteraction, { hovered: false, pressed: false, justPressed: false, justReleased: false });
            await app.tick(1 / 60);
        }
        const svFinal = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(Math.abs(svFinal.scrollY)).toBeLessThan(1);

        disposeApp(app, registry);
    });

    it('wheel scroll DOWN past bottom should bounce back to maxScrollY', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });

        const inputState = app.getResource(Input);
        for (let i = 0; i < 50; i++) {
            inputState.scrollDeltaY = 120;
            await app.tick(1 / 60);
        }

        const svMid = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(svMid.scrollY).toBeGreaterThan(400);

        inputState.scrollDeltaY = 0;
        for (let i = 0; i < 120; i++) {
            world.insert(scrollEntity, UIInteraction, { hovered: false, pressed: false, justPressed: false, justReleased: false });
            await app.tick(1 / 60);
        }
        const svFinal = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(Math.abs(svFinal.scrollY - 400)).toBeLessThan(1);

        disposeApp(app, registry);
    });

    it('elastic: over-scroll past bottom should NOT instantly clamp, then spring back', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        // maxScrollY = 600 - 200 = 400; set past max
        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv.scrollY = 450;
        world.insert(scrollEntity, ScrollView, sv);

        await app.tick(1 / 60);
        const sv1 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(sv1.scrollY).toBeLessThan(450);
        expect(sv1.scrollY).toBeGreaterThan(400); // NOT instantly clamped to 400

        for (let i = 0; i < 120; i++) {
            await app.tick(1 / 60);
        }
        const svFinal = world.get(scrollEntity, ScrollView) as ScrollViewData;
        expect(Math.abs(svFinal.scrollY - 400)).toBeLessThan(1);

        disposeApp(app, registry);
    });

    it('scroll offset should add to UIRect base position, not replace it', async () => {
        const { app, registry } = createApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const scrollEntity = world.spawn();
        world.setParent(scrollEntity, root);
        world.insert(scrollEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(scrollEntity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 300, y: 200 }, pivot: { x: 0.5, y: 0.5 },
        });

        const contentEntity = world.spawn();
        world.setParent(contentEntity, scrollEntity);
        world.insert(contentEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(contentEntity, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0, y: 0 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 300, y: 600 }, pivot: { x: 0, y: 0 },
        });

        // Tick WITHOUT ScrollView to get the UIRect-computed base position
        await app.tick(1 / 60);
        const baseTransform = world.get(contentEntity, Transform) as TransformData;
        const baseY = baseTransform.position.y;
        const baseX = baseTransform.position.x;

        // Now add ScrollView with scrollY=0
        world.insert(scrollEntity, ScrollView, {
            contentEntity,
            horizontalEnabled: false,
            verticalEnabled: true,
            contentWidth: 0,
            contentHeight: 600,
            scrollX: 0,
            scrollY: 0,
            inertia: true,
            decelerationRate: 0.135,
        });

        await app.tick(1 / 60);
        const afterScrollView = world.get(contentEntity, Transform) as TransformData;
        // With scrollY=0, content should remain at its UIRect base position
        expect(afterScrollView.position.y).toBeCloseTo(baseY, 0);
        expect(afterScrollView.position.x).toBeCloseTo(baseX, 0);

        // Now scroll: position should be base + scrollOffset
        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv.scrollY = 100;
        world.insert(scrollEntity, ScrollView, sv);
        await app.tick(1 / 60);
        const scrolledTransform = world.get(contentEntity, Transform) as TransformData;
        expect(scrolledTransform.position.y).toBeCloseTo(baseY + 100, 0);

        disposeApp(app, registry);
    });

    it('sustained large scroll deltas should not push content entirely out of viewport', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });

        const inputState = app.getResource(Input);

        // Simulate sustained trackpad momentum: large deltas across multiple frames
        // maxScrollY = 600 - 200 = 400; viewH = 200
        for (let i = 0; i < 10; i++) {
            inputState.scrollDeltaY = 3000;
            await app.tick(1 / 60);
        }

        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        // maxScrollY=400, viewH=200; over-scroll should be capped to half the viewport
        // so content always remains substantially visible
        expect(sv.scrollY).toBeLessThanOrEqual(400 + 200 * 0.5);
        expect(sv.scrollY).toBeGreaterThanOrEqual(-200 * 0.5);

        disposeApp(app, registry);
    });

    it('content position should not accumulate across frames (no UIRect on content)', async () => {
        const { app, registry } = createApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const scrollEntity = world.spawn();
        world.setParent(scrollEntity, root);
        world.insert(scrollEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(scrollEntity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 300, y: 200 }, pivot: { x: 0.5, y: 0.5 },
        });

        // Content entity WITHOUT UIRect — only Transform
        const contentEntity = world.spawn();
        world.setParent(contentEntity, scrollEntity);
        world.insert(contentEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        world.insert(scrollEntity, ScrollView, {
            contentEntity,
            horizontalEnabled: false,
            verticalEnabled: true,
            contentWidth: 0,
            contentHeight: 600,
            scrollX: 0,
            scrollY: 0,
            inertia: true,
            decelerationRate: 0.135,
            elastic: false,
        });

        // Set scrollY = 100 and tick multiple frames
        const sv0 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv0.scrollY = 100;
        world.insert(scrollEntity, ScrollView, sv0);

        // Tick 3 times with constant scrollY — position should stay the same
        await app.tick(1 / 60);
        const pos1 = (world.get(contentEntity, Transform) as TransformData).position.y;

        await app.tick(1 / 60);
        const pos2 = (world.get(contentEntity, Transform) as TransformData).position.y;

        await app.tick(1 / 60);
        const pos3 = (world.get(contentEntity, Transform) as TransformData).position.y;

        // All 3 frames should produce the same position (no accumulation)
        expect(pos2).toBeCloseTo(pos1, 1);
        expect(pos3).toBeCloseTo(pos1, 1);

        disposeApp(app, registry);
    });

    it('auto contentHeight from children when contentHeight=0', async () => {
        const { app, registry } = createApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const scrollEntity = world.spawn();
        world.setParent(scrollEntity, root);
        world.insert(scrollEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(scrollEntity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 300, y: 200 }, pivot: { x: 0.5, y: 0.5 },
        });

        const contentEntity = world.spawn();
        world.setParent(contentEntity, scrollEntity);
        world.insert(contentEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        // Tick once so layout is established before adding children
        await app.tick(1 / 60);

        // Add 5 child items WITHOUT UIRect (using Sprite for size), manually positioned
        // Children of contentEntity: no UIRect means C++ layout won't override position
        for (let i = 0; i < 5; i++) {
            const child = world.spawn();
            world.setParent(child, contentEntity);
            world.insert(child, Transform, {
                position: { x: 0, y: -i * 100, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 },
            });
            world.insert(child, Sprite, {
                texture: 0, color: { r: 1, g: 1, b: 1, a: 1 },
                size: { x: 300, y: 100 },
                uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
                layer: 0, flipX: false, flipY: false, material: 0,
            });
        }

        // contentHeight=0 → auto-compute from children
        world.insert(scrollEntity, ScrollView, {
            contentEntity,
            horizontalEnabled: false,
            verticalEnabled: true,
            contentWidth: 0,
            contentHeight: 0,
            scrollX: 0,
            scrollY: 0,
            inertia: true,
            decelerationRate: 0.135,
            elastic: false,
        });

        // Set scrollY to large value; clamp should use auto-computed contentHeight
        const sv = world.get(scrollEntity, ScrollView) as ScrollViewData;
        sv.scrollY = 9999;
        world.insert(scrollEntity, ScrollView, sv);
        await app.tick(1 / 60);

        const svAfter = world.get(scrollEntity, ScrollView) as ScrollViewData;
        // Children span from y=50 (top of first) to y=-450 (bottom of last, pivot center)
        // total height = 500; viewH = 200; maxScroll = 300
        expect(svAfter.scrollY).toBeGreaterThan(0);
        expect(svAfter.scrollY).toBeLessThanOrEqual(350);

        disposeApp(app, registry);
    });

    it('drag should produce 1:1 movement between mouse delta and content displacement', async () => {
        const { app, registry } = createApp();
        const { scrollEntity, contentEntity } = createScrollView(app, 600);
        const world = app.world;

        await app.tick(1 / 60);

        const inputState = app.getResource(Input);
        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });

        const initialPos = (world.get(contentEntity, Transform) as TransformData).position.y;
        const cam = app.getResource(UICameraInfo);

        // Frame 1: Press at mouseY=300 → worldMouseY = 300-300 = 0
        inputState.mouseX = 400;
        inputState.mouseY = 300;
        inputState.mouseButtons.add(0);
        inputState.mouseButtonsPressed.add(0);
        world.insert(scrollEntity, UIInteraction, {
            hovered: true, pressed: true, justPressed: true, justReleased: false,
        });
        await app.tick(1 / 60);

        const posAfterPress = (world.get(contentEntity, Transform) as TransformData).position.y;
        console.log('=== Drag tracking ===');
        console.log(`initialPos=${initialPos}, posAfterPress=${posAfterPress}, worldMouseY=${cam.worldMouseY}`);
        expect(posAfterPress).toBeCloseTo(initialPos, 0);

        // Frame 2: Drag up 50px → mouseY=250 → worldMouseY=50
        inputState.mouseButtonsPressed.clear();
        inputState.mouseY = 250;
        world.insert(scrollEntity, UIInteraction, {
            hovered: true, pressed: true, justPressed: false, justReleased: false,
        });
        await app.tick(1 / 60);

        const posAfterDrag50 = (world.get(contentEntity, Transform) as TransformData).position.y;
        const svDrag50 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        console.log(`After 50px drag: worldMouseY=${cam.worldMouseY}, scrollY=${svDrag50.scrollY}, contentY=${posAfterDrag50}`);
        // 50px mouse movement → 50 units of scroll → 50 units of content movement
        expect(svDrag50.scrollY).toBeCloseTo(50, 0);
        expect(posAfterDrag50 - initialPos).toBeCloseTo(50, 0);

        // Frame 3: Drag up another 30px → mouseY=220 → worldMouseY=80
        inputState.mouseY = 220;
        world.insert(scrollEntity, UIInteraction, {
            hovered: true, pressed: true, justPressed: false, justReleased: false,
        });
        await app.tick(1 / 60);

        const posAfterDrag80 = (world.get(contentEntity, Transform) as TransformData).position.y;
        const svDrag80 = world.get(scrollEntity, ScrollView) as ScrollViewData;
        console.log(`After 80px total: scrollY=${svDrag80.scrollY}, contentY=${posAfterDrag80}, delta from initial=${posAfterDrag80 - initialPos}`);
        expect(svDrag80.scrollY).toBeCloseTo(80, 0);
        expect(posAfterDrag80 - initialPos).toBeCloseTo(80, 0);

        // Frame 4: Mouse stops (same position), still held
        world.insert(scrollEntity, UIInteraction, {
            hovered: true, pressed: true, justPressed: false, justReleased: false,
        });
        await app.tick(1 / 60);

        const posAfterStop = (world.get(contentEntity, Transform) as TransformData).position.y;
        console.log(`After stop: contentY=${posAfterStop}, drift=${posAfterStop - posAfterDrag80}`);
        expect(posAfterStop).toBeCloseTo(posAfterDrag80, 1);

        // Frame 5: Release
        inputState.mouseButtons.delete(0);
        inputState.mouseButtonsReleased.add(0);
        world.insert(scrollEntity, UIInteraction, {
            hovered: true, pressed: false, justPressed: false, justReleased: true,
        });
        await app.tick(1 / 60);

        // Frame 6-7: After release with velocity=0, content should stay
        inputState.mouseButtonsReleased.clear();
        for (let i = 0; i < 5; i++) {
            world.insert(scrollEntity, UIInteraction, {
                hovered: false, pressed: false, justPressed: false, justReleased: false,
            });
            await app.tick(1 / 60);
        }

        const posAfterRelease = (world.get(contentEntity, Transform) as TransformData).position.y;
        console.log(`After release+5 frames: contentY=${posAfterRelease}, drift from stop=${posAfterRelease - posAfterStop}`);
        expect(posAfterRelease).toBeCloseTo(posAfterDrag80, 1);

        disposeApp(app, registry);
    });

    it('inertia after fast swipe should not exceed a few viewports of travel', async () => {
        const { app, registry } = createApp();
        const { scrollEntity } = createScrollView(app, 5000);
        const world = app.world;

        await app.tick(1 / 60);

        world.insert(scrollEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });

        const inputState = app.getResource(Input);

        // worldMouseY = 300 - mouseY for this ortho setup
        // Frame 1: justPressed, worldMouseY=0 → mouseY=300
        inputState.mouseX = 400;
        inputState.mouseY = 300;
        inputState.mouseButtons.add(0);
        inputState.mouseButtonsPressed.add(0);
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: true, justPressed: true, justReleased: false });
        await app.tick(1 / 60);

        // Frames 2-6: fast upward drag, worldMouseY increases by 100/frame
        // worldMouseY = i*100 → mouseY = 300 - i*100
        inputState.mouseButtonsPressed.clear();
        for (let i = 1; i <= 5; i++) {
            inputState.mouseY = 300 - i * 100;
            world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: true, justPressed: false, justReleased: false });
            await app.tick(1 / 60);
        }

        // Release
        inputState.mouseButtons.delete(0);
        inputState.mouseButtonsReleased.add(0);
        world.insert(scrollEntity, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: true });
        await app.tick(1 / 60);

        const svAtRelease = world.get(scrollEntity, ScrollView) as ScrollViewData;
        const scrollAtRelease = svAtRelease.scrollY;

        // Let inertia run for 120 frames (2 seconds)
        inputState.mouseButtonsReleased.clear();
        for (let i = 0; i < 120; i++) {
            world.insert(scrollEntity, UIInteraction, { hovered: false, pressed: false, justPressed: false, justReleased: false });
            await app.tick(1 / 60);
        }

        const svAfter = world.get(scrollEntity, ScrollView) as ScrollViewData;
        const inertiaTravel = Math.abs(svAfter.scrollY - scrollAtRelease);

        // viewH=200; inertia travel should be bounded to ~3x viewport at most
        expect(inertiaTravel).toBeLessThan(200 * 3);

        disposeApp(app, registry);
    });
});
