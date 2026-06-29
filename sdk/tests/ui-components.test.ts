// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-components.test.ts
 * @brief   Integration tests for the UI components (UINode, UIMask,
 *          FlexContainer, Interactable, UIInteraction, Canvas) over
 *          the real WASM module — CRUD plus the single-pass Yoga layout.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app';
import { Transform, Sprite, Canvas } from '../src/component';
import { UINode, type UINodeData } from '../src/ui/core/ui-node';
import { UIMask, MaskMode } from '../src/ui/core/ui-mask';
import { FlexContainer, FlexDirection, JustifyContent, AlignItems } from '../src/ui/layout/flex';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { uiRenderOrderPlugin } from '../src/ui/render/render-order';
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

describe.skipIf(!HAS_WASM)('UI Components (WASM integration)', () => {
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

    function makeTransform() {
        return {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        };
    }

    function makeSprite(layer = 0) {
        return {
            texture: 0,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 100, y: 100 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer,
            flipX: false,
            flipY: false,
        };
    }

    const nodeW = (registry: CppRegistry, e: number) => module.getUINodeComputedWidth!(registry, e);
    const nodeH = (registry: CppRegistry, e: number) => module.getUINodeComputedHeight!(registry, e);

    describe('UINode CRUD', () => {
        it('should insert and read UINode via CppRegistry', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UINode, sizedNode(200, 100));

            expect(registry.hasUINode(entity)).toBe(true);

            const n = registry.getUINode(entity);
            expect(n.width.value).toBeCloseTo(200);
            expect(n.width.unit).toBe(0);
            expect(n.height.value).toBeCloseTo(100);

            disposeApp(app, registry);
        });

        it('should remove UINode', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UINode, fillNode());
            expect(registry.hasUINode(entity)).toBe(true);

            world.remove(entity, UINode);
            expect(registry.hasUINode(entity)).toBe(false);

            disposeApp(app, registry);
        });
    });

    describe('UIMask', () => {
        it('should insert UIMask with Scissor mode', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Scissor });

            expect(registry.hasUIMask(entity)).toBe(true);
            const mask = registry.getUIMask(entity);
            expect(mask.enabled).toBe(true);
            expect(mask.mode).toBe(MaskMode.Scissor);

            disposeApp(app, registry);
        });

        it('should insert UIMask with Stencil mode', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Stencil });

            const mask = registry.getUIMask(entity);
            expect(mask.mode).toBe(MaskMode.Stencil);

            disposeApp(app, registry);
        });

        it('should remove UIMask', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Scissor });
            world.remove(entity, UIMask);

            expect(registry.hasUIMask(entity)).toBe(false);

            disposeApp(app, registry);
        });
    });

    describe('FlexContainer', () => {
        it('should insert FlexContainer with default values', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, FlexContainer);

            expect(registry.hasFlexContainer(entity)).toBe(true);
            const fc = registry.getFlexContainer(entity);
            expect(fc.direction).toBe(FlexDirection.Row);
            expect(fc.justifyContent).toBe(JustifyContent.Start);
            expect(fc.alignItems).toBe(AlignItems.Stretch);

            disposeApp(app, registry);
        });

        it('should insert FlexContainer with custom values', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, FlexContainer, {
                direction: FlexDirection.Column,
                justifyContent: JustifyContent.Center,
                alignItems: AlignItems.Center,
                gap: { x: 10, y: 5 },
                padding: { left: 8, top: 8, right: 8, bottom: 8 },
            });

            const fc = registry.getFlexContainer(entity);
            expect(fc.direction).toBe(FlexDirection.Column);
            expect(fc.justifyContent).toBe(JustifyContent.Center);
            expect(fc.alignItems).toBe(AlignItems.Center);
            expect(fc.gap.x).toBeCloseTo(10);
            expect(fc.gap.y).toBeCloseTo(5);

            disposeApp(app, registry);
        });

        it('should remove FlexContainer', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, FlexContainer);

            world.remove(entity, FlexContainer);

            expect(registry.hasFlexContainer(entity)).toBe(false);

            disposeApp(app, registry);
        });
    });

    describe('Interactable and UIInteraction', () => {
        it('should insert Interactable with defaults', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, Interactable);

            expect(registry.hasInteractable(entity)).toBe(true);
            const inter = registry.getInteractable(entity);
            expect(inter.enabled).toBe(true);
            expect(inter.blockRaycast).toBe(true);
            expect(inter.raycastTarget).toBe(true);

            disposeApp(app, registry);
        });

        it('should insert disabled Interactable', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, Interactable, {
                enabled: false,
                blockRaycast: false,
                raycastTarget: false,
            });

            const inter = registry.getInteractable(entity);
            expect(inter.enabled).toBe(false);
            expect(inter.blockRaycast).toBe(false);
            expect(inter.raycastTarget).toBe(false);

            disposeApp(app, registry);
        });

        it('should insert UIInteraction with defaults', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UIInteraction);

            expect(registry.hasUIInteraction(entity)).toBe(true);
            const ui = registry.getUIInteraction(entity);
            expect(ui.hovered).toBe(false);
            expect(ui.pressed).toBe(false);
            expect(ui.justPressed).toBe(false);
            expect(ui.justReleased).toBe(false);

            disposeApp(app, registry);
        });
    });

    describe('Canvas', () => {
        it('should insert and check Canvas tag', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, Canvas, {});

            expect(registry.hasCanvas(entity)).toBe(true);

            disposeApp(app, registry);
        });

        it('should remove Canvas', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, Canvas, {});
            world.remove(entity, Canvas);

            expect(registry.hasCanvas(entity)).toBe(false);

            disposeApp(app, registry);
        });
    });

    describe('UI layout with deep hierarchy', () => {
        it('should compute layout for 3-level nested UINode', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());

            const mid = world.spawn();
            world.setParent(mid, root);
            world.insert(mid, UINode, insetNode(20));
            world.insert(mid, Transform, makeTransform());

            const leaf = world.spawn();
            world.setParent(leaf, mid);
            world.insert(leaf, UINode, insetNode(10));
            world.insert(leaf, Transform, makeTransform());
            world.insert(leaf, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(nodeW(registry, root)).toBeCloseTo(800, 0);
            expect(nodeH(registry, root)).toBeCloseTo(600, 0);

            expect(nodeW(registry, mid)).toBeCloseTo(760, 0);
            expect(nodeH(registry, mid)).toBeCloseTo(560, 0);

            expect(nodeW(registry, leaf)).toBeCloseTo(740, 0);
            expect(nodeH(registry, leaf)).toBeCloseTo(540, 0);

            disposeApp(app, registry);
        });

        it('should compute fixed-size child correctly', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UINode, sizedNode(200, 150));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(nodeW(registry, child)).toBeCloseTo(200, 0);
            expect(nodeH(registry, child)).toBeCloseTo(150, 0);

            disposeApp(app, registry);
        });
    });

    describe('render order with multiple roots', () => {
        it('should assign render order across sibling entities', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());
            world.insert(root, Sprite, makeSprite());

            const children: number[] = [];
            for (let i = 0; i < 5; i++) {
                const child = world.spawn();
                world.setParent(child, root);
                world.insert(child, UINode, sizedNode(50, 50));
                world.insert(child, Transform, makeTransform());
                world.insert(child, Sprite, makeSprite());
                children.push(child);
            }

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const rootLayer = registry.getSprite(root).layer;
            for (const child of children) {
                const childLayer = registry.getSprite(child).layer;
                expect(childLayer).toBeGreaterThan(rootLayer);
            }

            disposeApp(app, registry);
        });

        it('should maintain correct order: parent < child < grandchild', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());
            world.insert(root, Sprite, makeSprite());

            const mid = world.spawn();
            world.setParent(mid, root);
            world.insert(mid, UINode, fillNode());
            world.insert(mid, Transform, makeTransform());
            world.insert(mid, Sprite, makeSprite());

            const leaf = world.spawn();
            world.setParent(leaf, mid);
            world.insert(leaf, UINode, sizedNode(50, 50));
            world.insert(leaf, Transform, makeTransform());
            world.insert(leaf, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const rootLayer = registry.getSprite(root).layer;
            const midLayer = registry.getSprite(mid).layer;
            const leafLayer = registry.getSprite(leaf).layer;

            expect(midLayer).toBeGreaterThan(rootLayer);
            expect(leafLayer).toBeGreaterThan(midLayer);

            disposeApp(app, registry);
        });
    });

    describe('percent / inset sizing variations', () => {
        it('should compute left child at 25% width, full height', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UINode, node({
                position: 1,
                insetLeft: px(0), insetTop: px(0),
                width: pct(25), height: pct(100),
            }));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(nodeW(registry, child)).toBeCloseTo(200, 0);
            expect(nodeH(registry, child)).toBeCloseTo(600, 0);

            disposeApp(app, registry);
        });

        it('should compute bottom child at full width, 50% height', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UINode, node({
                position: 1,
                insetLeft: px(0), insetBottom: px(0),
                width: pct(100), height: pct(50),
            }));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(nodeW(registry, child)).toBeCloseTo(800, 0);
            expect(nodeH(registry, child)).toBeCloseTo(300, 0);

            disposeApp(app, registry);
        });

        it('should compute fill inset by 50px on every edge', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UINode, insetNode(50));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(nodeW(registry, child)).toBeCloseTo(700, 0);
            expect(nodeH(registry, child)).toBeCloseTo(500, 0);

            disposeApp(app, registry);
        });
    });

    describe('dynamic layout changes', () => {
        it('should update layout when sizing changes between ticks', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UINode, node({
                position: 1,
                insetLeft: px(0), insetTop: px(0),
                width: pct(50), height: pct(100),
            }));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(nodeW(registry, child)).toBeCloseTo(400, 0);

            const n = registry.getUINode(child);
            n.width = pct(100);
            registry.addUINode(child, n);

            await app.tick(1 / 60);

            expect(nodeW(registry, child)).toBeCloseTo(800, 0);

            disposeApp(app, registry);
        });

        it('should handle adding new child between ticks', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UINode, sizedNode(300, 200));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            await app.tick(1 / 60);

            expect(nodeW(registry, child)).toBeCloseTo(300, 0);
            expect(nodeH(registry, child)).toBeCloseTo(200, 0);

            disposeApp(app, registry);
        });

        it('should handle changing canvas rect between ticks', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, fillNode());
            world.insert(root, Transform, makeTransform());
            world.insert(root, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(nodeW(registry, root)).toBeCloseTo(800, 0);
            expect(nodeH(registry, root)).toBeCloseTo(600, 0);

            setCanvasRect(app, -500, -400, 500, 400);
            await app.tick(1 / 60);

            expect(nodeW(registry, root)).toBeCloseTo(1000, 0);
            expect(nodeH(registry, root)).toBeCloseTo(800, 0);

            disposeApp(app, registry);
        });
    });
});
