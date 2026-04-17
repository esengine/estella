/**
 * Integration tests: UI components (UIRect, UIMask, FlexContainer, FlexItem,
 * Interactable, UIInteraction, Canvas) via real WASM module.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { World } from '../src/world';
import { Transform, Sprite, Canvas } from '../src/component';
import { UIRect } from '../src/ui/core/ui-rect';
import { UIMask, MaskMode } from '../src/ui/core/ui-mask';
import { FlexContainer, FlexDirection, JustifyContent, AlignItems } from '../src/ui/layout/flex';
import { FlexItem } from '../src/ui/layout/flex';
import { Interactable } from '../src/ui/behavior/interactable';
import { UIInteraction } from '../src/ui/behavior/interactable';
import { UICameraInfo, type UICameraData } from '../src/ui/UICameraInfo';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

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
        (registry as any).delete();
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

    function makeFullRect() {
        return {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 },
            pivot: { x: 0.5, y: 0.5 },
        };
    }

    function makeCenterRect(w: number, h: number) {
        return {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: w, y: h },
            pivot: { x: 0.5, y: 0.5 },
        };
    }

    describe('UIRect CRUD', () => {
        it('should insert and read UIRect via CppRegistry', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UIRect, makeCenterRect(200, 100));

            expect(registry.hasUIRect(entity)).toBe(true);

            const rect = registry.getUIRect(entity);
            expect(rect.size.x).toBeCloseTo(200);
            expect(rect.size.y).toBeCloseTo(100);
            expect(rect.pivot.x).toBeCloseTo(0.5);
            expect(rect.pivot.y).toBeCloseTo(0.5);

            disposeApp(app, registry);
        });

        it('should remove UIRect', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, UIRect, makeFullRect());
            expect(registry.hasUIRect(entity)).toBe(true);

            world.remove(entity, UIRect);
            expect(registry.hasUIRect(entity)).toBe(false);

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

    describe('FlexContainer and FlexItem', () => {
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

        it('should insert FlexItem with defaults', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, FlexItem);

            expect(registry.hasFlexItem(entity)).toBe(true);
            const fi = registry.getFlexItem(entity);
            expect(fi.flexGrow).toBeCloseTo(0);
            expect(fi.flexShrink).toBeCloseTo(1);
            expect(fi.order).toBe(0);

            disposeApp(app, registry);
        });

        it('should insert FlexItem with custom grow/shrink', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, FlexItem, {
                flexGrow: 2,
                flexShrink: 0,
                flexBasis: 100,
                order: 3,
            });

            const fi = registry.getFlexItem(entity);
            expect(fi.flexGrow).toBeCloseTo(2);
            expect(fi.flexShrink).toBeCloseTo(0);
            expect(fi.flexBasis).toBeCloseTo(100);
            expect(fi.order).toBe(3);

            disposeApp(app, registry);
        });

        it('should remove FlexContainer and FlexItem', () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const entity = world.spawn();
            world.insert(entity, FlexContainer);
            world.insert(entity, FlexItem);

            world.remove(entity, FlexContainer);
            world.remove(entity, FlexItem);

            expect(registry.hasFlexContainer(entity)).toBe(false);
            expect(registry.hasFlexItem(entity)).toBe(false);

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
        it('should compute layout for 3-level nested UIRect', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const mid = world.spawn();
            world.setParent(mid, root);
            world.insert(mid, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 1, y: 1 },
                offsetMin: { x: 20, y: 20 },
                offsetMax: { x: -20, y: -20 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(mid, Transform, makeTransform());

            const leaf = world.spawn();
            world.setParent(leaf, mid);
            world.insert(leaf, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 1, y: 1 },
                offsetMin: { x: 10, y: 10 },
                offsetMax: { x: -10, y: -10 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(leaf, Transform, makeTransform());
            world.insert(leaf, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const rootW = module.getUIRectComputedWidth(registry, root);
            const rootH = module.getUIRectComputedHeight(registry, root);
            expect(rootW).toBeCloseTo(800, 0);
            expect(rootH).toBeCloseTo(600, 0);

            const midW = module.getUIRectComputedWidth(registry, mid);
            const midH = module.getUIRectComputedHeight(registry, mid);
            expect(midW).toBeCloseTo(760, 0);
            expect(midH).toBeCloseTo(560, 0);

            const leafW = module.getUIRectComputedWidth(registry, leaf);
            const leafH = module.getUIRectComputedHeight(registry, leaf);
            expect(leafW).toBeCloseTo(740, 0);
            expect(leafH).toBeCloseTo(540, 0);

            disposeApp(app, registry);
        });

        it('should compute fixed-size centered child correctly', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UIRect, makeCenterRect(200, 150));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const w = module.getUIRectComputedWidth(registry, child);
            const h = module.getUIRectComputedHeight(registry, child);
            expect(w).toBeCloseTo(200, 0);
            expect(h).toBeCloseTo(150, 0);

            disposeApp(app, registry);
        });
    });

    describe('render order with multiple roots', () => {
        it('should assign render order across sibling entities', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());
            world.insert(root, Sprite, makeSprite());

            const children: number[] = [];
            for (let i = 0; i < 5; i++) {
                const child = world.spawn();
                world.setParent(child, root);
                world.insert(child, UIRect, makeCenterRect(50, 50));
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
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());
            world.insert(root, Sprite, makeSprite());

            const mid = world.spawn();
            world.setParent(mid, root);
            world.insert(mid, UIRect, makeFullRect());
            world.insert(mid, Transform, makeTransform());
            world.insert(mid, Sprite, makeSprite());

            const leaf = world.spawn();
            world.setParent(leaf, mid);
            world.insert(leaf, UIRect, makeCenterRect(50, 50));
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

    describe('anchor-based layout variations', () => {
        it('should compute left-anchored child (25% width)', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 0.25, y: 1 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const w = module.getUIRectComputedWidth(registry, child);
            const h = module.getUIRectComputedHeight(registry, child);
            expect(w).toBeCloseTo(200, 0);
            expect(h).toBeCloseTo(600, 0);

            disposeApp(app, registry);
        });

        it('should compute bottom-anchored child (50% height)', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 1, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const w = module.getUIRectComputedWidth(registry, child);
            const h = module.getUIRectComputedHeight(registry, child);
            expect(w).toBeCloseTo(800, 0);
            expect(h).toBeCloseTo(300, 0);

            disposeApp(app, registry);
        });

        it('should compute offset from edges', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 1, y: 1 },
                offsetMin: { x: 50, y: 50 },
                offsetMax: { x: -50, y: -50 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const w = module.getUIRectComputedWidth(registry, child);
            const h = module.getUIRectComputedHeight(registry, child);
            expect(w).toBeCloseTo(700, 0);
            expect(h).toBeCloseTo(500, 0);

            disposeApp(app, registry);
        });
    });

    describe('dynamic layout changes', () => {
        it('should update layout when anchors change between ticks', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 0.5, y: 1 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(module.getUIRectComputedWidth(registry, child)).toBeCloseTo(400, 0);

            const rect = registry.getUIRect(child);
            rect.anchorMax.x = 1;
            registry.addUIRect(child, rect);

            await app.tick(1 / 60);

            expect(module.getUIRectComputedWidth(registry, child)).toBeCloseTo(800, 0);

            disposeApp(app, registry);
        });

        it('should handle adding new child between ticks', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const child = world.spawn();
            world.setParent(child, root);
            world.insert(child, UIRect, makeCenterRect(300, 200));
            world.insert(child, Transform, makeTransform());
            world.insert(child, Sprite, makeSprite());

            await app.tick(1 / 60);

            const w = module.getUIRectComputedWidth(registry, child);
            const h = module.getUIRectComputedHeight(registry, child);
            expect(w).toBeCloseTo(300, 0);
            expect(h).toBeCloseTo(200, 0);

            disposeApp(app, registry);
        });

        it('should handle changing canvas rect between ticks', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());
            world.insert(root, Sprite, makeSprite());

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            expect(module.getUIRectComputedWidth(registry, root)).toBeCloseTo(800, 0);
            expect(module.getUIRectComputedHeight(registry, root)).toBeCloseTo(600, 0);

            setCanvasRect(app, -500, -400, 500, 400);
            await app.tick(1 / 60);

            expect(module.getUIRectComputedWidth(registry, root)).toBeCloseTo(1000, 0);
            expect(module.getUIRectComputedHeight(registry, root)).toBeCloseTo(800, 0);

            disposeApp(app, registry);
        });
    });
});
