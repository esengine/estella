// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The screen is a domain, and these are the four facts that make it one.
 *
 *   1. A screen subtree is not consumed by any world camera.
 *   2. Render and pick read the SAME projection, not two equal ones.
 *   3. `Transform.worldPosition` is layout STORAGE here — it carries no depth
 *      and no world meaning, so a z left on it cannot reorder anything.
 *   4. Nothing about the screen moves when a camera does.
 *
 * The pixels are gated separately (tools/renderScenes.mjs: ui-screen-3d,
 * ui-screen-3d-camera-moved, ui-screen-root). What is here is everything a
 * frame's pixels cannot show: which entities belong to which domain, and where
 * a pointer lands once the two are told apart.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Canvas, Transform, Sprite } from '../src/ecs/component';
import { UINode, type UINodeData } from '../src/ui/core/ui-node';
import { Interactable } from '../src/ui/input/interactable';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { uiRenderOrderPlugin } from '../src/ui/render/render-order';
import { screenLayoutRect, screenProjection } from '../src/ui/core/screen-layout';
import { defaultScreenOverlay, type ScreenOverlayData } from '../src/ui/core/screen-overlay';
import { screenToUiLayout, uiLayoutToScreen, uiLayoutRay, uiHitTestWorld } from '../src/ui/util/ui-pick';
import { px, auto } from '../src/ui/core/dimension';
import { CanvasScaleMode } from '../src/wasm/wasm.generated';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import { setScreenBox } from './helpers/screenBox';

const FIT = {
    designResolution: { x: 1920, y: 1080 },
    scaleMode: CanvasScaleMode.FixedHeight,
    matchWidthOrHeight: 0.5,
};

/** The screen as it is actually published: a layout box and the projection over it. */
function screenAt(viewportW: number, viewportH: number): ScreenOverlayData {
    const layout = screenLayoutRect(FIT, viewportW, viewportH);
    const overlay = defaultScreenOverlay();
    screenProjection(layout, overlay.projection);
    overlay.active = true;
    overlay.vpX = 0;
    overlay.vpY = 0;
    overlay.vpW = viewportW;
    overlay.vpH = viewportH;
    overlay.surfaceW = viewportW;
    overlay.surfaceH = viewportH;
    return overlay;
}

describe('the screen projection', () => {
    it('puts the layout box exactly on the framebuffer', () => {
        const overlay = screenAt(1280, 720);
        const layout = screenLayoutRect(FIT, 1280, 720);

        // The box's corners are the surface's corners. Nothing is cropped and
        // nothing is padded, because the box IS the screen.
        const bl = uiLayoutToScreen(overlay, layout.left, layout.bottom);
        const tr = uiLayoutToScreen(overlay, layout.right, layout.top);
        expect(bl.x).toBeCloseTo(0, 3);
        expect(bl.y).toBeCloseTo(0, 3);
        expect(tr.x).toBeCloseTo(1280, 3);
        expect(tr.y).toBeCloseTo(720, 3);
        // ...and the origin is the middle, which is what makes a screen root's
        // placement a fact about the screen rather than about a camera.
        const mid = uiLayoutToScreen(overlay, 0, 0);
        expect(mid.x).toBeCloseTo(640, 3);
        expect(mid.y).toBeCloseTo(360, 3);
    });

    it('round-trips a layout point through a pixel and back', () => {
        for (const [w, h] of [[1280, 720], [800, 600], [390, 844]] as const) {
            const overlay = screenAt(w, h);
            const layout = screenLayoutRect(FIT, w, h);
            for (const p of [
                { x: 0, y: 0 },
                { x: layout.left, y: layout.bottom },
                { x: layout.right * 0.5, y: layout.top * 0.25 },
                { x: -123.5, y: 77.25 },
            ]) {
                const pixel = uiLayoutToScreen(overlay, p.x, p.y);
                const back = screenToUiLayout(overlay, pixel.x, pixel.y);
                expect(back.x).toBeCloseTo(p.x, 3);
                expect(back.y).toBeCloseTo(p.y, 3);
            }
        }
    });

    /**
     * Not "the two agree" — "there is only one". The pick reads the very matrix
     * the overlay is handed, so changing it changes both; two derivations drift
     * the moment either gains a case.
     */
    it('is the one matrix the pointer is inverted through', () => {
        const overlay = screenAt(1280, 720);
        const before = screenToUiLayout(overlay, 320, 180);

        // Halve the span the projection covers, in place — as a resize does.
        screenProjection(screenLayoutRect(FIT, 640, 360), overlay.projection);
        overlay.vpW = 640;
        overlay.vpH = 360;
        const after = screenToUiLayout(overlay, 160, 90);

        // Same fraction of the surface, same layout point: the pointer followed
        // the projection because it reads it rather than re-deriving it.
        expect(after.x).toBeCloseTo(before.x, 3);
        expect(after.y).toBeCloseTo(before.y, 3);
    });
});

function node(over: Partial<UINodeData> = {}): UINodeData {
    return {
        position: 0,
        width: auto(), height: auto(),
        minWidth: auto(), minHeight: auto(),
        maxWidth: auto(), maxHeight: auto(),
        flexGrow: 0, flexShrink: 1, flexBasis: auto(),
        alignSelf: 0,
        marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
        insetLeft: auto(), insetTop: auto(), insetRight: auto(), insetBottom: auto(),
        ...over,
    } as UINodeData;
}

