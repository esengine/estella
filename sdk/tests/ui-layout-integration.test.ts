// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-layout-integration.test.ts
 * @brief   Integration tests: App.tick() drives the single-pass UINode Yoga
 *          layout via the real WASM module.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app';
import { UINode, type UINodeData } from '../src/ui/core/ui-node';
import { Canvas } from '../src/component';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { uiRenderOrderPlugin } from '../src/ui/render/render-order';
import { Transform, Sprite } from '../src/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

// ── Dimension literals (unit 0 = Px, 1 = Percent, 2 = Auto) ─────────────────
const px = (v: number) => ({ value: v, unit: 0 });
const pct = (v: number) => ({ value: v, unit: 1 });
const auto = () => ({ value: 0, unit: 2 });

/** A complete UINode value-object (embind requires every member present). */
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

/** Stretch to fill the parent box (Absolute + inset 0 on all edges). */
function fillNode(): UINodeData {
    return node({ position: 1, insetLeft: px(0), insetTop: px(0), insetRight: px(0), insetBottom: px(0) });
}

/** Fixed-size in-flow box. */
function sizedNode(w: number, h: number): UINodeData {
    return node({ width: px(w), height: px(h) });
}

/** Fill the parent inset by `n` px on every edge (Absolute). */
function insetNode(n: number): UINodeData {
    return node({ position: 1, insetLeft: px(n), insetTop: px(n), insetRight: px(n), insetBottom: px(n) });
}

function makeTransform(x = 0, y = 0) {
    return {
        position: { x, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
    };
}

function makeSprite(w = 100, h = 100) {
    return {
        texture: 0,
        color: { r: 1, g: 1, b: 1, a: 1 },
        size: { x: w, y: h },
        uvOffset: { x: 0, y: 0 },
        uvScale: { x: 1, y: 1 },
        layer: 0,
        flipX: false,
        flipY: false,
    };
}

describe.skipIf(!HAS_WASM)('UI Layout via App.tick() (WASM integration)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createEditorApp(): { app: App; registry: CppRegistry } {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);

        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0,
            screenW: 0, screenH: 0,
            worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0,
            worldMouseX: 0, worldMouseY: 0,
            valid: false,
        });

        app.addPlugin(uiLayoutPlugin);
        app.addPlugin(uiRenderOrderPlugin);
        return { app, registry };
    }

    function disposeApp(app: App, registry: CppRegistry): void {
        const world = app.world;
        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    function setCanvasRect(app: App, left: number, bottom: number, right: number, top: number): void {
        const cam = app.getResource(UICameraInfo);
        cam.worldLeft = left;
        cam.worldBottom = bottom;
        cam.worldRight = right;
        cam.worldTop = top;
        cam.valid = true;
    }

    const nodeW = (registry: CppRegistry, e: number) => module.getUINodeComputedWidth!(registry, e);
    const nodeH = (registry: CppRegistry, e: number) => module.getUINodeComputedHeight!(registry, e);

    it('should call uiLayout_update via tick without error', async () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, fillNode());
        world.insert(root, Transform, makeTransform());

        setCanvasRect(app, -400, -300, 400, 300);

        await expect(async () => await app.tick(1 / 60)).not.toThrow();

        disposeApp(app, registry);
    });

    it('should compute layout for child UINode entities', async () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, fillNode());
        world.insert(root, Transform, makeTransform());

        const child = world.spawn();
        world.setParent(child, root);
        world.insert(child, UINode, insetNode(10));
        world.insert(child, Transform, makeTransform());
        world.insert(child, Sprite, makeSprite());

        setCanvasRect(app, -400, -300, 400, 300);

        await app.tick(1 / 60);

        expect(nodeW(registry, child)).toBeCloseTo(780, 0);
        expect(nodeH(registry, child)).toBeCloseTo(580, 0);

        disposeApp(app, registry);
    });

    it('should update render order after tick', async () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, fillNode());
        world.insert(root, Transform, makeTransform());
        world.insert(root, Sprite, makeSprite(800, 600));

        const child = world.spawn();
        world.setParent(child, root);
        world.insert(child, UINode, sizedNode(100, 100));
        world.insert(child, Transform, makeTransform());
        world.insert(child, Sprite, makeSprite());

        setCanvasRect(app, -400, -300, 400, 300);

        await app.tick(1 / 60);

        const rootSprite = registry.getSprite(root);
        const childSprite = registry.getSprite(child);
        expect(childSprite.layer).toBeGreaterThan(rootSprite.layer);

        disposeApp(app, registry);
    });

    it('should handle 50%-width fill for slider-like entities', async () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, fillNode());
        world.insert(root, Transform, makeTransform());

        const background = world.spawn();
        world.setParent(background, root);
        world.insert(background, UINode, fillNode());
        world.insert(background, Transform, makeTransform());
        world.insert(background, Sprite, makeSprite(200, 30));

        const fill = world.spawn();
        world.setParent(fill, background);
        world.insert(fill, UINode, node({
            position: 1,
            insetLeft: px(0), insetTop: px(0),
            width: pct(50), height: pct(100),
        }));
        world.insert(fill, Transform, makeTransform());
        world.insert(fill, Sprite, makeSprite(100, 30));

        setCanvasRect(app, -400, -300, 400, 300);

        await app.tick(1 / 60);

        const fillW = nodeW(registry, fill);
        const fillH = nodeH(registry, fill);
        const bgW = nodeW(registry, background);

        expect(fillW).toBeGreaterThan(0);
        expect(fillH).toBeGreaterThan(0);
        expect(fillW).toBeCloseTo(bgW * 0.5, 0);

        disposeApp(app, registry);
    });

    it('should handle multiple tick calls without error', async () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, fillNode());
        world.insert(root, Transform, makeTransform());

        setCanvasRect(app, -400, -300, 400, 300);

        for (let i = 0; i < 60; i++) {
            await expect(async () => await app.tick(1 / 60)).not.toThrow();
        }

        disposeApp(app, registry);
    });

    it('should skip layout when UICameraInfo.valid is false', async () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, fillNode());
        world.insert(root, Transform, makeTransform());

        const cam = app.getResource(UICameraInfo);
        cam.valid = false;

        await expect(async () => await app.tick(1 / 60)).not.toThrow();

        expect(nodeW(registry, root)).toBe(0);

        disposeApp(app, registry);
    });

    it('Canvas without UINode: layout should not overwrite Transform positions', async () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        // Root is a Canvas but has no UINode → it is not a layout root, so its
        // subtree is never laid out and the child Transform is left untouched.
        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, Transform, makeTransform());

        const child = world.spawn();
        world.setParent(child, root);
        world.insert(child, UINode, sizedNode(200, 100));
        world.insert(child, Transform, makeTransform(50, 75));
        world.insert(child, Sprite, makeSprite());

        setCanvasRect(app, -400, -300, 400, 300);
        await app.tick(1 / 60);

        const t = registry.getTransform(child);
        expect(t.position.x).toBeCloseTo(50, 1);
        expect(t.position.y).toBeCloseTo(75, 1);

        disposeApp(app, registry);
    });
});
