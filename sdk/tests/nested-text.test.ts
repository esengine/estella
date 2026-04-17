/**
 * Regression test: nested Text entities (parent Text → child Text) must
 * both produce visible Sprite components with valid texture handles.
 *
 * Bug: when a Text entity is created as a child of another Text entity,
 * only one text renders visually.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite, Canvas } from '../src/component';
import type { SpriteData } from '../src/component';
import { UIRect } from '../src/ui/core/ui-rect';
import type { UIRectData } from '../src/ui/core/ui-rect';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { Text } from '../src/ui/core/text';
import type { TextData } from '../src/ui/core/text';
import { textPlugin } from '../src/ui/TextPlugin';
import { INVALID_TEXTURE } from '../src/types';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Nested Text Entities (WASM integration)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createApp(includeTextPlugin = false) {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);

        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
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
        if (includeTextPlugin) {
            app.addPlugin(textPlugin);
        }

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

    function createCanvasRoot(app: App) {
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
        return root;
    }

    function createTextEntity(app: App, parent: number, content: string) {
        const world = app.world;
        const entity = world.spawn();
        world.setParent(entity, parent);
        world.insert(entity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(entity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 100, y: 100 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(entity, Text, {
            content,
            fontFamily: 'Arial',
            fontSize: 24,
            color: { r: 0, g: 0, b: 0, a: 1 },
            align: 1,
            verticalAlign: 1,
            wordWrap: true,
            overflow: 0,
            lineHeight: 1.2,
        });
        return entity;
    }

    it('both nested text entities should have Sprite after tick (manual sprites)', () => {
        const { app, registry } = createApp(false);
        const world = app.world;

        const root = createCanvasRoot(app);
        const parentText = createTextEntity(app, root, 'Parent');
        const childText = createTextEntity(app, parentText, 'Child');

        // Manually add Sprite to both (simulating what TextPlugin would do)
        world.insert(parentText, Sprite, {
            texture: INVALID_TEXTURE,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 50, y: 20 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0,
            flipX: false,
            flipY: false,
            material: 0,
            enabled: true,
        });
        world.insert(childText, Sprite, {
            texture: INVALID_TEXTURE,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 50, y: 20 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0,
            flipX: false,
            flipY: false,
            material: 0,
            enabled: true,
        });

        app.tick(1 / 60);

        // Both sprites should exist and be enabled
        expect(world.has(parentText, Sprite)).toBe(true);
        expect(world.has(childText, Sprite)).toBe(true);

        const parentSprite = world.get(parentText, Sprite) as SpriteData;
        const childSprite = world.get(childText, Sprite) as SpriteData;

        // Both should be enabled
        expect(parentSprite.enabled).toBe(true);
        expect(childSprite.enabled).toBe(true);

        // UILayoutLateSystem should set sizes to UIRect computed dimensions
        expect(parentSprite.size.x).toBeGreaterThan(0);
        expect(parentSprite.size.y).toBeGreaterThan(0);
        expect(childSprite.size.x).toBeGreaterThan(0);
        expect(childSprite.size.y).toBeGreaterThan(0);

        disposeApp(app, registry);
    });

    it('child text entity overlaps parent at same position with default UIRect', () => {
        const { app, registry } = createApp(false);
        const world = app.world;

        const root = createCanvasRoot(app);
        const parentText = createTextEntity(app, root, 'Parent');
        const childText = createTextEntity(app, parentText, 'Child');

        // Add sprites manually
        world.insert(parentText, Sprite, {
            texture: INVALID_TEXTURE,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 50, y: 20 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0,
            flipX: false,
            flipY: false,
        });
        world.insert(childText, Sprite, {
            texture: INVALID_TEXTURE,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 50, y: 20 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0,
            flipX: false,
            flipY: false,
        });

        app.tick(1 / 60);

        // With default UIRect (anchorMin=0.5, anchorMax=0.5, size=100x100),
        // both texts are centered in their parent rect.
        // The child's local position should be (0, 0) → same world position as parent.
        // This causes them to overlap perfectly, appearing as a single text.
        const parentTransform = world.get(parentText, Transform) as any;
        const childTransform = world.get(childText, Transform) as any;

        // Child local position should be ~0 (centered in parent)
        expect(Math.abs(childTransform.position.x)).toBeLessThan(0.01);
        expect(Math.abs(childTransform.position.y)).toBeLessThan(0.01);

        // Both sprites have same size (from UIRect 100x100)
        const parentSprite = world.get(parentText, Sprite) as SpriteData;
        const childSprite = world.get(childText, Sprite) as SpriteData;
        expect(parentSprite.size.x).toBeCloseTo(childSprite.size.x, 0);
        expect(parentSprite.size.y).toBeCloseTo(childSprite.size.y, 0);

        disposeApp(app, registry);
    });

    it('both text entities are returned by getEntitiesWithComponents', () => {
        const { app, registry } = createApp(false);
        const world = app.world;

        const root = createCanvasRoot(app);
        const parentText = createTextEntity(app, root, 'Parent');
        const childText = createTextEntity(app, parentText, 'Child');

        const textEntities = world.getEntitiesWithComponents([Text]);
        expect(textEntities).toContain(parentText);
        expect(textEntities).toContain(childText);
        expect(textEntities.length).toBeGreaterThanOrEqual(2);

        disposeApp(app, registry);
    });

    it('TextPlugin should create sprites for both nested text entities', () => {
        let canvasSupported = true;
        try {
            // Test if canvas is available in the test environment
            const canvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(64, 64)
                : document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) canvasSupported = false;
            // Test getImageData support
            if (ctx && 'getImageData' in ctx) {
                ctx.getImageData(0, 0, 1, 1);
            } else {
                canvasSupported = false;
            }
        } catch {
            canvasSupported = false;
        }

        if (!canvasSupported) {
            console.warn('Skipping TextPlugin test: Canvas 2D not supported in test env');
            return;
        }

        const { app, registry } = createApp(true);
        const world = app.world;

        const root = createCanvasRoot(app);
        const parentText = createTextEntity(app, root, 'Parent');
        const childText = createTextEntity(app, parentText, 'Child');

        app.tick(1 / 60);

        // TextPlugin should have created Sprite for both entities
        expect(world.has(parentText, Sprite)).toBe(true);
        expect(world.has(childText, Sprite)).toBe(true);

        const parentSprite = world.get(parentText, Sprite) as SpriteData;
        const childSprite = world.get(childText, Sprite) as SpriteData;

        // Both should be enabled
        expect(parentSprite.enabled).toBe(true);
        expect(childSprite.enabled).toBe(true);

        // Both should have non-zero sizes
        expect(parentSprite.size.x).toBeGreaterThan(0);
        expect(parentSprite.size.y).toBeGreaterThan(0);
        expect(childSprite.size.x).toBeGreaterThan(0);
        expect(childSprite.size.y).toBeGreaterThan(0);

        // Both should have valid (non-INVALID) texture handles
        // TextPlugin creates real GPU textures via rm.createTexture
        expect(parentSprite.texture).not.toBe(INVALID_TEXTURE);
        expect(childSprite.texture).not.toBe(INVALID_TEXTURE);

        // Texture handles should be different (each entity gets its own texture)
        expect(parentSprite.texture).not.toBe(childSprite.texture);

        disposeApp(app, registry);
    });
});
