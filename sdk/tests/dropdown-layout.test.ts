/**
 * Regression test: Dropdown option entities must have distinct positions.
 *
 * Bug: C++ UILayoutSystem overwrites manually-set Transform positions based on
 * UIRect anchors. When all options share the same UIRect anchors, they overlap.
 * Fix: use UIRect offsetMin.y to differentiate positions so the layout system
 * computes unique positions for each option.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite, Name, Canvas } from '../src/component';
import type { SpriteData } from '../src/component';
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
import type { InteractableData } from '../src/ui/Interactable';
import { UIInteraction } from '../src/ui/UIInteraction';
import { Text } from '../src/ui/text';
import type { TextData } from '../src/ui/text';
import { DROPDOWN_ITEM_HEIGHT } from '../src/ui/uiConstants';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Dropdown Layout (WASM integration)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createDropdownApp() {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);

        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0,
            screenW: 0, screenH: 0,
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

    function makeTransform() {
        return {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        };
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
        world.insert(root, Transform, makeTransform());

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
        world.insert(ddEntity, Transform, makeTransform());
        world.insert(ddEntity, Sprite, {
            texture: 0, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
            size: { x: 160, y: 30 }, uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
        });
        world.insert(ddEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });

        // List entity (positioned below dropdown)
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
        world.insert(listEntity, Transform, makeTransform());
        world.insert(listEntity, Sprite, {
            texture: 0, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 160, y: 90 }, uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
            enabled: false,
        });
        world.insert(listEntity, Interactable, { enabled: false, blockRaycast: true, raycastTarget: true });

        // Label entity with Text (default white color — simulates real scene)
        const labelEntity = world.spawn();
        world.setParent(labelEntity, ddEntity);
        world.insert(labelEntity, Transform, makeTransform());
        world.insert(labelEntity, Text, {
            content: '',
            fontFamily: 'Arial',
            fontSize: 16,
            color: { r: 1, g: 1, b: 1, a: 1 },
            align: 0,
            verticalAlign: 1,
            wordWrap: false,
            overflow: 1,
            lineHeight: 1.2,
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

    it('should create option entities with distinct Y positions after opening', () => {
        const { app, registry } = createDropdownApp();
        const { ddEntity, listEntity } = createDropdownHierarchy(app);

        // Initial tick to set up layout
        app.tick(1 / 60);

        // Simulate click on dropdown to open it:
        // Force isOpen via component update and tick
        const world = app.world;
        const dd = world.get(ddEntity, Dropdown) as any;
        dd.isOpen = false;

        // Simulate UIInteraction justPressed on the dropdown
        world.insert(ddEntity, UIInteraction, {
            hovered: true, pressed: true,
            justPressed: true, justReleased: false,
        });

        app.tick(1 / 60);

        // After tick, the dropdown should be open and options should exist
        const ddData = world.get(ddEntity, Dropdown) as any;

        // Find option entities (children of listEntity that have Sprite + Interactable)
        const allEntities = world.getAllEntities();
        const optionEntities: number[] = [];
        for (const e of allEntities) {
            if (e === listEntity || e === ddEntity) continue;
            if (!world.has(e, Sprite) || !world.has(e, Interactable)) continue;
            if (!world.has(e, UIRect)) continue;
            // Check if this is a child of listEntity
            if (world.has(e, Transform)) {
                const name = world.has(e, Name) ? (world.get(e, Name) as any).value : '';
                if (name.startsWith('Option_')) {
                    optionEntities.push(e);
                }
            }
        }

        // Should have 3 option entities
        expect(optionEntities.length).toBe(3);

        // Run another tick so layout computes positions
        app.tick(1 / 60);

        // Each option should have a DISTINCT Y position
        const yPositions = optionEntities.map(e => {
            const t = registry.getTransform(e);
            return t.position.y;
        });

        console.log('Option Y positions:', yPositions);

        // All Y positions must be different
        const uniqueY = new Set(yPositions.map(y => Math.round(y)));
        expect(uniqueY.size).toBe(3);

        // Options should be spaced by DROPDOWN_ITEM_HEIGHT
        yPositions.sort((a, b) => b - a); // highest first
        for (let i = 1; i < yPositions.length; i++) {
            const gap = yPositions[i - 1] - yPositions[i];
            expect(gap).toBeCloseTo(DROPDOWN_ITEM_HEIGHT, 0);
        }

        disposeApp(app, registry);
    });

    it('should have option sprites with non-zero size after layout', () => {
        const { app, registry } = createDropdownApp();
        const { ddEntity, listEntity } = createDropdownHierarchy(app);

        app.tick(1 / 60);

        const world = app.world;
        world.insert(ddEntity, UIInteraction, {
            hovered: true, pressed: true,
            justPressed: true, justReleased: false,
        });

        app.tick(1 / 60);
        app.tick(1 / 60);

        const allEntities = world.getAllEntities();
        const optionEntities: number[] = [];
        for (const e of allEntities) {
            if (!world.has(e, Name)) continue;
            const name = (world.get(e, Name) as any).value;
            if (name.startsWith('Option_')) {
                optionEntities.push(e);
            }
        }

        expect(optionEntities.length).toBe(3);

        for (const e of optionEntities) {
            const sprite = registry.getSprite(e);
            expect(sprite.size.x).toBeGreaterThan(0);
            expect(sprite.size.y).toBeGreaterThan(0);
            expect(sprite.enabled).toBe(true);
        }

        disposeApp(app, registry);
    });

    it('should hide list entity on initialization when dropdown is closed', () => {
        const { app, registry } = createDropdownApp();
        const { listEntity } = createDropdownHierarchy(app);
        const world = app.world;

        // Simulate list entity starting with enabled=true (scene not pre-configured)
        world.insert(listEntity, Sprite, {
            texture: 0, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 160, y: 90 }, uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
            enabled: true,
        });
        world.insert(listEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });

        app.tick(1 / 60);

        const sprite = registry.getSprite(listEntity);
        expect(sprite.enabled).toBe(false);

        const interactable = world.get(listEntity, Interactable) as InteractableData;
        expect(interactable.enabled).toBe(false);

        disposeApp(app, registry);
    });

    it('should set label text color to non-white after sync', () => {
        const { app, registry } = createDropdownApp();
        const { labelEntity } = createDropdownHierarchy(app);
        const world = app.world;

        app.tick(1 / 60);

        const text = world.get(labelEntity, Text) as TextData;
        const isWhite = text.color.r === 1 && text.color.g === 1 && text.color.b === 1;
        expect(isWhite).toBe(false);
        expect(text.content).toBe('Option A');

        disposeApp(app, registry);
    });

    it('should preserve label placeholder text when selectedIndex is -1', () => {
        const { app, registry } = createDropdownApp();
        const { ddEntity, labelEntity } = createDropdownHierarchy(app);
        const world = app.world;

        // Set label placeholder text and reset selectedIndex to -1
        world.insert(labelEntity, Text, {
            content: 'Select...',
            fontFamily: 'Arial',
            fontSize: 16,
            color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
            align: 0, verticalAlign: 1,
            wordWrap: false, overflow: 1, lineHeight: 1.2,
        });

        const dd = world.get(ddEntity, Dropdown) as DropdownData;
        dd.selectedIndex = -1;
        world.insert(ddEntity, Dropdown, dd);

        app.tick(1 / 60);

        const text = world.get(labelEntity, Text) as TextData;
        expect(text.content).toBe('Select...');

        disposeApp(app, registry);
    });

    it('should fix white label text even when selectedIndex is -1', () => {
        const { app, registry } = createDropdownApp();
        const { ddEntity, labelEntity } = createDropdownHierarchy(app);
        const world = app.world;

        // White text + selectedIndex -1 (placeholder scenario from scene)
        world.insert(labelEntity, Text, {
            content: 'Select...',
            fontFamily: 'Arial',
            fontSize: 16,
            color: { r: 1, g: 1, b: 1, a: 1 },
            align: 0, verticalAlign: 1,
            wordWrap: false, overflow: 1, lineHeight: 1.2,
        });

        const dd = world.get(ddEntity, Dropdown) as DropdownData;
        dd.selectedIndex = -1;
        world.insert(ddEntity, Dropdown, dd);

        app.tick(1 / 60);

        const text = world.get(labelEntity, Text) as TextData;
        // White text should be fixed to black even without valid selection
        const isWhite = text.color.r === 1 && text.color.g === 1 && text.color.b === 1;
        expect(isWhite).toBe(false);
        // Placeholder content should be preserved
        expect(text.content).toBe('Select...');

        disposeApp(app, registry);
    });

    it('should open dropdown and show list entity on click', () => {
        const { app, registry } = createDropdownApp();
        const { ddEntity, listEntity } = createDropdownHierarchy(app);
        const world = app.world;

        app.tick(1 / 60);

        // Verify list is hidden initially
        let sprite = registry.getSprite(listEntity);
        expect(sprite.enabled).toBe(false);

        // Simulate click
        world.insert(ddEntity, UIInteraction, {
            hovered: true, pressed: true,
            justPressed: true, justReleased: false,
        });

        app.tick(1 / 60);

        const dd = world.get(ddEntity, Dropdown) as any;
        expect(dd.isOpen).toBe(true);

        sprite = registry.getSprite(listEntity);
        expect(sprite.enabled).toBe(true);

        disposeApp(app, registry);
    });
});
