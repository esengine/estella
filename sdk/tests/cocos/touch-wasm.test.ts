// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Touches on nodes, and `Button`, against the real engine.
 *
 * What a Cocos script cannot be told is wrong, and what is pinned: a touch is claimed at its start by the TOPMOST node that listens and
 * holds the point; the rest of the gesture goes to that node wherever the finger goes; the event bubbles up the ancestors, nearest
 * first, until one stops it; and a button clicks when a touch ends INSIDE it, and not otherwise.
 *
 * The camera is faked as the identity (a screen pixel is a world unit, y flipped), so the geometry in the tests is the geometry on screen.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { InputState } from '../../src/input/input';
import { resetClassRegistry } from '../../src/cocos/registry';
import {
    Button, Component, EventHandler, EventTouch, Node, NodeEventType, UITransform, Vec2, _decorator, pumpTouches, setCurrentWorld,
} from '../../src/cocos';
import { declareButton } from '../../src/cocos/ui/button';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

// A screen pixel is a world unit: the GL y is the surface height minus the screen y.
vi.mock('../../src/ui/util/ui-pick', () => ({ screenToUiWorld: (_cam: unknown, glX: number, glY: number) => ({ x: glX, y: glY }) }));

const SURFACE_H = 800;
const camera = { valid: true, screenH: SURFACE_H } as never;

