/**
 * Integration tests: Slider fill/handle layout via real WASM module.
 *
 * Simulates how the editor renders a Slider:
 *   1. Create root Canvas → Slider background → Fill + Handle as children
 *   2. Call applyDirectionalFill / computeHandleAnchors to set anchors
 *   3. Run await app.tick() to compute layout
 *   4. Verify computed width/height and world positions
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite, Canvas } from '../src/component';
import { UIRect } from '../src/ui/UIRect';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/UIEvents';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { uiInteractionPlugin } from '../src/ui/UIInteractionPlugin';
import { sliderPlugin } from '../src/ui/SliderPlugin';
import { Slider } from '../src/ui/Slider';
import { applyDirectionalFill, computeHandleAnchors, computeFillAnchors } from '../src/ui/uiHelpers';
import { FillDirection } from '../src/ui/uiTypes';
import type { UIRectData } from '../src/ui/UIRect';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Slider Layout (WASM integration)', () => {
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

    function createSliderHierarchy(app: App) {
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UIRect, makeFullRect());
        world.insert(root, Transform, makeTransform());

        const sliderBg = world.spawn();
        world.setParent(sliderBg, root);
        world.insert(sliderBg, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 200, y: 20 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(sliderBg, Transform, makeTransform());
        world.insert(sliderBg, Sprite, makeSprite(200, 20));

        const fill = world.spawn();
        world.setParent(fill, sliderBg);
        world.insert(fill, UIRect, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 0.5, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(fill, Transform, makeTransform());
        world.insert(fill, Sprite, makeSprite(100, 20));

        const handle = world.spawn();
        world.setParent(handle, sliderBg);
        world.insert(handle, UIRect, {
            anchorMin: { x: 0.5, y: 0 },
            anchorMax: { x: 0.5, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 20, y: 20 },
            pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(handle, Transform, makeTransform());
        world.insert(handle, Sprite, makeSprite(20, 20));

        return { root, sliderBg, fill, handle };
    }

    describe('computeFillAnchors (pure logic)', () => {
        it('should compute LeftToRight at 50%', () => {
            const anchors = computeFillAnchors(FillDirection.LeftToRight, 0.5);
            expect(anchors.anchorMin).toEqual({ x: 0, y: 0 });
            expect(anchors.anchorMax).toEqual({ x: 0.5, y: 1 });
        });

        it('should compute LeftToRight at 0%', () => {
            const anchors = computeFillAnchors(FillDirection.LeftToRight, 0);
            expect(anchors.anchorMin).toEqual({ x: 0, y: 0 });
            expect(anchors.anchorMax).toEqual({ x: 0, y: 1 });
        });

        it('should compute LeftToRight at 100%', () => {
            const anchors = computeFillAnchors(FillDirection.LeftToRight, 1);
            expect(anchors.anchorMin).toEqual({ x: 0, y: 0 });
            expect(anchors.anchorMax).toEqual({ x: 1, y: 1 });
        });

        it('should compute RightToLeft at 50%', () => {
            const anchors = computeFillAnchors(FillDirection.RightToLeft, 0.5);
            expect(anchors.anchorMin).toEqual({ x: 0.5, y: 0 });
            expect(anchors.anchorMax).toEqual({ x: 1, y: 1 });
        });

        it('should compute BottomToTop at 75%', () => {
            const anchors = computeFillAnchors(FillDirection.BottomToTop, 0.75);
            expect(anchors.anchorMin).toEqual({ x: 0, y: 0 });
            expect(anchors.anchorMax).toEqual({ x: 1, y: 0.75 });
        });

        it('should compute TopToBottom at 30%', () => {
            const anchors = computeFillAnchors(FillDirection.TopToBottom, 0.3);
            expect(anchors.anchorMin).toEqual({ x: 0, y: 0.7 });
            expect(anchors.anchorMax).toEqual({ x: 1, y: 1 });
        });
    });

    describe('computeHandleAnchors (pure logic)', () => {
        it('should position handle at value for LeftToRight', () => {
            const anchors = computeHandleAnchors(FillDirection.LeftToRight, 0.5);
            expect(anchors.anchorMin).toEqual({ x: 0.5, y: 0.5 });
            expect(anchors.anchorMax).toEqual({ x: 0.5, y: 0.5 });
        });

        it('should position handle at start for LeftToRight 0%', () => {
            const anchors = computeHandleAnchors(FillDirection.LeftToRight, 0);
            expect(anchors.anchorMin).toEqual({ x: 0, y: 0.5 });
            expect(anchors.anchorMax).toEqual({ x: 0, y: 0.5 });
        });

        it('should position handle at end for LeftToRight 100%', () => {
            const anchors = computeHandleAnchors(FillDirection.LeftToRight, 1);
            expect(anchors.anchorMin).toEqual({ x: 1, y: 0.5 });
            expect(anchors.anchorMax).toEqual({ x: 1, y: 0.5 });
        });
    });

    describe('fill layout after applyDirectionalFill + tick', () => {
        it('should compute fill width = 50% of slider background', async () => {
            const { app, registry } = createEditorApp();
            const { root, sliderBg, fill, handle } = createSliderHierarchy(app);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0.5);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const bgW = module.getUIRectComputedWidth(registry, sliderBg);
            const bgH = module.getUIRectComputedHeight(registry, sliderBg);
            expect(bgW).toBeCloseTo(200, 0);
            expect(bgH).toBeCloseTo(20, 0);

            const fillW = module.getUIRectComputedWidth(registry, fill);
            const fillH = module.getUIRectComputedHeight(registry, fill);
            expect(fillW).toBeCloseTo(100, 0);
            expect(fillH).toBeCloseTo(20, 0);

            disposeApp(app, registry);
        });

        it('should compute fill width = 0 at value 0', async () => {
            const { app, registry } = createEditorApp();
            const { fill } = createSliderHierarchy(app);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const fillW = module.getUIRectComputedWidth(registry, fill);
            expect(fillW).toBeCloseTo(0, 0);

            disposeApp(app, registry);
        });

        it('should compute fill width = 100% at value 1', async () => {
            const { app, registry } = createEditorApp();
            const { sliderBg, fill } = createSliderHierarchy(app);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 1);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const bgW = module.getUIRectComputedWidth(registry, sliderBg);
            const fillW = module.getUIRectComputedWidth(registry, fill);
            expect(fillW).toBeCloseTo(bgW, 0);

            disposeApp(app, registry);
        });

        it('should compute fill width = 25% at value 0.25', async () => {
            const { app, registry } = createEditorApp();
            const { fill } = createSliderHierarchy(app);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0.25);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const fillW = module.getUIRectComputedWidth(registry, fill);
            expect(fillW).toBeCloseTo(50, 0);

            disposeApp(app, registry);
        });

        it('should position fill at left side, not centered (LeftToRight 50%)', async () => {
            const { app, registry } = createEditorApp();
            const { sliderBg, fill } = createSliderHierarchy(app);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0.5);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);
            await app.tick(1 / 60);

            const fillTransform = registry.getTransform(fill);
            const bgTransform = registry.getTransform(sliderBg);

            console.log('bgTransform:', JSON.stringify(bgTransform));
            console.log('fillTransform:', JSON.stringify(fillTransform));
            console.log('fill UIRect:', JSON.stringify(registry.getUIRect(fill)));
            console.log('fill Sprite:', JSON.stringify(registry.getSprite(fill)));

            // Slider bg: 200 wide, centered (position.x = 0)
            expect(bgTransform.position.x).toBeCloseTo(0, 0);

            // Fill: 100 wide, should be at x = -50 (left side of 200-wide parent)
            // NOT at x = 0 (center)
            expect(fillTransform.position.x).toBeCloseTo(-50, 0);

            disposeApp(app, registry);
        });
    });

    describe('DEBUG: full pipeline sprite bounds', () => {
        it('should verify sprite left/right edges for LeftToRight fill', async () => {
            const { app, registry } = createEditorApp();
            const { root, sliderBg, fill } = createSliderHierarchy(app);

            setCanvasRect(app, -400, -300, 400, 300);

            const values = [0, 0.25, 0.5, 0.75, 1.0];
            for (const value of values) {
                applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, value);
                await app.tick(1 / 60);

                const fillT = registry.getTransform(fill);
                const bgT = registry.getTransform(sliderBg);
                const rootT = registry.getTransform(root);
                const fillS = registry.getSprite(fill);
                const fillR = registry.getUIRect(fill);
                const bgR = registry.getUIRect(sliderBg);

                // hierarchy: root→sliderBg→fill
                // root has no parent → worldPos = position
                // sliderBg's parent is root → worldPos = root.worldPos + sliderBg.position
                // fill's parent is sliderBg → worldPos = sliderBg.worldPos + fill.position
                const rootWorldX = rootT.position.x;
                const bgWorldX = rootWorldX + bgT.position.x;
                const fillWorldX = bgWorldX + fillT.position.x;

                // Sprite renders centered at worldPos, width = sprite.size.x
                const spriteLeft = fillWorldX - fillS.size.x / 2;
                const spriteRight = fillWorldX + fillS.size.x / 2;
                const parentLeft = bgWorldX - 100; // slider is 200 wide, centered
                const parentRight = bgWorldX + 100;
                const expectedFillWidth = 200 * value;

                console.log(`\n--- value=${value} ---`);
                console.log(`  root pos.x=${rootT.position.x}`);
                console.log(`  bg   pos.x=${bgT.position.x}, worldX=${bgWorldX}`);
                console.log(`  fill pos.x=${fillT.position.x}, worldX=${fillWorldX}`);
                console.log(`  fill sprite.size=${fillS.size.x}x${fillS.size.y}`);
                console.log(`  fill UIRect anchors: min=${fillR.anchorMin.x},${fillR.anchorMin.y} max=${fillR.anchorMax.x},${fillR.anchorMax.y}`);
                console.log(`  sprite bounds: [${spriteLeft}, ${spriteRight}]`);
                console.log(`  parent bounds: [${parentLeft}, ${parentRight}]`);
                console.log(`  expected fill width: ${expectedFillWidth}`);

                // Sprite size should match fill value
                expect(fillS.size.x).toBeCloseTo(expectedFillWidth, 0);

                // Fill position should be LEFT-aligned, not centered
                // For LeftToRight, fill's left edge should match parent's left edge
                if (value > 0) {
                    expect(spriteLeft).toBeCloseTo(parentLeft, 0);
                }
            }

            disposeApp(app, registry);
        });

        it('should verify Children.entities is populated after setParent', () => {
            const { app, registry } = createEditorApp();
            const { root, sliderBg, fill, handle } = createSliderHierarchy(app);

            const rootChildren = registry.getChildren(root);
            const bgChildren = registry.getChildren(sliderBg);

            const rootEntities: number[] = [];
            const bgEntities: number[] = [];
            for (let i = 0; i < rootChildren.entities.size(); i++) {
                rootEntities.push(rootChildren.entities.get(i));
            }
            for (let i = 0; i < bgChildren.entities.size(); i++) {
                bgEntities.push(bgChildren.entities.get(i));
            }

            console.log('\n--- Hierarchy check ---');
            console.log(`root children: [${rootEntities}]`);
            console.log(`sliderBg children: [${bgEntities}]`);
            console.log(`root entity=${root}, sliderBg=${sliderBg}, fill=${fill}, handle=${handle}`);

            expect(rootEntities).toContain(sliderBg);
            expect(bgEntities).toContain(fill);
            expect(bgEntities).toContain(handle);

            const fillParent = registry.getParent(fill);
            const handleParent = registry.getParent(handle);
            console.log(`fill parent=${fillParent.entity}, handle parent=${handleParent.entity}`);
            expect(fillParent.entity).toBe(sliderBg);
            expect(handleParent.entity).toBe(sliderBg);

            disposeApp(app, registry);
        });

        it('should test with SliderPlugin running (full runtime simulation)', async () => {
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
            app.insertResource(Input, new InputState());
            app.insertResource(UIEvents, new UIEventQueue());

            // Register layout + interaction + slider plugins (skip text/image which need canvas)
            app.addPlugin(uiLayoutPlugin);
            app.addPlugin(uiRenderOrderPlugin);
            app.addPlugin(uiInteractionPlugin);
            app.addPlugin(sliderPlugin);

            const world = app.world;

            // Create scene hierarchy: root → slider → fill + handle
            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const sliderBg = world.spawn();
            world.setParent(sliderBg, root);
            world.insert(sliderBg, UIRect, {
                anchorMin: { x: 0.5, y: 0.5 },
                anchorMax: { x: 0.5, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 200, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(sliderBg, Transform, makeTransform());
            world.insert(sliderBg, Sprite, makeSprite(200, 20));

            const fill = world.spawn();
            world.setParent(fill, sliderBg);
            world.insert(fill, UIRect, makeFullRect());
            world.insert(fill, Transform, makeTransform());
            world.insert(fill, Sprite, makeSprite(200, 20));

            const handle = world.spawn();
            world.setParent(handle, sliderBg);
            world.insert(handle, UIRect, {
                anchorMin: { x: 0.5, y: 0.5 },
                anchorMax: { x: 0.5, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 20, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(handle, Transform, makeTransform());
            world.insert(handle, Sprite, makeSprite(20, 20));

            // Register Slider component with fillEntity pointing to fill
            world.insert(sliderBg, Slider, {
                value: 0.5,
                minValue: 0,
                maxValue: 1,
                direction: FillDirection.LeftToRight,
                fillEntity: fill,
                handleEntity: handle,
                wholeNumbers: false,
            });

            // Set camera and tick
            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);
            await app.tick(1 / 60);

            const fillT = registry.getTransform(fill);
            const bgT = registry.getTransform(sliderBg);
            const fillS = registry.getSprite(fill);
            const fillR = registry.getUIRect(fill);

            const bgWorldX = bgT.position.x;
            const fillWorldX = bgWorldX + fillT.position.x;
            const spriteLeft = fillWorldX - fillS.size.x / 2;

            console.log('\n--- SliderPlugin full test (value=0.5) ---');
            console.log(`  bg pos.x=${bgT.position.x}`);
            console.log(`  fill pos.x=${fillT.position.x}`);
            console.log(`  fill sprite.size=${fillS.size.x}x${fillS.size.y}`);
            console.log(`  fill UIRect: min=${fillR.anchorMin.x},${fillR.anchorMin.y} max=${fillR.anchorMax.x},${fillR.anchorMax.y}`);
            console.log(`  fill worldX=${fillWorldX}, sprite left=${spriteLeft}`);

            // Fill should be 100 wide (50% of 200)
            expect(fillS.size.x).toBeCloseTo(100, 0);
            // Fill position should be -50 (left-aligned)
            expect(fillT.position.x).toBeCloseTo(-50, 0);
            // Sprite left edge should be at parent left (-100)
            expect(spriteLeft).toBeCloseTo(-100, 0);

            disposeApp(app, registry);
        });

        it('should verify worldPosition via TransformSystem', async () => {
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
            app.insertResource(Input, new InputState());
            app.insertResource(UIEvents, new UIEventQueue());

            app.addPlugin(uiLayoutPlugin);
            app.addPlugin(uiRenderOrderPlugin);
            app.addPlugin(uiInteractionPlugin);
            app.addPlugin(sliderPlugin);

            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            const sliderBg = world.spawn();
            world.setParent(sliderBg, root);
            world.insert(sliderBg, UIRect, {
                anchorMin: { x: 0.5, y: 0.5 },
                anchorMax: { x: 0.5, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 200, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(sliderBg, Transform, makeTransform());
            world.insert(sliderBg, Sprite, makeSprite(200, 20));

            const fill = world.spawn();
            world.setParent(fill, sliderBg);
            world.insert(fill, UIRect, makeFullRect());
            world.insert(fill, Transform, makeTransform());
            world.insert(fill, Sprite, makeSprite(200, 20));

            const handle = world.spawn();
            world.setParent(handle, sliderBg);
            world.insert(handle, UIRect, {
                anchorMin: { x: 0.5, y: 0.5 },
                anchorMax: { x: 0.5, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 20, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(handle, Transform, makeTransform());
            world.insert(handle, Sprite, makeSprite(20, 20));

            world.insert(sliderBg, Slider, {
                value: 0.5,
                minValue: 0,
                maxValue: 1,
                direction: FillDirection.LeftToRight,
                fillEntity: fill,
                handleEntity: handle,
                wholeNumbers: false,
            });

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);
            await app.tick(1 / 60);

            // Now run TransformSystem to compute worldPosition
            module.transform_update(registry);

            const fillT = registry.getTransform(fill);
            const bgT = registry.getTransform(sliderBg);
            const rootT = registry.getTransform(root);
            const fillS = registry.getSprite(fill);

            console.log('\n--- TransformSystem worldPosition test ---');
            console.log(`  root: pos=(${rootT.position.x}, ${rootT.position.y}), worldPos=(${rootT.worldPosition.x}, ${rootT.worldPosition.y})`);
            console.log(`  bg:   pos=(${bgT.position.x}, ${bgT.position.y}), worldPos=(${bgT.worldPosition.x}, ${bgT.worldPosition.y})`);
            console.log(`  fill: pos=(${fillT.position.x}, ${fillT.position.y}), worldPos=(${fillT.worldPosition.x}, ${fillT.worldPosition.y})`);
            console.log(`  fill sprite.size=(${fillS.size.x}, ${fillS.size.y})`);

            const spriteLeft = fillT.worldPosition.x - fillS.size.x / 2;
            const spriteRight = fillT.worldPosition.x + fillS.size.x / 2;
            const sliderLeft = bgT.worldPosition.x - 100;
            const sliderRight = bgT.worldPosition.x + 100;

            console.log(`  sprite bounds: [${spriteLeft}, ${spriteRight}]`);
            console.log(`  slider bounds: [${sliderLeft}, ${sliderRight}]`);

            // worldPosition should be computed from hierarchy
            expect(bgT.worldPosition.x).toBeCloseTo(0, 0);
            expect(fillT.worldPosition.x).toBeCloseTo(-50, 0);

            // Sprite left edge should match slider left edge
            expect(spriteLeft).toBeCloseTo(sliderLeft, 0);

            disposeApp(app, registry);
        });
    });

    describe('handle layout after anchor update + tick', () => {
        it('should position handle sprite at 50%', async () => {
            const { app, registry } = createEditorApp();
            const { sliderBg, handle } = createSliderHierarchy(app);

            const anchors = computeHandleAnchors(FillDirection.LeftToRight, 0.5);
            app.world.insert(handle, UIRect, {
                anchorMin: anchors.anchorMin,
                anchorMax: anchors.anchorMax,
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 20, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const handleW = module.getUIRectComputedWidth(registry, handle);
            const handleH = module.getUIRectComputedHeight(registry, handle);
            expect(handleW).toBeCloseTo(20, 0);
            expect(handleH).toBeCloseTo(20, 0);

            disposeApp(app, registry);
        });
    });

    describe('render order in slider hierarchy', () => {
        it('should order: background < fill < handle', async () => {
            const { app, registry } = createEditorApp();
            const { sliderBg, fill, handle } = createSliderHierarchy(app);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const bgLayer = registry.getSprite(sliderBg).layer;
            const fillLayer = registry.getSprite(fill).layer;
            const handleLayer = registry.getSprite(handle).layer;

            expect(fillLayer).toBeGreaterThan(bgLayer);
            expect(handleLayer).toBeGreaterThan(bgLayer);

            disposeApp(app, registry);
        });
    });

    describe('dynamic fill changes across ticks', () => {
        it('should update fill width when value changes', async () => {
            const { app, registry } = createEditorApp();
            const { fill } = createSliderHierarchy(app);

            setCanvasRect(app, -400, -300, 400, 300);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0.3);
            await app.tick(1 / 60);
            expect(module.getUIRectComputedWidth(registry, fill)).toBeCloseTo(60, 0);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0.7);
            await app.tick(1 / 60);
            expect(module.getUIRectComputedWidth(registry, fill)).toBeCloseTo(140, 0);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0);
            await app.tick(1 / 60);
            expect(module.getUIRectComputedWidth(registry, fill)).toBeCloseTo(0, 0);

            disposeApp(app, registry);
        });
    });

    describe('two sliders side by side', () => {
        it('should compute independent layouts for two sliders', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UIRect, makeFullRect());
            world.insert(root, Transform, makeTransform());

            // Slider 1 (top half)
            const slider1Bg = world.spawn();
            world.setParent(slider1Bg, root);
            world.insert(slider1Bg, UIRect, {
                anchorMin: { x: 0.5, y: 0.75 },
                anchorMax: { x: 0.5, y: 0.75 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 200, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(slider1Bg, Transform, makeTransform());
            world.insert(slider1Bg, Sprite, makeSprite(200, 20));

            const fill1 = world.spawn();
            world.setParent(fill1, slider1Bg);
            world.insert(fill1, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 0.3, y: 1 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(fill1, Transform, makeTransform());
            world.insert(fill1, Sprite, makeSprite(60, 20));

            // Slider 2 (bottom half)
            const slider2Bg = world.spawn();
            world.setParent(slider2Bg, root);
            world.insert(slider2Bg, UIRect, {
                anchorMin: { x: 0.5, y: 0.25 },
                anchorMax: { x: 0.5, y: 0.25 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 300, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(slider2Bg, Transform, makeTransform());
            world.insert(slider2Bg, Sprite, makeSprite(300, 20));

            const fill2 = world.spawn();
            world.setParent(fill2, slider2Bg);
            world.insert(fill2, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 0.8, y: 1 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 0, y: 0 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(fill2, Transform, makeTransform());
            world.insert(fill2, Sprite, makeSprite(240, 20));

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            // Slider 1: bg = 200w, fill = 30% = 60w
            expect(module.getUIRectComputedWidth(registry, slider1Bg)).toBeCloseTo(200, 0);
            expect(module.getUIRectComputedWidth(registry, fill1)).toBeCloseTo(60, 0);
            expect(module.getUIRectComputedHeight(registry, fill1)).toBeCloseTo(20, 0);

            // Slider 2: bg = 300w, fill = 80% = 240w
            expect(module.getUIRectComputedWidth(registry, slider2Bg)).toBeCloseTo(300, 0);
            expect(module.getUIRectComputedWidth(registry, fill2)).toBeCloseTo(240, 0);
            expect(module.getUIRectComputedHeight(registry, fill2)).toBeCloseTo(20, 0);

            // Both backgrounds should have sprites
            expect(registry.hasSprite(slider1Bg)).toBe(true);
            expect(registry.hasSprite(slider2Bg)).toBe(true);
            expect(registry.hasSprite(fill1)).toBe(true);
            expect(registry.hasSprite(fill2)).toBe(true);

            // Render order: fill should be above background
            expect(registry.getSprite(fill1).layer).toBeGreaterThan(registry.getSprite(slider1Bg).layer);
            expect(registry.getSprite(fill2).layer).toBeGreaterThan(registry.getSprite(slider2Bg).layer);

            disposeApp(app, registry);
        });
    });

    describe('fill sprite size sync via layout system', () => {
        it('should update fill Sprite.size to match computed UIRect size', async () => {
            const { app, registry } = createEditorApp();
            const { fill } = createSliderHierarchy(app);

            applyDirectionalFill(app.world, fill, FillDirection.LeftToRight, 0.5);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            const sprite = registry.getSprite(fill);
            const computedW = module.getUIRectComputedWidth(registry, fill);
            const computedH = module.getUIRectComputedHeight(registry, fill);
            expect(sprite.size.x).toBeCloseTo(computedW, 0);
            expect(sprite.size.y).toBeCloseTo(computedH, 0);

            disposeApp(app, registry);
        });
    });

    describe('editor-like slider creation flow', () => {
        it('should reproduce exact editor slider hierarchy and verify fill visibility', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            // Simulate editor scene: Canvas root → Slider → Fill + Handle
            // This mirrors what HierarchyContextMenu.createSliderEntity does

            const canvasRoot = world.spawn();
            world.insert(canvasRoot, Canvas, {});
            world.insert(canvasRoot, UIRect, makeFullRect());
            world.insert(canvasRoot, Transform, makeTransform());

            // Slider background (same as editor: size 200x20, centered anchors)
            const slider = world.spawn();
            world.setParent(slider, canvasRoot);
            world.insert(slider, UIRect, {
                anchorMin: { x: 0.5, y: 0.5 },
                anchorMax: { x: 0.5, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 200, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(slider, Transform, makeTransform());
            // Editor gives slider a smaller Sprite (200x8) than UIRect (200x20)
            world.insert(slider, Sprite, makeSprite(200, 8));

            // Fill child (same as editor)
            const fill = world.spawn();
            world.setParent(fill, slider);
            world.insert(fill, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 0.5, y: 1 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 100, y: 100 },  // default SDK size, ignored in stretch
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(fill, Transform, makeTransform());
            world.insert(fill, Sprite, makeSprite(200, 8));

            // Handle child (same as editor)
            const handle = world.spawn();
            world.setParent(handle, slider);
            world.insert(handle, UIRect, {
                anchorMin: { x: 0.5, y: 0.5 },
                anchorMax: { x: 0.5, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 20, y: 20 },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(handle, Transform, makeTransform());
            world.insert(handle, Sprite, makeSprite(20, 20));

            // Step 1: applyFillStates (editor calls this after loading scene)
            applyDirectionalFill(world, fill, FillDirection.LeftToRight, 0.5);

            // Verify fill UIRect anchors were set correctly
            const fillRect = registry.getUIRect(fill);
            expect(fillRect.anchorMin.x).toBeCloseTo(0);
            expect(fillRect.anchorMin.y).toBeCloseTo(0);
            expect(fillRect.anchorMax.x).toBeCloseTo(0.5);
            expect(fillRect.anchorMax.y).toBeCloseTo(1);

            // Step 2: render() calls tick() which runs C++ layout
            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            // Verify slider bg got correct size (fixed-size centered)
            const sliderW = module.getUIRectComputedWidth(registry, slider);
            const sliderH = module.getUIRectComputedHeight(registry, slider);
            expect(sliderW).toBeCloseTo(200, 0);
            expect(sliderH).toBeCloseTo(20, 0);

            // Verify fill got correct size (50% of 200 = 100)
            const fillW = module.getUIRectComputedWidth(registry, fill);
            const fillH = module.getUIRectComputedHeight(registry, fill);
            expect(fillW).toBeCloseTo(100, 0);
            expect(fillH).toBeCloseTo(20, 0);

            // Verify fill sprite was updated by C++ layout
            const fillSprite = registry.getSprite(fill);
            expect(fillSprite.size.x).toBeCloseTo(100, 0);
            expect(fillSprite.size.y).toBeCloseTo(20, 0);

            // Verify handle got correct size
            const handleW = module.getUIRectComputedWidth(registry, handle);
            const handleH = module.getUIRectComputedHeight(registry, handle);
            expect(handleW).toBeCloseTo(20, 0);
            expect(handleH).toBeCloseTo(20, 0);

            // Verify render order
            const sliderLayer = registry.getSprite(slider).layer;
            const fillLayer = registry.getSprite(fill).layer;
            const handleLayer = registry.getSprite(handle).layer;
            expect(fillLayer).toBeGreaterThan(sliderLayer);
            expect(handleLayer).toBeGreaterThan(sliderLayer);

            disposeApp(app, registry);
        });

        it('should handle two sliders at different positions', async () => {
            const { app, registry } = createEditorApp();
            const world = app.world;

            const canvasRoot = world.spawn();
            world.insert(canvasRoot, Canvas, {});
            world.insert(canvasRoot, UIRect, makeFullRect());
            world.insert(canvasRoot, Transform, makeTransform());

            function createEditorSlider(yOffset: number, value: number) {
                const bg = world.spawn();
                world.setParent(bg, canvasRoot);
                world.insert(bg, UIRect, {
                    anchorMin: { x: 0.5, y: 0.5 },
                    anchorMax: { x: 0.5, y: 0.5 },
                    offsetMin: { x: 0, y: 0 },
                    offsetMax: { x: 0, y: 0 },
                    size: { x: 200, y: 20 },
                    pivot: { x: 0.5, y: 0.5 },
                });
                world.insert(bg, Transform, {
                    position: { x: 0, y: yOffset, z: 0 },
                    rotation: { x: 0, y: 0, z: 0, w: 1 },
                    scale: { x: 1, y: 1, z: 1 },
                });
                world.insert(bg, Sprite, makeSprite(200, 8));

                const fill = world.spawn();
                world.setParent(fill, bg);
                world.insert(fill, UIRect, {
                    anchorMin: { x: 0, y: 0 },
                    anchorMax: { x: value, y: 1 },
                    offsetMin: { x: 0, y: 0 },
                    offsetMax: { x: 0, y: 0 },
                    size: { x: 100, y: 100 },
                    pivot: { x: 0.5, y: 0.5 },
                });
                world.insert(fill, Transform, makeTransform());
                world.insert(fill, Sprite, makeSprite(200, 8));

                const handle = world.spawn();
                world.setParent(handle, bg);
                world.insert(handle, UIRect, {
                    anchorMin: { x: value, y: 0 },
                    anchorMax: { x: value, y: 1 },
                    offsetMin: { x: 0, y: 0 },
                    offsetMax: { x: 0, y: 0 },
                    size: { x: 20, y: 20 },
                    pivot: { x: 0.5, y: 0.5 },
                });
                world.insert(handle, Transform, makeTransform());
                world.insert(handle, Sprite, makeSprite(20, 20));

                return { bg, fill, handle };
            }

            const slider1 = createEditorSlider(50, 0.3);
            const slider2 = createEditorSlider(-50, 0.7);

            // Apply fill states (like editor does after load)
            applyDirectionalFill(world, slider1.fill, FillDirection.LeftToRight, 0.3);
            applyDirectionalFill(world, slider2.fill, FillDirection.LeftToRight, 0.7);

            setCanvasRect(app, -400, -300, 400, 300);
            await app.tick(1 / 60);

            // Slider 1: fill = 30% of 200 = 60
            const fill1W = module.getUIRectComputedWidth(registry, slider1.fill);
            expect(fill1W).toBeCloseTo(60, 0);
            expect(module.getUIRectComputedHeight(registry, slider1.fill)).toBeCloseTo(20, 0);

            // Slider 2: fill = 70% of 200 = 140
            const fill2W = module.getUIRectComputedWidth(registry, slider2.fill);
            expect(fill2W).toBeCloseTo(140, 0);
            expect(module.getUIRectComputedHeight(registry, slider2.fill)).toBeCloseTo(20, 0);

            // Both fills should have positive sprite sizes
            const fill1Sprite = registry.getSprite(slider1.fill);
            const fill2Sprite = registry.getSprite(slider2.fill);
            expect(fill1Sprite.size.x).toBeGreaterThan(0);
            expect(fill2Sprite.size.x).toBeGreaterThan(0);

            // Both handles should be visible
            const handle1Sprite = registry.getSprite(slider1.handle);
            const handle2Sprite = registry.getSprite(slider2.handle);
            expect(handle1Sprite.size.x).toBeCloseTo(20, 0);
            expect(handle2Sprite.size.x).toBeCloseTo(20, 0);

            // Both bgs should be rendered
            expect(registry.getSprite(slider1.bg).size.x).toBeCloseTo(200, 0);
            expect(registry.getSprite(slider2.bg).size.x).toBeCloseTo(200, 0);

            disposeApp(app, registry);
        });
    });
});
