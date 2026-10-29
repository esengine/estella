// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `Camera` and `RichText`, and the two kinds of place a touch has, against the real engine.
 *
 * A camera's settings are the engine camera's under Cocos's names; its conversions go through the UI camera, so a touch's SCREEN
 * point (`getLocation`) converts to the world point under the finger and back. A `RichText` is a `Text` with markup on, and the
 * markup is the engine's parser's to read.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { Camera as EngineCamera, Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { InputState } from '../../src/input/input';
import { Text } from '../../src/ui/core/text';
import { parseRichText } from '../../src/ui/text/rich-text-parser';
import { resetClassRegistry } from '../../src/cocos/registry';
import { declareBuiltinScripts } from '../../src/cocos/builtinScripts';
import { Camera, Color, EventTouch, Node, RichText, UITransform, Vec3, pumpTouches, setCurrentWorld } from '../../src/cocos';
import { setUiCameraData } from '../../src/cocos/ui/screen';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

// An orthographic view 800 x 600 pixels showing world x in -400..400, y in -300..300: the screen point (400, 300) is the world origin.
const toWorld = (glX: number, glY: number) => ({ x: glX - 400, y: glY - 300 });
vi.mock('../../src/ui/util/ui-pick', () => ({ screenToUiWorld: (_cam: unknown, glX: number, glY: number) => toWorld(glX, glY) }));
vi.mock('../../src/ui/util/math', async (orig) => {
    const real = await orig<typeof import('../../src/ui/util/math')>();
    return { ...real, projectWorldPoint: (wx: number, wy: number) => ({ x: wx + 400, y: wy + 300, clipW: 1 }) };
});

describe.skipIf(!HAS_WASM)('Camera, RichText and touch locations', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let app: App | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => {
        setUiCameraData(null);
        setCurrentWorld(null);
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    function boot(): void {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareBuiltinScripts();
        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        setUiCameraData({ valid: true, screenH: 600, viewProjection: new Float32Array(16), vpX: 0, vpY: 0, vpW: 800, vpH: 600 } as never);
    }
    const node = (name: string): Node => { const n = new Node(name); app!.world.insert(n._entity, Transform); return n; };

    describe('Camera', () => {
        it('is the engine camera under Cocos\'s names', () => {
            boot();
            const n = node('cam');
            const cam = n.addComponent(Camera)!;
            expect(app!.world.has(n._entity, EngineCamera)).toBe(true);
            cam.orthoHeight = 320;
            cam.fov = 50;
            cam.near = 2;
            cam.far = 500;
            cam.priority = 3;
            cam.visibility = 0b1010;
            const d = app!.world.get(n._entity, EngineCamera);
            expect([d.orthoSize, d.fov, d.nearPlane, d.farPlane, d.priority, d.cullingMask]).toEqual([320, 50, 2, 500, 3, 10]);
            expect([cam.orthoHeight, cam.visibility]).toEqual([320, 10]);
        });

        it('numbers the projection kinds the way Cocos does, the other way round from the engine', () => {
            boot();
            const n = node('cam');
            const cam = n.addComponent(Camera)!;
            cam.projection = Camera.ProjectionType.ORTHO;
            expect(app!.world.get(n._entity, EngineCamera).projectionType).toBe(1);
            expect(cam.projection).toBe(Camera.ProjectionType.ORTHO);
            cam.projection = Camera.ProjectionType.PERSPECTIVE;
            expect(app!.world.get(n._entity, EngineCamera).projectionType).toBe(0);
            expect(cam.projection).toBe(Camera.ProjectionType.PERSPECTIVE);
        });

        it('maps the viewport to rect and the active flag to enabled', () => {
            boot();
            const n = node('cam');
            const cam = n.addComponent(Camera)!;
            cam.rect = { x: 0.25, y: 0, width: 0.5, height: 1 } as never;
            const v = app!.world.get(n._entity, EngineCamera).viewport;
            expect([v.x, v.y, v.z, v.w]).toEqual([0.25, 0, 0.5, 1]);
            cam.enabled = false;
            expect(app!.world.get(n._entity, EngineCamera).isActive).toBe(false);
        });

        it('converts a screen point to the world under it, and back', () => {
            boot();
            const cam = node('cam').addComponent(Camera)!;
            const world = cam.screenToWorld(new Vec3(500, 350, 0));
            expect([world.x, world.y]).toEqual([100, 50]);
            const screen = cam.worldToScreen(new Vec3(100, 50, 0));
            expect([screen.x, screen.y]).toEqual([500, 350]);
        });

        it('keeps a clear colour a script set, without applying it', () => {
            boot();
            const cam = node('cam').addComponent(Camera)!;
            cam.clearColor = new Color(10, 20, 30, 255);
            expect([cam.clearColor.r, cam.clearColor.g, cam.clearColor.b]).toEqual([10, 20, 30]);
        });

        it('converts a world point into a node\'s own space', () => {
            boot();
            const cam = node('cam').addComponent(Camera)!;
            const panel = node('panel');
            panel.addComponent(UITransform)!.setContentSize(100, 100);
            panel.setPosition(200, 100, 0);
            const local = cam.convertToUINode(new Vec3(230, 90, 0), panel);
            expect([local.x, local.y]).toEqual([30, -10]);
        });
    });

    describe('touch locations', () => {
        it('gives the screen point from getLocation and the canvas point from getUILocation', () => {
            boot();
            const input = new InputState();
            const seen: Array<{ screen: number[]; ui: number[] }> = [];
            const n = node('target');
            n.addComponent(UITransform)!.setContentSize(2000, 2000);
            n.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
                seen.push({ screen: [e.getLocationX(), e.getLocationY()], ui: [e.getUILocationX(), e.getUILocationY()] });
            });
            // a pointer at CSS (500, 250) with the surface 600 high: GL y = 600 - 250 = 350
            const p = { id: 1, x: 500, y: 250 };
            input.touches.set(1, p);
            input.touchesStarted.set(1, p);
            pumpTouches(app!.world, input, { valid: true, screenH: 600 } as never);
            expect(seen).toEqual([{ screen: [500, 350], ui: [100, 50] }]);
        });

        it('hands a camera the touch\'s screen point and gets the canvas point back', () => {
            boot();
            const cam = node('cam').addComponent(Camera)!;
            const input = new InputState();
            let converted: Vec3 | null = null;
            const n = node('target');
            n.addComponent(UITransform)!.setContentSize(2000, 2000);
            n.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
                const l = e.getLocation();
                converted = cam.screenToWorld(new Vec3(l.x, l.y, 0));
                expect(converted.x).toBe(e.getUILocationX());
                expect(converted.y).toBe(e.getUILocationY());
            });
            const p = { id: 1, x: 120, y: 80 };
            input.touches.set(1, p);
            input.touchesStarted.set(1, p);
            pumpTouches(app!.world, input, { valid: true, screenH: 600 } as never);
            expect(converted).not.toBeNull();
        });
    });

    describe('RichText', () => {
        it('is a Text with markup on, found as a RichText and writes its string through', () => {
            boot();
            const n = node('rich');
            const rt = n.addComponent(RichText)!;
            expect(app!.world.get(n._entity, Text).richText).toBe(true);
            rt.string = '<color=red>hit</color><br/><size=40>big</size>';
            expect(app!.world.get(n._entity, Text).content).toBe('<color=red>hit</color><br/><size=40>big</size>');
            expect(n.getComponent(RichText)).toBe(rt);
        });

        it('hands the engine\'s parser the markup it writes, and the parser reads it', () => {
            const runs = parseRichText('<color=red>hit</color><br/><size=40>big</size>');
            const text = runs.map((r) => (r.type === 'text' ? r.text : '')).join('');
            expect(text).toBe('hit\nbig');
        });

        it('keeps line height in pixels across a size change, and wraps at maxWidth when it is set', () => {
            boot();
            const n = node('rich');
            const rt = n.addComponent(RichText)!;
            rt.fontSize = 20;
            rt.lineHeight = 30;
            rt.fontSize = 40;
            expect(rt.lineHeight).toBeCloseTo(30, 5);
            expect(rt.maxWidth).toBe(0);
            rt.maxWidth = 300;
            const t = app!.world.get(n._entity, Text);
            expect([t.wordWrap, t.boxWidth]).toEqual([true, 300]);
            expect(rt.maxWidth).toBe(300);
            rt.maxWidth = 0;
            expect(app!.world.get(n._entity, Text).wordWrap).toBe(false);
        });

        it('reads a plain Text that is not rich as no RichText', () => {
            boot();
            const n = node('plain');
            app!.world.insert(n._entity, Text, {});
            expect(n.getComponent(RichText)).toBeNull();
        });
    });
});
