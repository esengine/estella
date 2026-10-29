// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PageView, ScrollBar, SafeArea and WebView.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { Node, PageView, SafeArea, ScrollBar, UITransform, Vec2, WebView, Widget } from '../../src/cocos';
import { setSafeInsets } from '../../src/cocos/ui/screen';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';
import { pointerApp, type PointerApp } from './helpers/pointerApp';

describe.skipIf(!HAS_WASM)('pages, bars, safe area and web view', () => {
    let module: ESEngineModule;
    let P: PointerApp | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => { setSafeInsets(0, 0, 0, 0); P?.dispose(); P = undefined; });

    function box(name: string, x: number, y: number, w: number, h: number, parent?: Node, anchor = new Vec2(0.5, 0.5)): Node {
        const n = new Node(name);
        P!.app.world.insert(n._entity, Transform);
        const t = n.addComponent(UITransform)!;
        t.setContentSize(w, h);
        t.anchorX = anchor.x;
        t.anchorY = anchor.y;
        n.setPosition(x, y, 0);
        parent?.addChild(n);
        return n;
    }

    /** A 200 x 100 view over a row of three 200 x 100 pages, content anchored at its left. */
    async function pager(): Promise<{ view: PageView; pages: Node[] }> {
        P = pointerApp(module);
        const host = box('view', 300, 300, 200, 100);
        const content = box('content', -100, 0, 600, 100, host, new Vec2(0, 0.5));
        const pages = [0, 1, 2].map((i) => box(`page${i}`, 100 + i * 200, 0, 200, 100, content));
        const view = host.addComponent<PageView>('PageView')!;
        view.content = content;
        view.direction = PageView.Direction.Horizontal;
        await P.frame(2);
        return { view, pages };
    }

    it('settles on a page it is asked for, and says it turned', async () => {
        const { view } = await pager();
        const turned: number[] = [];
        view.node.on(PageView.EventType.PAGE_TURNING, (v: PageView) => turned.push(v.getCurrentPageIndex()));
        expect(view.getPages()).toHaveLength(3);
        view.scrollToPage(2, 0);
        await P!.frame(2);
        expect(view.getCurrentPageIndex()).toBe(2);
        expect(view.getScrollOffset().x).toBeCloseTo(400, 3);
        view.setCurrentPageIndex(0);
        await P!.frame(2);
        expect(view.getScrollOffset().x).toBeCloseTo(0, 3);
        expect(turned).toEqual([2, 0]);
    });

    it('keeps the page inside the pages there are', async () => {
        const { view } = await pager();
        view.scrollToPage(9, 0);
        expect(view.getCurrentPageIndex()).toBe(2);
        view.scrollToPage(-4, 0);
        expect(view.getCurrentPageIndex()).toBe(0);
    });

    it('moves a scroll bar\'s handle along its track as the view scrolls, and sizes it to the share of the content in view', async () => {
        P = pointerApp(module);
        const host = box('scroll', 300, 300, 100, 100);
        const content = box('content', 0, 50, 100, 400, host, new Vec2(0.5, 1));
        const track = box('track', 60, 0, 10, 100, host);
        const handle = box('handle', 0, 0, 10, 100, track);
        const { ScrollView } = await import('../../src/cocos');
        const view = host.addComponent<InstanceType<typeof ScrollView>>('ScrollView')!;
        view.content = content;
        const bar = track.addComponent<ScrollBar>('ScrollBar')!;
        bar.scrollView = view;
        bar.handle = handle;
        bar.direction = ScrollBar.Direction.VERTICAL;
        await P.frame(2);
        const knob = handle.getComponent(UITransform)!;
        expect(knob.height).toBeCloseTo(25, 3);                 // a quarter of the content is in view
        expect(handle.position.y).toBeCloseTo(50 - 12.5, 3);    // at the top of the track
        view.scrollToBottom(0);
        await P.frame(2);
        expect(handle.position.y).toBeCloseTo(-50 + 12.5, 3);   // at the bottom
    });

    it('keeps a node inside the safe area: a widget whose margins are the insets', async () => {
        P = pointerApp(module);
        const node = box('hud', 480, 320, 100, 100);
        node.addComponent<SafeArea>('SafeArea');
        setSafeInsets(44, 0, 30, 20);
        await P.frame(2);
        const widget = node.getComponent(Widget)!;
        expect([widget.left, widget.right, widget.top, widget.bottom]).toEqual([44, 0, 30, 20]);
        expect(widget.isAlignLeft && widget.isAlignRight && widget.isAlignTop && widget.isAlignBottom).toBe(true);
        setSafeInsets(0, 0, 0, 0);
        await P.frame(2);
        expect(widget.left).toBe(0);
    });

    it('keeps a web view\'s address and answers its calls without a surface', async () => {
        P = pointerApp(module);
        const node = box('web', 100, 100, 100, 100);
        const web = node.addComponent<WebView>('WebView')!;
        web.loadURL('https://example.com');
        expect(web.url).toBe('https://example.com');
        expect(() => { web.evaluateJS('1'); web.setJavascriptInterfaceScheme('x'); }).not.toThrow();
    });
});
