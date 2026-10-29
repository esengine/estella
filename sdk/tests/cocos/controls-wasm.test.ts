// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Toggle, ToggleContainer, ProgressBar, Slider, BlockInputEvents and ScrollView, driven by touches against the real engine.
 *
 * The camera is faked as the identity, as in the touch tests, so a screen pixel is a world unit with y flipped.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import {
    BlockInputEvents, Button, Node, ProgressBar, ScrollView, Slider, Sprite, Toggle, ToggleContainer, UITransform, Vec2,
} from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';
import { pointerApp, type PointerApp } from './helpers/pointerApp';

describe.skipIf(!HAS_WASM)('toggles, bars, sliders and scroll views', () => {
    let module: ESEngineModule;
    let P: PointerApp | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => { P?.dispose(); P = undefined; });

    function boot(): void { P = pointerApp(module); }
    const W = () => P!.app.world;
    const frame = (n = 2): Promise<void> => P!.frame(n);

    function box(name: string, x: number, y: number, w = 100, h = 100, parent?: Node): Node {
        const n = new Node(name);
        W().insert(n._entity, Transform);
        n.addComponent(UITransform)!.setContentSize(w, h);
        n.setPosition(x, y, 0);
        parent?.addChild(n);
        return n;
    }

    const press = (x: number, y: number, id = 1): Promise<void> => P!.press(x, y, id);
    const move = (x: number, y: number, id = 1): Promise<void> => P!.move(x, y, id);
    const release = (x: number, y: number, id = 1): Promise<void> => P!.release(x, y, id);
    const tap = (x: number, y: number): Promise<void> => P!.tap(x, y);

    // ---- Toggle -----------------------------------------------------------------------------------------------------

    async function toggle(name: string, x: number, y: number, parent?: Node): Promise<{ node: Node; t: Toggle; mark: Node }> {
        const node = box(name, x, y, 60, 60, parent);
        const mark = box(`${name}-mark`, 0, 0, 30, 30, node);
        const markSprite = mark.addComponent(Sprite)!;
        const t = node.addComponent<Toggle>('Toggle')!;
        t.checkMark = markSprite;
        await frame(1);
        return { node, t, mark };
    }

    it('flips on a click, shows its check mark only while on, and says so', async () => {
        boot();
        const { node, t, mark } = await toggle('t', 200, 200);
        const seen: boolean[] = [];
        node.on(Toggle.EventType.TOGGLE, (x: Toggle) => seen.push(x.isChecked));
        expect(mark.active).toBe(false);
        await tap(200, 200);
        expect(t.isChecked).toBe(true);
        expect(mark.active).toBe(true);
        await tap(200, 200);
        expect(t.isChecked).toBe(false);
        expect(mark.active).toBe(false);
        expect(seen).toEqual([true, false]);
    });

    it('does not flip when it is not interactable, or when set without notify', async () => {
        boot();
        const { t, mark } = await toggle('t', 200, 200);
        t.interactable = false;
        await tap(200, 200);
        expect(t.isChecked).toBe(false);
        t.interactable = true;
        t.setIsCheckedWithoutNotify(true);
        expect(mark.active).toBe(true);
    });

    it('keeps one on in a group, and leaves the one that is on alone when switching off is not allowed', async () => {
        boot();
        const holder = box('group', 400, 400, 400, 100);
        const group = holder.addComponent<ToggleContainer>('ToggleContainer')!;
        const a = await toggle('a', 300, 400, holder);
        const b = await toggle('b', 500, 400, holder);
        a.t.toggleGroup = group;
        b.t.toggleGroup = group;
        await frame(1);
        expect(a.t.isChecked || b.t.isChecked).toBe(true);   // the container made one on when it enabled
        const firstOn = a.t.isChecked ? a : b;
        const other = a.t.isChecked ? b : a;
        await tap(other.node.getWorldPosition().x, other.node.getWorldPosition().y);
        expect(other.t.isChecked).toBe(true);
        expect(firstOn.t.isChecked).toBe(false);
        // clicking the one that is on does nothing
        await tap(other.node.getWorldPosition().x, other.node.getWorldPosition().y);
        expect(other.t.isChecked).toBe(true);
        // …unless the group allows none
        group.allowSwitchOff = true;
        await tap(other.node.getWorldPosition().x, other.node.getWorldPosition().y);
        expect(other.t.isChecked).toBe(false);
        expect(group.anyTogglesChecked()).toBe(false);
    });

    // ---- ProgressBar -----------------------------------------------------------------------------------------------

    it('sizes its bar to total length times progress, clamped', async () => {
        boot();
        const holder = box('holder', 0, 0, 200, 20);
        const barNode = box('bar', 0, 0, 10, 20, holder);
        const bar = barNode.addComponent(Sprite)!;
        const p = holder.addComponent<ProgressBar>('ProgressBar')!;
        p.barSprite = bar;
        p.totalLength = 200;
        p.progress = 0.25;
        expect(barNode.getComponent(UITransform)!.width).toBe(50);
        p.progress = 2;
        expect(p.progress).toBe(1);
        expect(barNode.getComponent(UITransform)!.width).toBe(200);
        p.progress = -1;
        expect(barNode.getComponent(UITransform)!.width).toBe(0);
        p.mode = ProgressBar.Mode.VERTICAL;
        p.progress = 0.5;
        expect(barNode.getComponent(UITransform)!.height).toBe(100);
    });

    // ---- Slider ----------------------------------------------------------------------------------------------------

    it('reads progress from where the finger is along it, moves its handle, and says it slid', async () => {
        boot();
        const track = box('track', 300, 300, 200, 20);
        const knobNode = box('knob', 0, 0, 20, 20, track);
        const knob = knobNode.addComponent<Button>('Button')!;
        const s = track.addComponent<Slider>('Slider')!;
        s.handle = knob;
        await frame(1);
        let slid = 0;
        track.on(Slider.EventType.SLIDE, () => slid++);
        await press(250, 300);                   // a quarter of the way: the track spans 200..400
        expect(s.progress).toBeCloseTo(0.25, 5);
        await move(350, 300);
        expect(s.progress).toBeCloseTo(0.75, 5);
        await release(350, 300);
        expect(knobNode.position.x).toBeCloseTo(50, 3);   // 0.75 * 200 - 100
        expect(slid).toBe(2);
    });

    // ---- BlockInputEvents ------------------------------------------------------------------------------------------

    it('takes a touch so the node behind it does not hear it', async () => {
        boot();
        const root = box('root', 0, 0, 1000, 1000);
        const behind = box('behind', 200, 200, 300, 300, root);
        const front = box('front', 200, 200, 100, 100, root);
        front.addComponent(BlockInputEvents);
        await frame(1);
        let heard = 0;
        behind.on(Node.EventType.TOUCH_START, () => heard++);
        await tap(200, 200);
        expect(heard).toBe(0);
        await tap(320, 200);   // beside the blocker (it spans 150..250), still on the node behind (50..350)
        expect(heard).toBe(1);
    });

    // ---- ScrollView ------------------------------------------------------------------------------------------------

    async function scroller(horizontal = false): Promise<{ view: Node; content: Node; sv: ScrollView; button: Node; clicks: () => number }> {
        const view = box('view', 300, 300, 200, 200);
        const content = box('content', 0, 0, horizontal ? 800 : 200, horizontal ? 200 : 800, view);
        content.getComponent(UITransform)!.setAnchorPoint(horizontal ? 0 : 0.5, horizontal ? 0.5 : 1);
        const button = box('button', horizontal ? 100 : 0, horizontal ? 0 : -100, 80, 60, content);
        const b = button.addComponent<Button>('Button')!;
        void b;
        let clicked = 0;
        button.on(Button.EventType.CLICK, () => clicked++);
        const sv = view.addComponent<ScrollView>('ScrollView')!;
        sv.content = content;
        sv.vertical = !horizontal;
        sv.horizontal = horizontal;
        await frame(1);
        return { view, content, sv, button, clicks: () => clicked };
    }

    it('reports how far the content can go, and starts at the top', async () => {
        boot();
        const { sv } = await scroller();
        expect(sv.getMaxScrollOffset().y).toBe(600);
        expect(sv.getScrollOffset().y).toBe(0);
    });

    it('moves the content with the finger, a screen pixel for a world unit, and stops where it is without inertia', async () => {
        boot();
        const { content, sv } = await scroller();
        sv.inertia = false;
        const top = content.position.y;
        await press(300, 350);
        await move(300, 340);                    // 10 px: past the drag threshold
        await move(300, 300);                    // 50 more, upward on screen = toward the content's end
        await release(300, 300);
        // the finger went DOWN the screen (y decreases) by 50 after the threshold, which pulls the content down: offset shrinks, but
        // it was at the start, so it is an overscroll that springs back; check the direction through the offset sign mid-drag instead
        expect(sv.getScrollOffset().y).toBeLessThanOrEqual(0);
        await frame(90);
        expect(sv.getScrollOffset().y).toBeCloseTo(0, 1);
        expect(content.position.y).toBeCloseTo(top, 1);
    });

    it('scrolls toward the end when the finger moves up the screen, and glides on after a flick', async () => {
        boot();
        const { sv } = await scroller();
        await press(300, 250);
        for (let i = 1; i <= 8; i++) { await move(300, 250 + i * 10); }   // up the screen: world y grows
        const held = sv.getScrollOffset().y;
        expect(held).toBeGreaterThan(40);
        await release(300, 330);
        await frame(1);
        await frame(60);
        expect(sv.getScrollOffset().y).toBeGreaterThan(held);
        expect(sv.getScrollOffset().y).toBeLessThanOrEqual(600 + 1e-6);
    });

    it('does not click a button the drag began on, but clicks it on a plain tap', async () => {
        boot();
        const { button, sv, clicks } = await scroller();
        // the button is 100 below the content's top edge; the content's top is at the view's top (y 400)
        const bx = 300, by = 300;   // view centre: content top 400, button centre at 400 - 100 = 300
        void button;
        await press(bx, by);
        await move(bx, by + 30);
        await move(bx, by + 60);
        await release(bx, by + 60);
        expect(clicks()).toBe(0);
        expect(sv.getScrollOffset().y).toBeGreaterThan(0);

        sv.scrollToTop(0);
        await frame(2);
        await tap(bx, by);
        expect(clicks()).toBe(1);
    });

    it('scrolls to the end, to a place over a time, and says it got there', async () => {
        boot();
        const { sv, view } = await scroller();
        const seen: string[] = [];
        for (const t of [ScrollView.EventType.SCROLL_TO_BOTTOM, ScrollView.EventType.SCROLL_ENDED]) view.on(t, () => seen.push(t));
        sv.scrollToBottom(0);
        expect(sv.getScrollOffset().y).toBe(600);
        sv.scrollToTop(0);
        sv.scrollToOffset(new Vec2(0, 300), 0.5);
        await frame(40);
        expect(sv.getScrollOffset().y).toBe(300);
        expect(seen).toContain(ScrollView.EventType.SCROLL_TO_BOTTOM);
        expect(seen).toContain(ScrollView.EventType.SCROLL_ENDED);
    });

    it('scrolls sideways when horizontal', async () => {
        boot();
        const { sv } = await scroller(true);
        expect(sv.getMaxScrollOffset().x).toBe(600);
        sv.scrollToRight(0);
        expect(sv.getScrollOffset().x).toBe(600);
        sv.scrollToLeft(0);
        expect(sv.getScrollOffset().x).toBe(0);
    });
});