describe.skipIf(!HAS_WASM)('touches and buttons on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let app: App | undefined;
    let input: InputState;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });

    function connect(): void {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareButton();
        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        input = new InputState();
    }
    afterEach(() => {
        setCurrentWorld(null);
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    const W = () => app!.world;

    /** A node of @p w by @p h whose centre is at (x, y). */
    function box(name: string, x: number, y: number, w = 100, h = 100, parent?: Node): Node {
        const n = new Node(name);
        W().insert(n._entity, Transform);
        n.addComponent(UITransform)!.setContentSize(w, h);
        n.setPosition(x, y, 0);
        parent?.addChild(n);
        return n;
    }

    // ---- driving the pointers by hand ----------------------------------------------------------------------------------
    const screenOf = (wx: number, wy: number): { x: number; y: number } => ({ x: wx, y: SURFACE_H - wy });
    function pump(): void { pumpTouches(W(), input, camera); input.touchesStarted.clear(); input.touchesEnded.clear(); }
    function press(id: number, wx: number, wy: number): void {
        const p = { id, ...screenOf(wx, wy) };
        input.touches.set(id, p);
        input.touchesStarted.set(id, p);
        pump();
    }
    function move(id: number, wx: number, wy: number): void { input.touches.set(id, { id, ...screenOf(wx, wy) }); pump(); }
    function release(id: number, wx: number, wy: number): void {
        const p = { id, ...screenOf(wx, wy) };
        input.touches.delete(id);
        input.touchesEnded.set(id, p);
        pump();
    }

    function record(node: Node, log: string[], tag = node.name): void {
        for (const type of [NodeEventType.TOUCH_START, NodeEventType.TOUCH_MOVE, NodeEventType.TOUCH_END]) {
            node.on(type, (e: EventTouch) => log.push(`${tag}:${type.replace('touch-', '')}@${Math.round(e.getUILocationX())},${Math.round(e.getUILocationY())}`));
        }
    }

    it('tells a node about a touch that starts, moves and ends on it, with where each happened', () => {
        connect();
        const a = box('a', 200, 200);
        const log: string[] = [];
        record(a, log);
        press(1, 210, 190);
        move(1, 230, 190);
        release(1, 230, 190);
        expect(log).toEqual(['a:start@210,190', 'a:move@230,190', 'a:end@230,190']);
    });

    it('says nothing to a node the touch missed', () => {
        connect();
        const a = box('a', 200, 200);
        const log: string[] = [];
        record(a, log);
        press(1, 400, 400);
        release(1, 400, 400);
        expect(log).toEqual([]);
    });

    it('hands the touch to the topmost of two overlapping nodes: the later sibling', () => {
        connect();
        const root = box('root', 0, 0, 1000, 1000);
        const under = box('under', 200, 200, 100, 100, root);
        const over = box('over', 220, 200, 100, 100, root);
        const log: string[] = [];
        record(under, log);
        record(over, log);
        press(1, 210, 200);   // inside both
        release(1, 210, 200);
        expect(log.every((l) => l.startsWith('over:'))).toBe(true);
        expect(log).toHaveLength(2);
    });

    it('keeps sending the gesture to the node that claimed it, wherever the finger goes', () => {
        connect();
        const a = box('a', 200, 200);
        const b = box('b', 600, 200);
        const log: string[] = [];
        record(a, log);
        record(b, log);
        press(1, 200, 200);
        move(1, 600, 200);       // over b, but a has the touch
        release(1, 600, 200);
        expect(log.map((l) => l.split('@')[0])).toEqual(['a:start', 'a:move', 'a:end']);
    });

    it('bubbles to the ancestors nearest first, and stops where a listener says so', () => {
        connect();
        const parent = box('parent', 300, 300, 400, 400);
        const child = box('child', 0, 0, 100, 100, parent);
        const grand = box('grand', 300, 300, 400, 400);
        const order: string[] = [];
        child.on(NodeEventType.TOUCH_START, () => order.push('child'));
        parent.on(NodeEventType.TOUCH_START, () => order.push('parent'));
        press(1, 300, 300);
        release(1, 300, 300);
        expect(order).toEqual(['child', 'parent']);

        order.length = 0;
        child.targetOff(undefined);
        child.on(NodeEventType.TOUCH_START, (e: EventTouch) => { order.push('child2'); e.stopPropagation(); });
        press(2, 300, 300);
        release(2, 300, 300);
        expect(order).toContain('child2');
        expect(order).not.toContain('parent');
        void grand;
    });

    it('does not tell a switched-off node, or one under a switched-off parent', () => {
        connect();
        const parent = box('parent', 200, 200, 300, 300);
        const child = box('child', 0, 0, 100, 100, parent);
        const log: string[] = [];
        record(child, log);
        parent.active = false;
        press(1, 200, 200);
        release(1, 200, 200);
        expect(log).toEqual([]);
    });

    it('gives the event its target and current target, and reads back a delta', () => {
        connect();
        const parent = box('parent', 200, 200, 300, 300);
        const child = box('child', 0, 0, 100, 100, parent);
        const seen: Array<{ target: string; current: string; dx?: number }> = [];
        child.on(NodeEventType.TOUCH_START, () => {});
        parent.on(NodeEventType.TOUCH_START, (e: EventTouch) => seen.push({ target: e.target!.name, current: e.currentTarget!.name }));
        child.on(NodeEventType.TOUCH_MOVE, (e: EventTouch) => seen.push({ target: 'm', current: 'm', dx: e.getDelta().x }));
        press(1, 200, 200);
        move(1, 215, 200);
        expect(seen[0]).toEqual({ target: 'child', current: 'parent' });
        expect(seen[1]!.dx).toBe(15);
    });

    // ---- Button ----------------------------------------------------------------------------------------------------

    /** Defined per test: the registry is reset when the engine connects, which would forget a class decorated at load. */
    function defineTarget() {
        @_decorator.ccclass('Target')
        class Target extends Component {
            calls: unknown[][] = [];
            onClicked(_event: unknown, data: string): void { this.calls.push([data]); }
        }
        return Target;
    }

    async function button(x = 200, y = 200): Promise<{ node: Node; button: Button }> {
        const node = box('btn', x, y);
        const b = node.addComponent<Button>('Button')!;
        await app!.tick(1 / 60);   // onEnable registers the listeners
        return { node, button: b };
    }

    it('clicks when a touch ends inside it: the node event, and the authored handlers with their custom data', async () => {
        connect();
        const holder = box('holder', 0, 0);
        const Target = defineTarget();
        const t = holder.addComponent(Target)!;
        const { node, button: b } = await button();
        const handler = new EventHandler();
        handler.target = holder; handler.component = 'Target'; handler.handler = 'onClicked'; handler.customEventData = 'buy';
        b.clickEvents = [handler];
        let clicked = 0;
        node.on(Button.EventType.CLICK, () => clicked++);
        press(1, 205, 205);
        release(1, 195, 195);
        expect(clicked).toBe(1);
        expect(t.calls).toEqual([['buy']]);
    });

    it('does not click when the touch ends outside, or when the button is not interactable', async () => {
        connect();
        const { node, button: b } = await button();
        let clicked = 0;
        node.on(Button.EventType.CLICK, () => clicked++);
        press(1, 200, 200);
        release(1, 500, 500);   // dragged off and let go
        expect(clicked).toBe(0);
        b.interactable = false;
        press(2, 200, 200);
        release(2, 200, 200);
        expect(clicked).toBe(0);
    });

    it('swallows the touch, so a node behind it does not also hear it', async () => {
        connect();
        const behind = box('behind', 200, 200, 300, 300);
        const log: string[] = [];
        record(behind, log);
        await button();
        press(1, 200, 200);
        release(1, 200, 200);
        expect(log).toEqual([]);
    });

    it('zooms its node while pressed, with the SCALE transition, and puts it back', async () => {
        connect();
        const { node, button: b } = await button();
        b.transition = Button.Transition.SCALE;
        b.zoomScale = 1.5;
        node.setScale(2, 2, 1);
        press(1, 200, 200);
        expect(node.scale.x).toBeCloseTo(3, 5);
        release(1, 200, 200);
        expect(node.scale.x).toBeCloseTo(2, 5);
    });

    it('stops listening when disabled', async () => {
        connect();
        const { node, button: b } = await button();
        let clicked = 0;
        node.on(Button.EventType.CLICK, () => clicked++);
        b.enabled = false;
        await app!.tick(1 / 60);   // the host sees the change and calls onDisable
        press(1, 200, 200);
        release(1, 200, 200);
        expect(clicked).toBe(0);
        void Vec2;
    });
});
