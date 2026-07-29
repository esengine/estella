// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-scroll-adopt.test.ts
 * @brief   A scene-authored UIScroll becomes a live ScrollContainer.
 *
 * The widget path (createScrollView) always built its container itself. What is
 * new is the scene path: a node carrying UIScroll gets one attached without any
 * code naming it, which is what makes a scroll area placed in the editor
 * actually scroll.
 *
 * Engine-coupled, because UIScroll and Children are C++ components and a World
 * without the module simply drops them. The resolved box normally comes from
 * the layout pass; here the two size queries are faked, so what is under test is
 * the adoption and not Yoga.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Schedule } from '../src/ecs/system';
import { UINode, UIScroll, ScrollMovement, type UINodeData, type UIScrollData } from '../src/ui';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import type { ScrollContainer } from '../src/ui/collection/scroll-container';
import { createScrollAdoptSystem } from '../src/ui/behavior/scroll';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const px = (v: number) => ({ value: v, unit: 0 });
const auto = () => ({ value: 0, unit: 2 });

/** embind wants every member present. */
function fullNode(): UINodeData {
    return {
        position: 0, display: 0, opacity: 1, pointerEvents: 0,
        width: auto(), height: auto(),
        minWidth: auto(), minHeight: auto(), maxWidth: auto(), maxHeight: auto(),
        flexGrow: 0, flexShrink: 1, flexBasis: auto(), alignSelf: 0,
        marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
        insetLeft: auto(), insetTop: auto(), insetRight: auto(), insetBottom: auto(),
    } as UINodeData;
}

function fullScroll(over: Partial<UIScrollData> = {}): UIScrollData {
    return {
        enabled: true, content: 0, horizontal: false, vertical: true,
        movement: ScrollMovement.Clamped, wheelSpeed: 1, dragScroll: true,
        decelerationRate: 0.135, ...over,
    };
}

describe.skipIf(!HAS_WASM)('UIScroll adoption', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function setup(scroll: Partial<UIScrollData> = {}, contentSize = { w: 400, h: 1200 }) {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        const world = app.world;

        const viewport = world.spawn('viewport');
        const content = world.spawn('content');
        world.insert(viewport, UINode, fullNode());
        world.insert(content, UINode, fullNode());
        world.setParent(content, viewport);
        world.insert(viewport, UIScroll, fullScroll(scroll));

        const sizes = new Map<number, { w: number; h: number }>([
            [viewport as number, { w: 400, h: 300 }],
            [content as number, contentSize],
        ]);
        const attached = new Map<number, ScrollContainer>();

        app.addSystemToSchedule(Schedule.Update, createScrollAdoptSystem(
            world,
            {
                uiNode_computedWidth: (_r: unknown, e: number) => sizes.get(e)?.w ?? 0,
                uiNode_computedHeight: (_r: unknown, e: number) => sizes.get(e)?.h ?? 0,
            } as never,
            registry,
            {
                attachScrollContainer: (e, c) => { attached.set(e as number, c); },
                detachScrollContainer: (e) => { attached.delete(e as number); },
            },
        ));
        return { app, world, viewport, content, attached };
    }

    it('attaches a container sized from the resolved layout', async () => {
        const { app, viewport, attached } = setup();
        await app.tick(1 / 60);

        const container = attached.get(viewport as number);
        expect(container).toBeDefined();
        // 1200 of content in a 300 box leaves 900 to travel.
        expect(container!.getMaxOffset()).toEqual({ x: 0, y: 900 });
    });

    it('scrolling moves the content by its inset, the way the widget does', async () => {
        const { app, world, viewport, content, attached } = setup();
        await app.tick(1 / 60);

        attached.get(viewport as number)!.scrollBy({ x: 0, y: 120 });
        const node = world.get(content, UINode) as UINodeData;
        expect(node.insetTop.value).toBeCloseTo(-120, 3);
        expect(node.insetTop.unit).toBe(0);
    });

    it('clamps to the content, so a short list cannot be dragged off', async () => {
        const { app, viewport, attached } = setup({}, { w: 400, h: 100 });
        await app.tick(1 / 60);

        const container = attached.get(viewport as number)!;
        container.scrollBy({ x: 0, y: 500 });
        expect(container.getOffset()).toEqual({ x: 0, y: 0 });
    });

    it('detaches when the component goes away', async () => {
        const { app, world, viewport, attached } = setup();
        await app.tick(1 / 60);
        expect(attached.has(viewport as number)).toBe(true);

        world.remove(viewport, UIScroll);
        await app.tick(1 / 60);
        expect(attached.has(viewport as number)).toBe(false);
    });

    it('does not attach while disabled', async () => {
        const { app, viewport, attached } = setup({ enabled: false });
        await app.tick(1 / 60);
        expect(attached.has(viewport as number)).toBe(false);
    });
});
