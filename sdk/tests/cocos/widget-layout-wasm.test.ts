// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `Widget` and `Layout` against the real engine.
 *
 * The numbers are the ones Cocos produces for the same settings: a stretched panel takes its parent's size minus its margins, a
 * pinned one keeps its size and sits at the edge by its anchor, a centred one is offset from the middle; a row starts at the
 * container's left edge plus padding and advances by each child's width plus spacing.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { resetClassRegistry } from '../../src/cocos/registry';
import { Layout, Node, UITransform, Widget, setCurrentWorld, setVisibleSize } from '../../src/cocos';
import { declareUiPass } from '../../src/cocos/ui/pass';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

describe.skipIf(!HAS_WASM)('widgets and layouts on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let app: App | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });

    function connect(): void {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareUiPass();
        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        setVisibleSize(960, 640);
    }
    afterEach(() => {
        setCurrentWorld(null);
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    function box(name: string, w: number, h: number, parent?: Node, ax = 0.5, ay = 0.5): Node {
        const n = new Node(name);
        app!.world.insert(n._entity, Transform);
        const t = n.addComponent(UITransform)!;
        t.setContentSize(w, h);
        t.setAnchorPoint(ax, ay);
        parent?.addChild(n);
        return n;
    }
    const frame = async (n = 2): Promise<void> => { for (let i = 0; i < n; i++) await app!.tick(1 / 60); };
    const widget = (n: Node, set: (w: Widget) => void): Widget => { const w = n.addComponent(Widget)!; set(w); return w; };
    const size = (n: Node): number[] => { const t = n.getComponent(UITransform)!; return [t.width, t.height]; };

    it('stretches a panel to its parent minus the margins', async () => {
        connect();
        const parent = box('parent', 400, 300);
        const panel = box('panel', 10, 10, parent);
        widget(panel, (w) => { w.isAlignLeft = w.isAlignRight = w.isAlignTop = w.isAlignBottom = true; w.left = 20; w.right = 40; w.top = 10; w.bottom = 30; });
        await frame();
        expect(size(panel)).toEqual([340, 260]);
        // the parent's space is anchor-relative: its left edge is -200, so the panel spans -180..160 and is centred at -10
        expect(panel.position.x).toBeCloseTo(-10, 5);
        expect(panel.position.y).toBeCloseTo(((-150 + 30) + (150 - 10)) / 2, 5);
    });

    it('pins a node to one edge by its anchor and keeps its size', async () => {
        connect();
        const parent = box('parent', 400, 300);
        const node = box('n', 50, 20, parent, 0, 1);   // anchored top-left
        widget(node, (w) => { w.isAlignRight = true; w.right = 10; w.isAlignTop = true; w.top = 5; });
        await frame();
        expect([node.position.x, node.position.y]).toEqual([200 - 10 - 50, 150 - 5]);
        expect(size(node)).toEqual([50, 20]);
    });

    it('centres with an offset, in pixels or as a fraction of the parent', async () => {
        connect();
        const parent = box('parent', 400, 300);
        const a = box('a', 50, 50, parent);
        widget(a, (w) => { w.isAlignHorizontalCenter = true; w.horizontalCenter = 30; w.isAlignVerticalCenter = true; w.verticalCenter = -10; });
        const b = box('b', 50, 50, parent);
        widget(b, (w) => { w.isAlignHorizontalCenter = true; w.isAbsHorizontalCenter = false; w.horizontalCenter = 0.25; });
        await frame();
        expect([a.position.x, a.position.y]).toEqual([30, -10]);
        expect(b.position.x).toBe(100);
    });

    it('aligns a node under no rectangle to the visible area, and follows it when it changes', async () => {
        connect();
        const canvas = box('canvas', 1, 1);
        widget(canvas, (w) => { w.isAlignLeft = w.isAlignRight = w.isAlignTop = w.isAlignBottom = true; });
        await frame();
        expect(size(canvas)).toEqual([960, 640]);
        expect([canvas.position.x, canvas.position.y]).toEqual([480, 320]);
        setVisibleSize(1280, 720);
        await frame();
        expect(size(canvas)).toEqual([1280, 720]);
        expect(canvas.position.x).toBe(640);
    });

    it('aligns once and leaves the node to the script after, in ONCE mode; every frame, in ALWAYS mode', async () => {
        connect();
        const parent = box('parent', 400, 300);
        const once = box('once', 50, 50, parent);
        widget(once, (w) => { w.alignMode = Widget.AlignMode.ONCE; w.isAlignLeft = true; });
        const always = box('always', 50, 50, parent);
        widget(always, (w) => { w.alignMode = Widget.AlignMode.ALWAYS; w.isAlignLeft = true; });
        await frame();
        once.setPosition(0, 0, 0);
        always.setPosition(0, 0, 0);
        await frame();
        expect(once.position.x).toBe(0);
        expect(always.position.x).toBe(-175);
    });

    it('aligns again when a setting changes, whatever the mode', async () => {
        connect();
        const parent = box('parent', 400, 300);
        const node = box('n', 50, 50, parent);
        const w = widget(node, (x) => { x.alignMode = Widget.AlignMode.ONCE; x.isAlignLeft = true; });
        await frame();
        expect(node.position.x).toBe(-175);
        w.left = 100;
        await frame();
        expect(node.position.x).toBe(-75);
    });

    it('lays children out in a row from the left edge, with padding and spacing', async () => {
        connect();
        const row = box('row', 300, 50);
        const layout = row.addComponent(Layout)!;
        layout.type = Layout.Type.HORIZONTAL;
        layout.paddingLeft = 10;
        layout.spacingX = 5;
        const kids = [box('a', 40, 20, row), box('b', 60, 20, row), box('c', 20, 20, row)];
        await frame();
        // the left edge is -150, plus 10 of padding; the centres follow at +20, +30 after a 5 gap, +10 after another
        expect(kids.map((k) => k.position.x)).toEqual([-120, -65, -20]);
        expect(size(row)).toEqual([300, 50]);
    });

    it('grows the container to fit in CONTAINER mode, and fills it from the top', async () => {
        connect();
        const col = box('col', 100, 10);
        const layout = col.addComponent(Layout)!;
        layout.type = Layout.Type.VERTICAL;
        layout.resizeMode = Layout.ResizeMode.CONTAINER;
        layout.paddingTop = 4;
        layout.paddingBottom = 6;
        layout.spacingY = 10;
        const a = box('a', 30, 40, col), b = box('b', 30, 20, col);
        await frame();
        const height = 4 + 6 + 40 + 20 + 10;
        expect(size(col)[1]).toBe(height);
        expect(a.position.y).toBe(height / 2 - 4 - 20);
        expect(b.position.y).toBe(height / 2 - 4 - 40 - 10 - 10);
    });

    it('stretches the children to share the container in CHILDREN mode', async () => {
        connect();
        const row = box('row', 220, 50);
        const layout = row.addComponent(Layout)!;
        layout.type = Layout.Type.HORIZONTAL;
        layout.resizeMode = Layout.ResizeMode.CHILDREN;
        layout.spacingX = 10;
        const kids = [box('a', 5, 20, row), box('b', 5, 20, row)];
        await frame();
        expect(kids.map((k) => size(k)[0])).toEqual([105, 105]);
    });

    it('wraps a grid at the container edge, and relayouts when a child is added', async () => {
        connect();
        const grid = box('grid', 100, 100);
        const layout = grid.addComponent(Layout)!;
        layout.type = Layout.Type.GRID;
        layout.cellWidth = layout.cellHeight = 40;
        box('a', 40, 40, grid); box('b', 40, 40, grid); box('c', 40, 40, grid);
        await frame();
        const [a, b, c] = grid.children;
        expect(a!.position.y).toBe(b!.position.y);            // two fit on the first row
        expect(c!.position.y).toBeLessThan(a!.position.y);    // the third wrapped below
        expect(c!.position.x).toBe(a!.position.x);
        const d = box('d', 40, 40, grid);
        await frame();
        expect(d.position.x).toBe(b!.position.x);
        expect(d.position.y).toBe(c!.position.y);
    });

    it('lets a widget-stretched container relayout its children in the same frame', async () => {
        connect();
        const parent = box('parent', 400, 100);
        const row = box('row', 10, 100, parent);
        widget(row, (w) => { w.isAlignLeft = w.isAlignRight = true; });
        const layout = row.addComponent(Layout)!;
        layout.type = Layout.Type.HORIZONTAL;
        layout.resizeMode = Layout.ResizeMode.CHILDREN;
        const kids = [box('a', 5, 20, row), box('b', 5, 20, row)];
        await frame(1);
        expect(kids.map((k) => size(k)[0])).toEqual([200, 200]);
    });
});
