/**
 * Integration test: verify SliderPlugin system produces correct fill layout.
 * This uses the actual SliderPlugin (not just applyDirectionalFill) to
 * catch system ordering issues.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform, Sprite } from '../src/component';
import { UIRect } from '../src/ui/UIRect';
import { ScreenSpace } from '../src/ui/ScreenSpace';
import { UICameraInfo } from '../src/ui/UICameraInfo';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/UIEvents';
import { uiLayoutPlugin } from '../src/ui/UILayoutPlugin';
import { uiRenderOrderPlugin } from '../src/ui/UIRenderOrderPlugin';
import { uiInteractionPlugin } from '../src/ui/UIInteractionPlugin';
import { sliderPlugin } from '../src/ui/SliderPlugin';
import { Slider, FillDirection } from '../src/ui/Slider';
import type { SliderData } from '../src/ui/Slider';
import type { UIRectData } from '../src/ui/UIRect';
import type { SpriteData, TransformData } from '../src/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';
import type { Entity } from '../src/types';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('SliderPlugin system integration', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createFullApp(): { app: App; registry: CppRegistry } {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);

        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0,
            screenW: 0, screenH: 0,
            worldLeft: -100, worldBottom: -100, worldRight: 100, worldTop: 100,
            worldMouseX: 0, worldMouseY: 0,
            valid: true,
        });
        app.insertResource(Input, new InputState());
        app.insertResource(UIEvents, new UIEventQueue());

        app.addPlugin(uiLayoutPlugin);
        app.addPlugin(uiRenderOrderPlugin);
        app.addPlugin(uiInteractionPlugin);
        app.addPlugin(sliderPlugin);

        return { app, registry };
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

    it('SliderPlugin should produce left-aligned fill (value=0.5)', () => {
        const { app, registry } = createFullApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, ScreenSpace, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, makeTransform());

        const sliderBg = world.spawn();
        world.setParent(sliderBg, root);
        world.insert(sliderBg, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 200, y: 20 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(sliderBg, Transform, makeTransform());
        world.insert(sliderBg, Sprite, makeSprite(200, 20));

        const fill = world.spawn();
        world.setParent(fill, sliderBg);
        world.insert(fill, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(fill, Transform, makeTransform());
        world.insert(fill, Sprite, makeSprite(200, 20));

        const handle = world.spawn();
        world.setParent(handle, sliderBg);
        world.insert(handle, UIRect, {
            anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 20, y: 20 }, pivot: { x: 0.5, y: 0.5 },
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

        for (let i = 0; i < 3; i++) {
            app.tick(1 / 60);
        }

        // Run TransformSystem to compute worldPositions (normally done by renderer)
        module.transform_update(registry);

        const fillT = world.get(fill, Transform) as TransformData;
        const fillS = world.get(fill, Sprite) as SpriteData;
        const fillR = world.get(fill, UIRect) as UIRectData;
        const bgT = world.get(sliderBg, Transform) as TransformData;

        console.log('\n=== After SliderPlugin + TransformSystem ===');
        console.log('slider bg position:', bgT.position.x, bgT.position.y);
        console.log('slider bg worldPosition:', bgT.worldPosition.x, bgT.worldPosition.y);
        console.log('fill position:', fillT.position.x, fillT.position.y);
        console.log('fill worldPosition:', fillT.worldPosition.x, fillT.worldPosition.y);
        console.log('fill sprite.size:', fillS.size.x, fillS.size.y);
        console.log('fill UIRect anchors:', fillR.anchorMin.x, fillR.anchorMin.y, '->', fillR.anchorMax.x, fillR.anchorMax.y);

        expect(fillS.size.x).toBeCloseTo(100, 0);
        expect(fillT.position.x).toBeCloseTo(-50, 0);

        // Verify worldPosition is correct (this is what the renderer uses)
        expect(bgT.worldPosition.x).toBeCloseTo(0, 0);
        expect(fillT.worldPosition.x).toBeCloseTo(-50, 0);

        // Simulate renderer quad computation
        const left = fillT.worldPosition.x - fillS.size.x * 0.5;
        const right = fillT.worldPosition.x + fillS.size.x * 0.5;
        const parentLeft = bgT.worldPosition.x - 100;
        const parentRight = bgT.worldPosition.x + 100;

        console.log('fill quad bounds: [', left, ',', right, ']');
        console.log('parent quad bounds: [', parentLeft, ',', parentRight, ']');

        // Fill left edge must align with parent left edge
        expect(left).toBeCloseTo(parentLeft, 0);
        // Fill right edge must be at parent center (50% fill)
        expect(right).toBeCloseTo(0, 0);

        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as any).delete();
    });

    it('full pipeline: UILayout → SliderPlugin → UILayoutLate → TransformSystem', () => {
        const { app, registry } = createFullApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, ScreenSpace, {});
        world.insert(root, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(root, Transform, makeTransform());

        const sliderBg = world.spawn();
        world.setParent(sliderBg, root);
        world.insert(sliderBg, UIRect, {
            anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 200, y: 20 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(sliderBg, Transform, makeTransform());
        world.insert(sliderBg, Sprite, makeSprite(200, 20));

        const fill = world.spawn();
        world.setParent(fill, sliderBg);
        world.insert(fill, UIRect, {
            anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 },
        });
        world.insert(fill, Transform, makeTransform());
        world.insert(fill, Sprite, makeSprite(200, 20));

        world.insert(sliderBg, Slider, {
            value: 0,
            minValue: 0,
            maxValue: 1,
            direction: FillDirection.LeftToRight,
            fillEntity: fill,
            handleEntity: 0 as Entity,
            wholeNumbers: false,
        });

        const testValues = [0, 0.25, 0.5, 0.75, 1.0];
        for (const value of testValues) {
            world.insert(sliderBg, Slider, {
                value,
                minValue: 0,
                maxValue: 1,
                direction: FillDirection.LeftToRight,
                fillEntity: fill,
                handleEntity: 0 as Entity,
                wholeNumbers: false,
            });

            app.tick(1 / 60);
            module.transform_update(registry);

            const fillT = world.get(fill, Transform) as TransformData;
            const fillS = world.get(fill, Sprite) as SpriteData;
            const bgT = world.get(sliderBg, Transform) as TransformData;

            const expectedWidth = 200 * value;
            const expectedPosX = value > 0 ? -(200 - expectedWidth) / 2 : 0;

            // Simulate renderer quad computation
            const quadLeft = fillT.worldPosition.x - fillS.size.x * 0.5;
            const quadRight = fillT.worldPosition.x + fillS.size.x * 0.5;
            const parentLeft = bgT.worldPosition.x - 100;

            console.log(`\nvalue=${value}: pos.x=${fillT.position.x}, worldPos.x=${fillT.worldPosition.x}, sprite.size.x=${fillS.size.x}, quad=[${quadLeft}, ${quadRight}], parentLeft=${parentLeft}`);

            expect(fillS.size.x).toBeCloseTo(expectedWidth, 0);
            if (value > 0) {
                expect(fillT.position.x).toBeCloseTo(expectedPosX, 0);
                expect(fillT.worldPosition.x).toBeCloseTo(expectedPosX, 0);
                // Fill quad left edge must align with parent left edge
                expect(quadLeft).toBeCloseTo(parentLeft, 0);
            }
        }

        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as any).delete();
    });
});
