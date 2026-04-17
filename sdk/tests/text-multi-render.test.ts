/**
 * Regression test: multiple Text entities must each get distinct,
 * valid GPU textures. Bug: only the last-created text is visible
 * in the editor, implying earlier textures are lost or overwritten.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite, Canvas } from '../src/component';
import type { SpriteData } from '../src/component';
import { UIRect } from '../src/ui/core/ui-rect';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/UIEvents';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { textPlugin } from '../src/ui/TextPlugin';
import { Text } from '../src/ui/core/text';
import { INVALID_TEXTURE } from '../src/types';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Multiple Text Entities (WASM)', () => {
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
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        return root;
    }

    function createTextEntity(app: App, parent: number, content: string, yOffset: number) {
        const world = app.world;
        const entity = world.spawn();
        world.setParent(entity, parent);
        world.insert(entity, Transform, {
            position: { x: 0, y: yOffset, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(entity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 200, y: 40 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(entity, Text, {
            content,
            fontFamily: 'Arial',
            fontSize: 24,
            color: { r: 0, g: 0, b: 0, a: 1 },
            align: 1, verticalAlign: 1,
            wordWrap: false, overflow: 0, lineHeight: 1.2,
        });
        return entity;
    }

    it('each text entity should get a distinct, valid texture after tick', () => {
        let canvasSupported = true;
        try {
            const canvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(64, 64)
                : document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) canvasSupported = false;
            if (ctx && 'getImageData' in ctx) {
                ctx.getImageData(0, 0, 1, 1);
            } else {
                canvasSupported = false;
            }
        } catch {
            canvasSupported = false;
        }
        if (!canvasSupported) {
            console.warn('Skipping: Canvas 2D not supported in test env');
            return;
        }

        const { app, registry } = createApp();
        const root = createCanvasRoot(app);

        const textA = createTextEntity(app, root, 'Alpha', 60);
        const textB = createTextEntity(app, root, 'Beta', 0);
        const textC = createTextEntity(app, root, 'Gamma', -60);

        app.tick(1 / 60);

        const world = app.world;
        const entities = [textA, textB, textC];
        const handles: number[] = [];

        for (const entity of entities) {
            expect(world.has(entity, Sprite)).toBe(true);
            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.enabled).toBe(true);
            expect(sprite.texture).not.toBe(INVALID_TEXTURE);
            handles.push(sprite.texture);
        }

        // All three texture handles must be distinct
        expect(new Set(handles).size).toBe(3);

        // Verify textures survive a second tick (snapshot skip path)
        app.tick(1 / 60);

        for (const entity of entities) {
            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.enabled).toBe(true);
            expect(sprite.texture).not.toBe(INVALID_TEXTURE);
        }

        // Handles should still be distinct after second tick
        const handles2 = entities.map(e => (world.get(e, Sprite) as SpriteData).texture);
        expect(new Set(handles2).size).toBe(3);

        disposeApp(app, registry);
    });

    it('text entities survive scene reload with entity ID reuse', () => {
        let canvasSupported = true;
        try {
            const canvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(64, 64)
                : document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) canvasSupported = false;
            if (ctx && 'getImageData' in ctx) {
                ctx.getImageData(0, 0, 1, 1);
            } else {
                canvasSupported = false;
            }
        } catch {
            canvasSupported = false;
        }
        if (!canvasSupported) {
            console.warn('Skipping: Canvas 2D not supported in test env');
            return;
        }

        const { app, registry } = createApp();
        const world = app.world;

        const root = createCanvasRoot(app);
        const textA = createTextEntity(app, root, 'Label', 60);
        const textB = createTextEntity(app, root, 'Option A', 0);
        const textC = createTextEntity(app, root, 'Option B', -60);

        app.tick(1 / 60);

        for (const entity of [textA, textB, textC]) {
            expect(world.has(entity, Sprite)).toBe(true);
            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).not.toBe(INVALID_TEXTURE);
        }

        // Simulate scene reload: destroy all, re-spawn from scene data.
        // C++ Registry reuses entity IDs from recycled queue.
        for (const e of world.getAllEntities()) {
            world.despawn(e);
        }

        const root2 = createCanvasRoot(app);
        const textA2 = createTextEntity(app, root2, 'Label', 60);
        const textB2 = createTextEntity(app, root2, 'Option A', 0);
        const textC2 = createTextEntity(app, root2, 'Option B', -60);

        // COMPONENT_SUPPRESS_RULES: Sprite NOT loaded for Text entities after reload.
        // These entities have Text + UIRect but no Sprite.

        app.tick(1 / 60);

        // All text entities must get valid Sprites despite snapshot cache having
        // stale entries from before the reload (entity ID reuse).
        for (const entity of [textA2, textB2, textC2]) {
            expect(world.has(entity, Sprite)).toBe(true);
            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).not.toBe(INVALID_TEXTURE);
        }

        const handles = [textA2, textB2, textC2].map(
            e => (world.get(e, Sprite) as SpriteData).texture
        );
        expect(new Set(handles).size).toBe(3);

        disposeApp(app, registry);
    });

    it('text entities with manual sprites should all have unique textures', () => {
        const { app, registry } = createApp();
        const root = createCanvasRoot(app);
        const world = app.world;

        const textA = createTextEntity(app, root, 'Alpha', 60);
        const textB = createTextEntity(app, root, 'Beta', 0);
        const textC = createTextEntity(app, root, 'Gamma', -60);

        // Manually add sprites (simulating what TextPlugin does)
        for (const [entity, tex] of [[textA, 100], [textB, 200], [textC, 300]] as const) {
            world.insert(entity, Sprite, {
                texture: tex, color: { r: 1, g: 1, b: 1, a: 1 },
                size: { x: 200, y: 40 }, uvOffset: { x: 0, y: 0 },
                uvScale: { x: 1, y: 1 }, layer: 0,
                flipX: false, flipY: false, material: 0, enabled: true,
            });
        }

        app.tick(1 / 60);

        // After tick, each sprite should retain its unique texture
        // (UILayoutSystem and UIRenderOrderSystem should NOT overwrite textures)
        const spriteA = world.get(textA, Sprite) as SpriteData;
        const spriteB = world.get(textB, Sprite) as SpriteData;
        const spriteC = world.get(textC, Sprite) as SpriteData;

        expect(spriteA.enabled).toBe(true);
        expect(spriteB.enabled).toBe(true);
        expect(spriteC.enabled).toBe(true);

        // Texture handles must be preserved (not overwritten to same value)
        const uniqueTextures = new Set([spriteA.texture, spriteB.texture, spriteC.texture]);
        expect(uniqueTextures.size).toBe(3);

        disposeApp(app, registry);
    });
});
