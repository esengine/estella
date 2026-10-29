// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a pointer tells the entity it presses: where, which pointer, and what it does next.
 *
 * The UI interaction system already picks the topmost interactable under a pointer, lets that entity hold the gesture, and bubbles
 * what happens to it. These pin the parts a touch-style consumer needs on top: a rectangle-only entity can be the one picked, every
 * pointer event says where the pointer is, a held entity hears the pointer move, and a hold can be given up (nothing clicks).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { EntityEvents } from '../src/ecs/entityEvents';
import { Input, InputState } from '../src/input/input';
import { Transform } from '../src/ecs/component';
import { ContentRect } from '../src/ui/core/content-rect';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { UIEventType } from '../src/ui/core/events';
import { UILayoutGeneration } from '../src/ui/layout/ui-layout-generation';
import { Interactable } from '../src/ui/input/interactable';
import { UIControlPointers, type UiPointerEventData } from '../src/ui/input/control-pointers';
import { uiInteractionPlugin } from '../src/ui/input/interaction';
import { registerComponent } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('pointer events (WASM integration)', () => {
    let module: ESEngineModule;
    let app: App | undefined;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;

    beforeAll(async () => { module = await loadWasmModule(); });
    afterEach(() => {
        if (app) uiInteractionPlugin.cleanup(app);
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    /** A 100 x 100 view: world x and y run from -50 to 50, and a pointer at CSS (50, 50) is the origin. */
    function boot(): { app: App; input: InputState; events: InstanceType<typeof import('../src/ecs/entityEvents').EntityEventQueue> } {
        setDefaultContext(new AppContext());
        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry, module);
        const input = new InputState();
        app.insertResource(Input, input);
        const projection = new Float32Array([.02, 0, 0, 0, 0, .02, 0, 0, 0, 0, -.001, 0, 0, 0, 0, 1]);
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, viewProjection: projection, vpW: 100, vpH: 100, screenW: 100, screenH: 100, valid: true });
        app.insertResource(UILayoutGeneration, { generation: 0 });
        registerComponent('ContentRect', ContentRect);
        uiInteractionPlugin.build(app);
        flushPendingRegistrations(app);
        return { app, input, events: app.getResource(EntityEvents) as never };
    }

    /** An entity that is only a rectangle: nothing to draw, so no sprite to take a box from. */
    function area(a: App, x: number, y: number, w: number, h: number, blockRaycast = true): Entity {
        const e = a.world.spawn('area');
        a.world.insert(e, Transform, { position: { x, y, z: 0 } });
        a.world.insert(e, ContentRect, { size: { x: w, y: h }, pivot: { x: 0.5, y: 0.5 } });
        a.world.insert(e, Interactable, { blockRaycast });
        return e;
    }

    /** One frame with the mouse at CSS (x, y) and the button as given. */
    async function frame(a: App, input: InputState, x: number, y: number, press?: 'down' | 'up'): Promise<void> {
        input.mouseX = x;
        input.mouseY = y;
        input.mouseButtonsPressed.clear();
        input.mouseButtonsReleased.clear();
        if (press === 'down') input.noteMouseDown(0);
        if (press === 'up') input.noteMouseUp(0);
        a.world.ensureTransformsComposed();
        await a.tick(1 / 60);
    }

    it('lets an entity that is only a rectangle be the one pressed', async () => {
        const { app: a, input, events } = boot();
        const hit = area(a, 0, 0, 40, 20);
        const seen: UiPointerEventData[] = [];
        events.on(hit, UIEventType.Press, (e) => seen.push(e.data as UiPointerEventData));
        await frame(a, input, 50, 50, 'down');
        expect(seen).toHaveLength(1);
        // and outside its rectangle it is not
        await frame(a, input, 50, 50, 'up');
        const miss: unknown[] = [];
        events.on(hit, UIEventType.Press, (e) => miss.push(e));
        await frame(a, input, 5, 5, 'down');
        expect(miss).toHaveLength(0);
    });

    it('says where the pointer is in every event: which pointer, and its world and surface position', async () => {
        const { app: a, input, events } = boot();
        const hit = area(a, 0, 0, 100, 100);
        const log: Array<{ type: string; data: UiPointerEventData }> = [];
        for (const type of [UIEventType.Press, UIEventType.Release, UIEventType.Click]) {
            events.on(hit, type, (e) => log.push({ type: e.type, data: e.data as UiPointerEventData }));
        }
        await frame(a, input, 75, 25, 'down');   // right of centre by 25, above it by 25
        await frame(a, input, 75, 25, 'up');
        expect(log.map((l) => l.type)).toEqual([UIEventType.Press, UIEventType.Release, UIEventType.Click]);
        const press = log[0]!.data;
        expect(press.pointer).toBe(-1);
        expect(press.worldX).toBeCloseTo(25, 3);
        expect(press.worldY).toBeCloseTo(25, 3);
        // the surface's y is up from the bottom: CSS y 25 of 100 is GL y 75
        expect(press.screenX).toBeCloseTo(75, 3);
        expect(press.screenY).toBeCloseTo(75, 3);
    });

    it('tells the holder when the pointer moves while it is held, and not otherwise', async () => {
        const { app: a, input, events } = boot();
        const hit = area(a, 0, 0, 100, 100);
        const moves: UiPointerEventData[] = [];
        events.on(hit, UIEventType.PointerMove, (e) => moves.push(e.data as UiPointerEventData));
        await frame(a, input, 50, 50);                  // hovering: not a held pointer
        await frame(a, input, 60, 50);
        expect(moves).toHaveLength(0);
        await frame(a, input, 60, 50, 'down');          // the press frame is not a move
        expect(moves).toHaveLength(0);
        await frame(a, input, 60, 50);                  // held, still
        expect(moves).toHaveLength(0);
        await frame(a, input, 70, 50);
        await frame(a, input, 80, 40);
        expect(moves.map((m) => [Math.round(m.worldX), Math.round(m.worldY)])).toEqual([[20, 0], [30, 10]]);
    });

    it('goes on telling the holder when the pointer leaves it: the gesture is the holder\'s', async () => {
        const { app: a, input, events } = boot();
        const hit = area(a, 0, 0, 20, 20);
        const moves: number[] = [];
        events.on(hit, UIEventType.PointerMove, (e) => moves.push((e.data as UiPointerEventData).worldX));
        await frame(a, input, 50, 50, 'down');
        await frame(a, input, 90, 50);                   // far outside the 20 x 20 area
        expect(moves).toHaveLength(1);
        expect(moves[0]).toBeCloseTo(40, 3);
    });

    it('bubbles a move to an ancestor that lets events through', async () => {
        const { app: a, input, events } = boot();
        const parent = area(a, 0, 0, 100, 100, false);
        const child = area(a, 0, 0, 20, 20, false);
        a.world.setParent(child, parent);
        const heard: Array<[Entity, Entity]> = [];
        events.on(parent, UIEventType.PointerMove, (e) => heard.push([e.target, e.currentTarget]));
        await frame(a, input, 50, 50, 'down');
        await frame(a, input, 55, 50);
        expect(heard).toEqual([[child, parent]]);
    });

    it('lets a hold be given up: the holder hears press_cancel, and the lift clicks nothing', async () => {
        const { app: a, input, events } = boot();
        const hit = area(a, 0, 0, 100, 100);
        const log: string[] = [];
        for (const type of [UIEventType.Press, UIEventType.PressCancel, UIEventType.Release, UIEventType.Click, UIEventType.PointerMove]) {
            events.on(hit, type, (e) => log.push(e.type));
        }
        await frame(a, input, 50, 50, 'down');
        a.getResource(UIControlPointers).cancelHold(-1);
        await frame(a, input, 55, 50);                   // moving after the cancel is nobody's move
        await frame(a, input, 55, 50, 'up');
        expect(log).toEqual([UIEventType.Press, UIEventType.PressCancel]);
    });

    it('can hand the hold to another entity, which then hears the moves and the release', async () => {
        const { app: a, input, events } = boot();
        const scroller = area(a, 0, 0, 100, 100);          // made first, so the button — made after it — is the topmost
        const button = area(a, 0, 0, 20, 20);
        a.world.setParent(button, scroller);
        const log: Array<[string, Entity]> = [];
        for (const e of [button, scroller]) {
            for (const type of [UIEventType.PressCancel, UIEventType.PointerMove, UIEventType.Release]) {
                events.on(e, type, (ev) => { if (ev.currentTarget === ev.target) log.push([ev.type, ev.target]); });
            }
        }
        await frame(a, input, 50, 50, 'down');             // the button, the topmost, holds it
        a.getResource(UIControlPointers).cancelHold(-1, scroller);
        await frame(a, input, 60, 50);
        await frame(a, input, 60, 50, 'up');
        expect(log.map(([t, e]) => `${t}:${e === button ? 'button' : 'scroller'}`)).toEqual([
            'press_cancel:button', 'pointer_move:scroller', 'release:scroller',
        ]);   // no click: the pointer lifted over the button, which is not what it held
    });

    it('cancelling a hold that is not there does nothing', async () => {
        const { app: a, input } = boot();
        area(a, 0, 0, 100, 100);
        await frame(a, input, 50, 50);
        expect(() => a.getResource(UIControlPointers).cancelHold(-1)).not.toThrow();
    });
});
