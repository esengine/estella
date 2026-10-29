// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The two places a touch has: the screen point (`getLocation`) and the canvas point (`getUILocation`).
 *
 * Through the engine's real pointer pipeline, with a camera that puts the world origin 400 pixels right of and 300 above the surface's
 * bottom-left corner, so the two are different numbers and a mix-up shows.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { Camera, EventTouch, Node, UITransform, Vec3 } from '../../src/cocos';
import { setUiCameraData } from '../../src/cocos/ui/screen';
import { UICameraInfo } from '../../src/ui/core/ui-camera-info';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';
import { pointerApp, type PointerApp } from './helpers/pointerApp';

describe.skipIf(!HAS_WASM)('touch locations', () => {
    let module: ESEngineModule;
    let P: PointerApp | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => { P?.dispose(); P = undefined; setUiCameraData(null); });

    function boot(): void {
        P = pointerApp(module, { x: 400, y: 300 });
        // the frame loop hands a camera the live UI camera data; this app has no pass that does, so do it directly
        setUiCameraData(P.app.getResource(UICameraInfo));
    }
    const node = (name: string): Node => { const n = new Node(name); P!.app.world.insert(n._entity, Transform); return n; };

    it('gives the screen point from getLocation and the canvas point from getUILocation', async () => {
        boot();
        const seen: Array<{ screen: number[]; ui: number[] }> = [];
        const n = node('target');
        n.addComponent(UITransform)!.setContentSize(2000, 2000);
        n.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            seen.push({ screen: [e.getLocationX(), e.getLocationY()], ui: [e.getUILocationX(), e.getUILocationY()] });
        });
        await P!.press(100, 50);   // world (100, 50): the surface point (500, 350)
        expect(seen).toHaveLength(1);
        expect(seen[0]!.ui[0]).toBeCloseTo(100, 2);
        expect(seen[0]!.ui[1]).toBeCloseTo(50, 2);
        expect(seen[0]!.screen[0]).toBeCloseTo(500, 2);
        expect(seen[0]!.screen[1]).toBeCloseTo(350, 2);
    });

    it('hands a camera the screen point of the touch and gets the canvas point back', async () => {
        boot();
        const cam = node('cam').addComponent(Camera)!;
        const n = node('target');
        n.addComponent(UITransform)!.setContentSize(2000, 2000);
        let checked = 0;
        n.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            const l = e.getLocation();
            const world = cam.screenToWorld(new Vec3(l.x, l.y, 0));
            expect(world.x).toBeCloseTo(e.getUILocationX(), 2);
            expect(world.y).toBeCloseTo(e.getUILocationY(), 2);
            checked++;
        });
        await P!.press(120, 80);
        expect(checked).toBe(1);
    });
});
