// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The global `input`, the game clock, and the visible size, fed by the real frame loop.
 *
 * A listener on `input` hears every touch, key and mouse event whether or not anything is under the pointer; keys arrive as Cocos
 * key codes; the wheel is reported with Cocos's sign; the game clock advances with the engine's; and the visible size scripts read
 * is what the UI camera shows.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { InputState } from '../../src/input/input';
import { ScreenLayout } from '../../src/ui/core/screen-layout';
import { resetClassRegistry } from '../../src/cocos/registry';
import { declareBuiltinScripts } from '../../src/cocos/builtinScripts';
import { pumpKeysAndMouse } from '../../src/cocos/input';
import type { ControlPointer } from '../../src/ui/input/control-pointers';
import { pointerApp, type PointerApp } from './helpers/pointerApp';
import {
    EventKeyboard, EventMouse, EventTouch, Input, KeyCode, game, input, screen, setCurrentWorld, view,
} from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

/** The mouse as the engine reports it: the world point and the surface point are the same here. */
const mouseAt = (x: number, y: number): ControlPointer => ({ worldX: x, worldY: y, screenX: x, screenY: y }) as never;

describe.skipIf(!HAS_WASM)('input, game and view from the frame loop', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let app: App | undefined;
    let P: PointerApp | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => {
        input.targetOff(undefined);
        for (const t of Object.values(Input.EventType)) input.off(t);
        P?.dispose();
        P = undefined;
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
    }

    it('tells a listener on input about every touch, wherever it lands', async () => {
        P = pointerApp(module);
        const log: string[] = [];
        for (const t of [Input.EventType.TOUCH_START, Input.EventType.TOUCH_MOVE, Input.EventType.TOUCH_END]) {
            input.on(t, (e: EventTouch) => log.push(`${t}@${Math.round(e.getUILocationX())},${Math.round(e.getUILocationY())}`));
        }
        await P.press(300, 200);
        await P.move(320, 200);
        await P.release(320, 200);
        expect(log).toEqual(['touch-start@300,200', 'touch-move@320,200', 'touch-end@320,200']);
    });

    it('turns key state into KEY_DOWN, KEY_PRESSING and KEY_UP with Cocos key codes', () => {
        boot();
        const state = new InputState();
        const log: string[] = [];
        for (const t of [Input.EventType.KEY_DOWN, Input.EventType.KEY_PRESSING, Input.EventType.KEY_UP]) {
            input.on(t, (e: EventKeyboard) => log.push(`${t}:${e.keyCode}:${e.isPressed}`));
        }
        state.noteKeyDown('KeyA');
        pumpKeysAndMouse(state, null);
        state.keysPressed.clear();
        pumpKeysAndMouse(state, null);   // held
        state.noteKeyUp('KeyA');
        pumpKeysAndMouse(state, null);
        expect(log).toEqual([
            `keydown:${KeyCode.KEY_A}:true`,
            `key-pressing:${KeyCode.KEY_A}:true`,
            `keyup:${KeyCode.KEY_A}:false`,
        ]);
    });

    it('turns the mouse into MOUSE_DOWN / MOVE / UP / WHEEL, with the wheel signed as Cocos signs it', () => {
        boot();
        const state = new InputState();
        const log: string[] = [];
        input.on(Input.EventType.MOUSE_DOWN, (e: EventMouse) => log.push(`down:${e.getButton()}@${e.getUILocationX()},${e.getUILocationY()}`));
        input.on(Input.EventType.MOUSE_MOVE, (e: EventMouse) => log.push(`move:${e.getDeltaX()}`));
        input.on(Input.EventType.MOUSE_UP, (e: EventMouse) => log.push(`up:${e.getButton()}`));
        input.on(Input.EventType.MOUSE_WHEEL, (e: EventMouse) => log.push(`wheel:${e.getScrollY()}`));
        pumpKeysAndMouse(state, mouseAt(100, 100));            // the first frame only learns where the mouse is
        state.noteMouseDown(0);
        pumpKeysAndMouse(state, mouseAt(100, 100));
        state.mouseButtonsPressed.clear();
        pumpKeysAndMouse(state, mouseAt(130, 100));
        state.noteMouseUp(0);
        state.scrollDeltaY = 120;                    // the DOM's "down"
        pumpKeysAndMouse(state, mouseAt(130, 100));
        expect(log).toEqual(['down:0@100,100', 'move:30', 'up:0', 'wheel:-120']);
    });

    it('advances the game clock with the engine\'s, and lets a script read it', async () => {
        boot();
        await app!.tick(1 / 60);
        const before = game.totalTime;
        await app!.tick(1 / 60);
        await app!.tick(1 / 60);
        expect(game.deltaTime).toBeCloseTo(1 / 60, 4);
        expect(game.totalTime).toBeGreaterThan(before);
        expect(game.frameStartTime).toBeGreaterThan(0);
    });

    it('takes the visible size and the window from the screen layout', async () => {
        boot();
        app!.insertResource(ScreenLayout, {
            valid: true, left: -640, right: 640, bottom: -360, top: 360, safeLeft: -640, safeRight: 640, safeBottom: -360, safeTop: 360,
            scale: 2, viewportW: 2560, viewportH: 1440,
        } as never);
        await app!.tick(1 / 60);
        expect([view.getVisibleSize().width, view.getVisibleSize().height]).toEqual([1280, 720]);
        expect([screen.windowSize.width, screen.windowSize.height]).toEqual([2560, 1440]);
    });
});
