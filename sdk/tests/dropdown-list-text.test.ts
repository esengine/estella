/**
 * Regression test: a Text entity manually placed as a child of the dropdown's
 * list entity should be visible even when the dropdown is closed.
 *
 * Bug: user places a Text entity under the list entity. The text is only
 * visible when the dropdown is open, not when closed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite, Name, Canvas } from '../src/component';
import type { SpriteData, TransformData } from '../src/component';
import { UIRect } from '../src/ui/UIRect';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/UIEvents';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { uiInteractionPlugin } from '../src/ui/UIInteractionPlugin';
import { dropdownPlugin } from '../src/ui/DropdownPlugin';
import { Dropdown } from '../src/ui/Dropdown';
import { Interactable } from '../src/ui/Interactable';
import { UIInteraction } from '../src/ui/UIInteraction';
import type { UIInteractionData } from '../src/ui/UIInteraction';
import { Text } from '../src/ui/text';
import { INVALID_TEXTURE } from '../src/types';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Dropdown list child text visibility (WASM)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createApp() {
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
        app.addPlugin(uiInteractionPlugin);
        app.addPlugin(dropdownPlugin);

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

    /**
     * Build a dropdown hierarchy that mirrors the editor's default setup,
     * plus a user-placed Text entity as a child of the list.
     */
    function buildDropdownWithUserText(app: App) {
        const world = app.world;

        // Canvas root (full-screen canvas)
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

        // Dropdown button entity
        const ddEntity = world.spawn();
        world.setParent(ddEntity, root);
        world.insert(ddEntity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 160, y: 30 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(ddEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(ddEntity, Sprite, {
            texture: INVALID_TEXTURE, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
            size: { x: 160, y: 30 }, uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
        });
        world.insert(ddEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });

        // List entity (initially hidden)
        const listEntity = world.spawn();
        world.setParent(listEntity, ddEntity);
        world.insert(listEntity, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 0 },
            offsetMin: { x: 0, y: -90 }, offsetMax: { x: 0, y: 0 },
            size: { x: 160, y: 90 }, pivot: { x: 0.5, y: 1 },
        });
        world.insert(listEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 0, y: 0, z: 0 },
        });
        world.insert(listEntity, Sprite, {
            texture: INVALID_TEXTURE, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 160, y: 90 }, uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
        });
        world.insert(listEntity, Interactable, { enabled: false, blockRaycast: true, raycastTarget: true });

        // Label entity
        const labelEntity = world.spawn();
        world.setParent(labelEntity, ddEntity);
        world.insert(labelEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(labelEntity, Text, {
            content: 'Select...', fontFamily: 'Arial', fontSize: 16,
            color: { r: 1, g: 1, b: 1, a: 1 },
            align: 0, verticalAlign: 1,
            wordWrap: false, overflow: 1, lineHeight: 1.2,
        });

        // Dropdown component
        world.insert(ddEntity, Dropdown, {
            options: ['Option A', 'Option B', 'Option C'],
            selectedIndex: 0, isOpen: false,
            listEntity, labelEntity,
        });

        // === USER'S TEXT ENTITY (child of list) ===
        const userTextEntity = world.spawn();
        world.setParent(userTextEntity, listEntity);
        world.insert(userTextEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(userTextEntity, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 160, y: 90 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(userTextEntity, Text, {
            content: 'Custom Label', fontFamily: 'Arial', fontSize: 14,
            color: { r: 0, g: 0, b: 0, a: 1 },
            align: 1, verticalAlign: 1,
            wordWrap: false, overflow: 0, lineHeight: 1.2,
        });
        // Simulate what TextPlugin would do: add a Sprite
        world.insert(userTextEntity, Sprite, {
            texture: 42, // simulated valid texture handle
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 80, y: 14 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0,
            flipX: false, flipY: false,
            material: 0,
            enabled: true,
        });

        return { root, ddEntity, listEntity, labelEntity, userTextEntity };
    }

    it('list entity scale should be normalized from (0,0,0) to (1,1,1) on init', () => {
        const { app, registry } = createApp();
        const { ddEntity, listEntity, userTextEntity } = buildDropdownWithUserText(app);
        const world = app.world;

        // Verify initial scale is (0,0,0) as the editor sets it
        const beforeTick = world.get(listEntity, Transform) as TransformData;
        expect(beforeTick.scale.x).toBe(0);
        expect(beforeTick.scale.y).toBe(0);

        // First tick initializes the dropdown (closed state)
        app.tick(1 / 60);

        // DropdownPlugin should normalize list scale to (1,1,1) so children are visible
        const listTransform = world.get(listEntity, Transform) as TransformData;
        expect(listTransform.scale.x).toBe(1);
        expect(listTransform.scale.y).toBe(1);
        expect(listTransform.scale.z).toBe(1);

        // The list sprite should be disabled (dropdown closed)
        const listSprite = world.get(listEntity, Sprite) as SpriteData;
        expect(listSprite.enabled).toBe(false);

        // The user's text sprite should still be ENABLED
        const userSprite = world.get(userTextEntity, Sprite) as SpriteData;
        expect(userSprite.enabled).toBe(true);

        disposeApp(app, registry);
    });

    it('user text entity should have non-zero sprite size after layout', () => {
        const { app, registry } = createApp();
        const { userTextEntity } = buildDropdownWithUserText(app);
        const world = app.world;

        app.tick(1 / 60);

        const sprite = world.get(userTextEntity, Sprite) as SpriteData;
        expect(sprite.size.x).toBeGreaterThan(0);
        expect(sprite.size.y).toBeGreaterThan(0);

        disposeApp(app, registry);
    });

    it('user text entity should get layer from UIRenderOrderSystem', () => {
        const { app, registry } = createApp();
        const { ddEntity, listEntity, userTextEntity } = buildDropdownWithUserText(app);
        const world = app.world;

        app.tick(1 / 60);

        const ddSprite = world.get(ddEntity, Sprite) as SpriteData;
        const listSprite = world.get(listEntity, Sprite) as SpriteData;
        const userSprite = world.get(userTextEntity, Sprite) as SpriteData;

        // UIRenderOrderSystem should assign layers in hierarchy order:
        // root → ddEntity → listEntity → userTextEntity → labelEntity
        // User text should have a HIGHER layer than the list
        expect(userSprite.layer).toBeGreaterThan(listSprite.layer);

        disposeApp(app, registry);
    });

    it('user text entity survives dropdown open/close cycle', () => {
        const { app, registry } = createApp();
        const { ddEntity, listEntity, userTextEntity } = buildDropdownWithUserText(app);
        const world = app.world;

        // Initialize
        app.tick(1 / 60);

        // Simulate click to open dropdown
        world.insert(ddEntity, UIInteraction, {
            hovered: true, pressed: true,
            justPressed: true, justReleased: false,
        });
        app.tick(1 / 60);

        // Verify dropdown is open and text entity still exists
        const dd = world.get(ddEntity, Dropdown) as any;
        expect(dd.isOpen).toBe(true);
        expect(world.valid(userTextEntity)).toBe(true);
        expect(world.has(userTextEntity, Sprite)).toBe(true);

        const openSprite = world.get(userTextEntity, Sprite) as SpriteData;
        expect(openSprite.enabled).toBe(true);

        // Close dropdown
        world.insert(ddEntity, UIInteraction, {
            hovered: true, pressed: true,
            justPressed: true, justReleased: false,
        });
        app.tick(1 / 60);

        // After close, user text entity must still exist and be enabled
        expect(world.valid(userTextEntity)).toBe(true);
        expect(world.has(userTextEntity, Sprite)).toBe(true);

        const closedSprite = world.get(userTextEntity, Sprite) as SpriteData;
        expect(closedSprite.enabled).toBe(true);
        expect(closedSprite.size.x).toBeGreaterThan(0);
        expect(closedSprite.size.y).toBeGreaterThan(0);

        disposeApp(app, registry);
    });
});
