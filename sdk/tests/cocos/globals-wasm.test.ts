// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The global `input`, the game clock, and the visible size, fed by the real frame loop.
 *
 * A listener on `input` hears every touch, key and mouse event whether or not anything is under the pointer; keys arrive as Cocos
 * key codes; the wheel is reported with Cocos's sign; the game clock advances with the engine's; and the visible size scripts read
 * is what the UI camera shows.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { InputState } from '../../src/input/input';
import { UICameraInfo } from '../../src/ui/core/ui-camera-info';
import { resetClassRegistry } from '../../src/cocos/registry';
import { declareBuiltinScripts } from '../../src/cocos/builtinScripts';
import { pumpKeysAndMouse, pumpTouches } from '../../src/cocos/input';
import {
    EventKeyboard, EventMouse, EventTouch, Input, KeyCode, game, input, screen, setCurrentWorld, view,
} from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

vi.mock('../../src/ui/util/ui-pick', () => ({ screenToUiWorld: (_cam: unknown, glX: number, glY: number) => ({ x: glX, y: glY }) }));

const camera = { valid: true, screenH: 800 } as never;

describe.skipIf(!HAS_WASM)('input, game and view from the frame loop', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let app: App | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => {
        input.targetOff(undefined);
        for (const t of Object.values(Input.EventType)) input.off(t);
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

    it('tells a listener on input about every touch, wherever it lands', () => {
        boot();
        const state = new InputState();
        const log: string[] = [];
        for (const t of [Input.EventType.TOUCH_START, Input.EventType.TOUCH_MOVE, Input.EventType.TOUCH_END]) {
            input.on(t, (e: EventTouch) => log.push(`${t}@${Math.round(e.getUILocationX())},${Math.round(e.getUILocationY())}`));
        }
        const at = (x: number, y: number) => ({ id: 1, x, y: 800 - y });
        state.touches.set(1, at(300, 200)); state.touchesStarted.set(1, at(300, 200));
        pumpTouches(app!.world, state, camera);
        state.touchesStarted.clear();
        state.touches.set(1, at(320, 200));
        pumpTouches(app!.world, state, camera);
        state.touches.delete(1); state.touchesEnded.set(1, at(320, 200));
        pumpTouches(app!.world, state, camera);
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
        pumpKeysAndMouse(state, camera);
        state.keysPressed.clear();
        pumpKeysAndMouse(state, camera);   // held
        state.noteKeyUp('KeyA');
        pumpKeysAndMouse(state, camera);
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
        state.mouseX = 100; state.mouseY = 700;
        pumpKeysAndMouse(state, camera);            // the first frame only learns where the mouse is
        state.noteMouseDown(0);
        pumpKeysAndMouse(state, camera);
        state.mouseButtonsPressed.clear();
        state.mouseX = 130;
        pumpKeysAndMouse(state, camera);
        state.noteMouseUp(0);
        state.scrollDeltaY = 120;                    // the DOM's "down"
        pumpKeysAndMouse(state, camera);
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

    it('takes the visible size and the window from what the UI camera shows', async () => {
        boot();
        app!.insertResource(UICameraInfo, {
            valid: true, worldLeft: -640, worldRight: 640, worldBottom: -360, worldTop: 360, screenW: 2560, screenH: 1440,
        } as never);
        await app!.tick(1 / 60);
        expect([view.getVisibleSize().width, view.getVisibleSize().height]).toEqual([1280, 720]);
        expect([screen.windowSize.width, screen.windowSize.height]).toEqual([2560, 1440]);
    });
});
