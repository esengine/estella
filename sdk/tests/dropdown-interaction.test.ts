/**
 * Regression test: UIInteractionPlugin must propagate justPressed through
 * Emscripten-backed UIInteraction components.
 *
 * Bug: UIInteractionPlugin passes Emscripten wrapper objects directly to
 * world.insert(). Object.entries() on these wrappers may not enumerate
 * properties, causing insertBuiltin to reset all fields to defaults.
 * This means justPressed is never set to true, so the dropdown never opens.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite, Name, Canvas } from '../src/component';
import { UIRect } from '../src/ui/UIRect';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/UIEvents';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { uiInteractionPlugin } from '../src/ui/UIInteractionPlugin';
import { dropdownPlugin } from '../src/ui/DropdownPlugin';
import { Dropdown } from '../src/ui/Dropdown';
import type { DropdownData } from '../src/ui/Dropdown';
import { Interactable } from '../src/ui/Interactable';
import { UIInteraction } from '../src/ui/UIInteraction';
import type { UIInteractionData } from '../src/ui/UIInteraction';
import { Text } from '../src/ui/text';
import type { TextData } from '../src/ui/text';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Dropdown Interaction (WASM integration)', () => {
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

    function createDropdownHierarchy(app: App) {
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

        const ddEntity = world.spawn();
        world.setParent(ddEntity, root);
        world.insert(ddEntity, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 160, y: 30 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(ddEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(ddEntity, Sprite, {
            texture: 0xFFFFFFFF, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 160, y: 30 }, uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
        });
        world.insert(ddEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });

        const listEntity = world.spawn();
        world.setParent(listEntity, ddEntity);
        world.insert(listEntity, UIRect, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 0 },
            offsetMin: { x: 0, y: -90 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 160, y: 90 },
            pivot: { x: 0.5, y: 1 },
        });
        world.insert(listEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(listEntity, Sprite, {
            texture: 0xFFFFFFFF, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 160, y: 90 }, uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
            enabled: false,
        });
        world.insert(listEntity, Interactable, { enabled: false, blockRaycast: true, raycastTarget: true });

        const labelEntity = world.spawn();
        world.setParent(labelEntity, ddEntity);
        world.insert(labelEntity, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(labelEntity, Text, {
            content: 'Select...',
            fontFamily: 'Arial',
            fontSize: 16,
            color: { r: 1, g: 1, b: 1, a: 1 },
            align: 0, verticalAlign: 1,
            wordWrap: false, overflow: 1, lineHeight: 1.2,
        });

        world.insert(ddEntity, Dropdown, {
            options: ['Option A', 'Option B', 'Option C'],
            selectedIndex: 0,
            isOpen: false,
            listEntity,
            labelEntity,
        });

        return { root, ddEntity, listEntity, labelEntity };
    }

    it('should propagate justPressed through C++ UIInteraction component', () => {
        const { app, registry } = createApp();
        const { ddEntity } = createDropdownHierarchy(app);
        const world = app.world;

        // First tick to let layout compute positions
        app.tick(1 / 60);

        // The ddEntity should now have UIInteraction from the hit test system (getOrEmplace)
        // Verify UIInteraction round-trip: read from C++, modify, write back
        world.insert(ddEntity, UIInteraction, {
            hovered: false, pressed: false,
            justPressed: true, justReleased: false,
        });

        const readBack = world.get(ddEntity, UIInteraction) as UIInteractionData;
        expect(readBack.justPressed).toBe(true);

        // Now test the Emscripten wrapper round-trip
        const wrapper = world.get(ddEntity, UIInteraction) as UIInteractionData;
        wrapper.justPressed = false;
        wrapper.hovered = true;
        world.insert(ddEntity, UIInteraction, wrapper);

        const readBack2 = world.get(ddEntity, UIInteraction) as UIInteractionData;
        expect(readBack2.hovered).toBe(true);
        expect(readBack2.justPressed).toBe(false);

        disposeApp(app, registry);
    });

    it('should detect click on dropdown via C++ hit test and open it', () => {
        const { app, registry } = createApp();
        const { ddEntity, listEntity } = createDropdownHierarchy(app);
        const world = app.world;

        // Initial tick to compute layout
        app.tick(1 / 60);

        // Verify dropdown is closed
        let dd = world.get(ddEntity, Dropdown) as DropdownData;
        expect(dd.isOpen).toBe(false);

        // The ddEntity should be at world origin (0,0) with size 160x30
        // Run hit test with mouse at (0, 0) - center of dropdown
        module.uiHitTest_update(registry, 0, 0, false, true, false);
        const hitRaw = module.uiHitTest_getHitEntity();
        const hitEntity = hitRaw === 0xFFFFFFFF ? null : hitRaw;

        // The hit test should detect the dropdown entity
        expect(hitEntity).toBe(ddEntity);

        // Now simulate a full click by setting UIInteraction with plain object
        // (bypassing the UIInteractionPlugin's Emscripten wrapper issue)
        world.insert(ddEntity, UIInteraction, {
            hovered: true, pressed: true,
            justPressed: true, justReleased: false,
        });

        app.tick(1 / 60);

        dd = world.get(ddEntity, Dropdown) as DropdownData;
        expect(dd.isOpen).toBe(true);

        disposeApp(app, registry);
    });

    it('should correctly round-trip UIInteraction through Emscripten wrapper', () => {
        const { app, registry } = createApp();
        const { ddEntity } = createDropdownHierarchy(app);
        const world = app.world;

        app.tick(1 / 60);

        // Set known values via plain object
        world.insert(ddEntity, UIInteraction, {
            hovered: true, pressed: false,
            justPressed: false, justReleased: true,
        });

        // Read back as Emscripten wrapper
        const wrapper = world.get(ddEntity, UIInteraction);

        // Check Object.entries on the wrapper (this is what insertBuiltin uses)
        const entries = Object.entries(wrapper as Record<string, unknown>);
        const entryKeys = entries.map(([k]) => k).sort();

        // All 4 properties must be enumerable
        expect(entryKeys).toContain('hovered');
        expect(entryKeys).toContain('pressed');
        expect(entryKeys).toContain('justPressed');
        expect(entryKeys).toContain('justReleased');

        // Modify and write back through the wrapper
        (wrapper as any).hovered = false;
        (wrapper as any).justPressed = true;
        (wrapper as any).justReleased = false;
        world.insert(ddEntity, UIInteraction, wrapper as UIInteractionData);

        // Read back and verify modifications persisted
        const result = world.get(ddEntity, UIInteraction) as UIInteractionData;
        expect(result.hovered).toBe(false);
        expect(result.pressed).toBe(false);
        expect(result.justPressed).toBe(true);
        expect(result.justReleased).toBe(false);

        disposeApp(app, registry);
    });

    it('should read sprite color fields as {r,g,b,a} not {x,y,z,w}', () => {
        const { app, registry } = createApp();
        const { ddEntity } = createDropdownHierarchy(app);
        const world = app.world;

        // Write color using {r,g,b,a} format
        world.insert(ddEntity, Sprite, {
            texture: 0xFFFFFFFF,
            color: { r: 0.5, g: 0.6, b: 0.7, a: 0.8 },
            size: { x: 100, y: 50 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0, flipX: false, flipY: false,
        });

        // Read back - should use {r,g,b,a} format, not {x,y,z,w}
        const s = world.get(ddEntity, Sprite) as any;

        // This is the critical test: color must have r,g,b,a fields
        expect(s.color.r).toBeCloseTo(0.5, 1);
        expect(s.color.g).toBeCloseTo(0.6, 1);
        expect(s.color.b).toBeCloseTo(0.7, 1);
        expect(s.color.a).toBeCloseTo(0.8, 1);

        // Verify the color check used in initDropdownAppearance
        world.insert(ddEntity, Sprite, {
            texture: 0xFFFFFFFF,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 100, y: 50 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0, flipX: false, flipY: false,
        });

        const white = world.get(ddEntity, Sprite) as any;
        expect(white.color.r).toBe(1);
        expect(white.color.g).toBe(1);
        expect(white.color.b).toBe(1);
        expect(white.color.a).toBe(1);

        disposeApp(app, registry);
    });

    it('should fix white label text to black after initialization', () => {
        const { app, registry } = createApp();
        const { labelEntity } = createDropdownHierarchy(app);
        const world = app.world;

        // Before tick, text is white
        let text = world.get(labelEntity, Text) as TextData;
        expect(text.color.r).toBe(1);
        expect(text.color.g).toBe(1);
        expect(text.color.b).toBe(1);

        // After tick, syncLabel should fix to black
        app.tick(1 / 60);

        text = world.get(labelEntity, Text) as TextData;
        const isWhite = text.color.r === 1 && text.color.g === 1 && text.color.b === 1;
        expect(isWhite).toBe(false);

        disposeApp(app, registry);
    });
});
