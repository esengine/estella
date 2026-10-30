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
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { Button, Component, EventHandler, EventTouch, Node, NodeEventType, UITransform, _decorator } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';
import { pointerApp, type PointerApp } from './helpers/pointerApp';

describe.skipIf(!HAS_WASM)('touches and buttons on the engine', () => {
    let module: ESEngineModule;
    let P: PointerApp | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => { P?.dispose(); P = undefined; });

    function connect(): void { P = pointerApp(module); }
    const app = () => P!.app;
    const W = () => P!.app.world;

    /** A node of @p w by @p h whose centre is at (x, y). */
    function box(name: string, x: number, y: number, w = 100, h = 100, parent?: Node): Node {
        const n = new Node(name);
        W().insert(n._entity, Transform);
        n.addComponent(UITransform)!.setContentSize(w, h);
        n.setPosition(x, y, 0);
        parent?.addChild(n);
        return n;
    }

    // ---- driving the pointers: real frames through the engine's own interaction system ----------------------------------------
    const press = (id: number, x: number, y: number): Promise<void> => P!.press(x, y, id);
    const move = (id: number, x: number, y: number): Promise<void> => P!.move(x, y, id);
    const release = (id: number, x: number, y: number): Promise<void> => P!.release(x, y, id);

    function record(node: Node, log: string[], tag = node.name): void {
        for (const type of [NodeEventType.TOUCH_START, NodeEventType.TOUCH_MOVE, NodeEventType.TOUCH_END]) {
            node.on(type, (e: EventTouch) => log.push(`${tag}:${type.replace('touch-', '')}@${Math.round(e.getUILocationX())},${Math.round(e.getUILocationY())}`));
        }
    }

    it('tells a node about a touch that starts, moves and ends on it, with where each happened', async () => {
        connect();
        const a = box('a', 200, 200);
        const log: string[] = [];
        record(a, log);
        await press(1, 210, 190);
        await move(1, 230, 190);
        await release(1, 230, 190);
        expect(log).toEqual(['a:start@210,190', 'a:move@230,190', 'a:end@230,190']);
    });

    it('says nothing to a node the touch missed', async () => {
        connect();
        const a = box('a', 200, 200);
        const log: string[] = [];
        record(a, log);
        await press(1, 400, 400);
        await release(1, 400, 400);
        expect(log).toEqual([]);
    });

    it('hands the touch to the topmost of two overlapping nodes: the later sibling', async () => {
        connect();
        const root = box('root', 0, 0, 1000, 1000);
        const under = box('under', 200, 200, 100, 100, root);
        const over = box('over', 220, 200, 100, 100, root);
        const log: string[] = [];
        record(under, log);
        record(over, log);
        await press(1, 210, 200);   // inside both
        await release(1, 210, 200);
        expect(log.every((l) => l.startsWith('over:'))).toBe(true);
        expect(log).toHaveLength(2);
    });

    it('hands the touch to what is drawn last, not to what was made last: a node made later and placed first is underneath', async () => {
        connect();
        const root = box('root', 0, 0, 1000, 1000);
        const content = box('content', 200, 200, 100, 100, root);
        // a backdrop taken from a pool and put under the panel after the panel was built: made last, drawn first
        const backdrop = box('backdrop', 200, 200, 400, 400, root);
        backdrop.setSiblingIndex(0);
        const log: string[] = [];
        record(content, log);
        record(backdrop, log);
        await press(1, 210, 200);
        await release(1, 210, 200);
        expect(log).toHaveLength(2);
        expect(log.every((l) => l.startsWith('content:'))).toBe(true);
    });

    it('keeps sending the gesture to the node that claimed it, wherever the finger goes', async () => {
        connect();
        const a = box('a', 200, 200);
        const b = box('b', 600, 200);
        const log: string[] = [];
        record(a, log);
        record(b, log);
        await press(1, 200, 200);
        await move(1, 600, 200);       // over b, but a has the touch
        await release(1, 600, 200);
        expect(log.map((l) => l.split('@')[0])).toEqual(['a:start', 'a:move', 'a:end']);
    });

    it('bubbles to the ancestors nearest first, and stops where a listener says so', async () => {
        connect();
        const parent = box('parent', 300, 300, 400, 400);
        const child = box('child', 0, 0, 100, 100, parent);
        const grand = box('grand', 300, 300, 400, 400);
        const order: string[] = [];
        child.on(NodeEventType.TOUCH_START, () => order.push('child'));
        parent.on(NodeEventType.TOUCH_START, () => order.push('parent'));
        await press(1, 300, 300);
        await release(1, 300, 300);
        expect(order).toEqual(['child', 'parent']);

        order.length = 0;
        child.targetOff(undefined);
        child.on(NodeEventType.TOUCH_START, (e: EventTouch) => { order.push('child2'); e.stopPropagation(); });
        await press(2, 300, 300);
        await release(2, 300, 300);
        expect(order).toContain('child2');
        expect(order).not.toContain('parent');
        void grand;
    });

    it('does not tell a switched-off node, or one under a switched-off parent', async () => {
        connect();
        const parent = box('parent', 200, 200, 300, 300);
        const child = box('child', 0, 0, 100, 100, parent);
        const log: string[] = [];
        record(child, log);
        parent.active = false;
        await press(1, 200, 200);
        await release(1, 200, 200);
        expect(log).toEqual([]);
    });

    it('gives the event its target and current target, and reads back a delta', async () => {
        connect();
        const parent = box('parent', 200, 200, 300, 300);
        const child = box('child', 0, 0, 100, 100, parent);
        const seen: Array<{ target: string; current: string; dx?: number }> = [];
        child.on(NodeEventType.TOUCH_START, () => {});
        parent.on(NodeEventType.TOUCH_START, (e: EventTouch) => seen.push({ target: e.target!.name, current: e.currentTarget!.name }));
        child.on(NodeEventType.TOUCH_MOVE, (e: EventTouch) => seen.push({ target: 'm', current: 'm', dx: e.getDelta().x }));
        await press(1, 200, 200);
        await move(1, 215, 200);
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
        await P!.frame(1);   // onEnable registers the listeners
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
        await press(1, 205, 205);
        await release(1, 195, 195);
        expect(clicked).toBe(1);
        expect(t.calls).toEqual([['buy']]);
    });

    it('does not click when the touch ends outside, or when the button is not interactable', async () => {
        connect();
        const { node, button: b } = await button();
        let clicked = 0;
        node.on(Button.EventType.CLICK, () => clicked++);
        await press(1, 200, 200);
        await release(1, 500, 500);   // dragged off and let go
        expect(clicked).toBe(0);
        b.interactable = false;
        await press(2, 200, 200);
        await release(2, 200, 200);
        expect(clicked).toBe(0);
    });

    it('swallows the touch, so a node behind it does not also hear it', async () => {
        connect();
        const behind = box('behind', 200, 200, 300, 300);
        const log: string[] = [];
        record(behind, log);
        await button();
        await press(1, 200, 200);
        await release(1, 200, 200);
        expect(log).toEqual([]);
    });

    it('zooms its node while pressed, with the SCALE transition, and puts it back', async () => {
        connect();
        const { node, button: b } = await button();
        b.transition = Button.Transition.SCALE;
        b.zoomScale = 1.5;
        node.setScale(2, 2, 1);
        await press(1, 200, 200);
        expect(node.scale.x).toBeCloseTo(3, 5);
        await release(1, 200, 200);
        expect(node.scale.x).toBeCloseTo(2, 5);
    });

    it('stops listening when disabled', async () => {
        connect();
        const { node, button: b } = await button();
        let clicked = 0;
        node.on(Button.EventType.CLICK, () => clicked++);
        b.enabled = false;
        await P!.frame(1);   // the host sees the change and calls onDisable
        await press(1, 200, 200);
        await release(1, 200, 200);
        expect(clicked).toBe(0);
    });
});
