/**
 * Integration tests: App.tick() drives UI layout via real WASM module.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { World } from '../src/world';
import { UIRect, type UIRectData } from '../src/ui/UIRect';
import { Canvas } from '../src/component';
import { UICameraInfo, type UICameraData } from '../src/ui/UICameraInfo';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { Transform, Sprite } from '../src/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

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

    it('should call uiLayout_update via tick without error', () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        setCanvasRect(app, -400, -300, 400, 300);

        expect(() => app.tick(1 / 60)).not.toThrow();

        disposeApp(app, registry);
    });

    it('should compute layout for child UIRect entities', () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const child = world.spawn();
        world.setParent(child, root);
        world.insert(child, UIRect, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 10, y: 10 },
            offsetMax: { x: -10, y: -10 },
            size: { x: 0, y: 0 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(child, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(child, Sprite, {
            texture: 0,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 100, y: 100 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0,
            flipX: false,
            flipY: false,
        });

        setCanvasRect(app, -400, -300, 400, 300);

        app.tick(1 / 60);

        const computedW = module.getUIRectComputedWidth(registry, child);
        const computedH = module.getUIRectComputedHeight(registry, child);
        expect(computedW).toBeCloseTo(780, 0);
        expect(computedH).toBeCloseTo(580, 0);

        disposeApp(app, registry);
    });

    it('should update render order after tick', () => {
        const { app, registry } = createEditorApp();
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
        world.insert(root, Sprite, {
            texture: 0, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 800, y: 600 },
            uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
            layer: 0, flipX: false, flipY: false,
        });

        const child = world.spawn();
        world.setParent(child, root);
        world.insert(child, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 100, y: 100 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(child, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(child, Sprite, {
            texture: 0, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 100, y: 100 },
            uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
            layer: 0, flipX: false, flipY: false,
        });

        setCanvasRect(app, -400, -300, 400, 300);

        app.tick(1 / 60);

        const rootSprite = registry.getSprite(root);
        const childSprite = registry.getSprite(child);
        expect(childSprite.layer).toBeGreaterThan(rootSprite.layer);

        disposeApp(app, registry);
    });

    it('should handle fill anchors for slider-like entities', () => {
        const { app, registry } = createEditorApp();
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

        const background = world.spawn();
        world.setParent(background, root);
        world.insert(background, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(background, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(background, Sprite, {
            texture: 0, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
            size: { x: 200, y: 30 },
            uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
            layer: 0, flipX: false, flipY: false,
        });

        const fill = world.spawn();
        world.setParent(fill, background);
        world.insert(fill, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0.5, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(fill, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(fill, Sprite, {
            texture: 0, color: { r: 0, g: 0.8, b: 0, a: 1 },
            size: { x: 100, y: 30 },
            uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
            layer: 0, flipX: false, flipY: false,
        });

        setCanvasRect(app, -400, -300, 400, 300);

        app.tick(1 / 60);

        const fillW = module.getUIRectComputedWidth(registry, fill);
        const fillH = module.getUIRectComputedHeight(registry, fill);
        const bgW = module.getUIRectComputedWidth(registry, background);

        expect(fillW).toBeGreaterThan(0);
        expect(fillH).toBeGreaterThan(0);
        expect(fillW).toBeCloseTo(bgW * 0.5, 0);

        disposeApp(app, registry);
    });

    it('should handle multiple tick calls without error', () => {
        const { app, registry } = createEditorApp();
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

        setCanvasRect(app, -400, -300, 400, 300);

        for (let i = 0; i < 60; i++) {
            expect(() => app.tick(1 / 60)).not.toThrow();
        }

        disposeApp(app, registry);
    });

    it('should skip layout when UICameraInfo.valid is false', () => {
        const { app, registry } = createEditorApp();
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

        const cam = app.getResource(UICameraInfo);
        cam.valid = false;

        expect(() => app.tick(1 / 60)).not.toThrow();

        const w = module.getUIRectComputedWidth(registry, root);
        expect(w).toBe(0);

        disposeApp(app, registry);
    });

    it('Canvas without UIRect: layout should not overwrite Transform positions', () => {
        const { app, registry } = createEditorApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const child = world.spawn();
        world.setParent(child, root);
        world.insert(child, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0, y: 0 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 200, y: 100 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(child, Transform, {
            position: { x: 50, y: 75, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(child, Sprite, {
            texture: 0, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 100, y: 100 },
            uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
            layer: 0, flipX: false, flipY: false,
        });

        setCanvasRect(app, -400, -300, 400, 300);
        app.tick(1 / 60);

        const t = registry.getTransform(child);
        expect(t.position.x).toBeCloseTo(50, 1);
        expect(t.position.y).toBeCloseTo(75, 1);

        disposeApp(app, registry);
    });
});