/** Absolute, pinned to the box's top-left, at a fixed size. */
function pinned(w: number, h: number): UINodeData {
    return node({
        position: 1,
        insetLeft: px(0), insetTop: px(0),
        width: px(w), height: px(h),
    });
}

function transform(x = 0, y = 0, z = 0) {
    return {
        position: { x, y, z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
    };
}

describe.skipIf(!HAS_WASM)('the screen domain (WASM integration)', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function createApp() {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        setScreenBox(app, -960, -540, 960, 540);
        app.addPlugin(uiLayoutPlugin);
        app.addPlugin(uiRenderOrderPlugin);
        return { app, registry };
    }

    function dispose(app: App, registry: CppRegistry): void {
        for (const e of app.world.getAllEntities()) {
            try { app.world.despawn(e); } catch { /* already gone */ }
        }
        app.world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    const isScreen = (registry: CppRegistry, e: number): boolean =>
        module.ui_isScreenDomain!(registry, e);

    it('is inherited by the whole subtree, whatever each entity carries', async () => {
        const { app, registry } = createApp();
        const world = app.world;

        const canvas = world.spawn();
        world.insert(canvas, Canvas, {});
        world.insert(canvas, UINode, node());
        world.insert(canvas, Transform, transform());

        const panel = world.spawn();
        world.insert(panel, UINode, pinned(200, 100));
        world.insert(panel, Transform, transform());
        world.setParent(panel, canvas);

        // A bare Sprite parented into the HUD: not a layout node, so a set built
        // from the LAYOUT tree would leave exactly this one renderable behind in
        // the world domain, drawn at layout-pixel coordinates.
        const decoration = world.spawn();
        world.insert(decoration, Sprite, {});
        world.insert(decoration, Transform, transform());
        world.setParent(decoration, panel);

        await app.tick(1 / 60);

        expect(isScreen(registry, canvas as number)).toBe(true);
        expect(isScreen(registry, panel as number)).toBe(true);
        expect(isScreen(registry, decoration as number)).toBe(true);

        dispose(app, registry);
    });

    it('stops at a Canvas that hangs off a world entity', async () => {
        const { app, registry } = createApp();
        const world = app.world;

        const anchor = world.spawn();
        world.insert(anchor, Transform, transform(500, 250));

        const worldCanvas = world.spawn();
        world.insert(worldCanvas, Canvas, {});
        world.insert(worldCanvas, UINode, node());
        world.insert(worldCanvas, Transform, transform());
        world.setParent(worldCanvas, anchor);

        const badge = world.spawn();
        world.insert(badge, UINode, pinned(64, 64));
        world.insert(badge, Transform, transform());
        world.setParent(badge, worldCanvas);

        await app.tick(1 / 60);

        // It rides its parent through the world, so it is the world's — a HUD is
        // what has no parent to ride.
        expect(isScreen(registry, worldCanvas as number)).toBe(false);
        expect(isScreen(registry, badge as number)).toBe(false);

        dispose(app, registry);
    });

    it('places a screen root about the origin, in layout pixels', async () => {
        const { app, registry } = createApp();
        const world = app.world;

        const canvas = world.spawn();
        world.insert(canvas, Canvas, {});
        world.insert(canvas, UINode, node());
        world.insert(canvas, Transform, transform(777, -333, 0));

        await app.tick(1 / 60);

        // Whatever the scene authored, the layout pass owns a screen root's
        // placement, and the box it places within is centred on nothing.
        const t = registry.getTransform(canvas as number);
        expect(t.position.x).toBeCloseTo(0, 3);
        expect(t.position.y).toBeCloseTo(0, 3);

        dispose(app, registry);
    });

    /**
     * The half that no pixel shows. A HUD drawn through the overlay and picked
     * through a camera is the failure mode that looks like success, so the ray
     * the pointer becomes has to come from the same place the picture did.
     */
    it('answers a pointer through the overlay, whatever the camera is doing', async () => {
        const { app, registry } = createApp();
        const world = app.world;

        const canvas = world.spawn();
        world.insert(canvas, Canvas, {});
        world.insert(canvas, UINode, node());
        world.insert(canvas, Transform, transform());

        // Top-left quarter of a 1920x1080 design box.
        const button = world.spawn();
        world.insert(button, UINode, pinned(960, 540));
        world.insert(button, Transform, transform());
        world.insert(button, Interactable, {});
        world.setParent(button, canvas);

        await app.tick(1 / 60);

        const overlay = screenAt(1920, 1080);
        const pickable = { getCppRegistry: () => registry, getWasmModule: () => module };

        // A pixel inside the button's quarter of the screen (GL coordinates, so
        // y counts up from the bottom: the top-left quarter is high y).
        const inside = uiLayoutRay(overlay, 480, 810);
        // ...and one in the opposite corner, which nothing covers.
        const outside = uiLayoutRay(overlay, 1440, 270);

        // The world ray is deliberately absurd — a camera a mile away, looking
        // somewhere else. It must change nothing: the button is not in its world.
        const farAway = {
            origin: { x: 40000, y: -9000, z: 500 },
            dir: { x: 0, y: 0, z: -1 },
        };

        expect(uiHitTestWorld(pickable, farAway, inside)).toBe(button);
        expect(uiHitTestWorld(pickable, farAway, outside)).toBe(null);

        // One ray for everything cannot answer it: that ray is in the world and
        // the button is not. Without this the assertions above would pass just as
        // well on a build that ignored the second ray.
        expect(uiHitTestWorld(pickable, farAway)).toBe(null);

        dispose(app, registry);
    });
});
