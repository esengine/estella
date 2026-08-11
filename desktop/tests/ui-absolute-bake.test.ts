// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Flipping a UINode's `position` to Absolute (via the shared setField
 *        channel, as the inspector's Position dropdown does) bakes its current
 *        resolved box into concrete px insets — so the node holds its on-screen
 *        spot and gains a real, draggable position instead of collapsing to the
 *        auto/static top-left corner. The live box comes from the viewport's
 *        UINode OBB (mocked here to a known rect). One undo reverts flip + bake.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, UINode, UIPositionType, DimensionUnit } from 'esengine';
import type { SceneData } from 'esengine';
import type { ESEngineModule } from 'esengine/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const host = vi.hoisted(() => ({ world: null as unknown as App['world'] }));
vi.mock('@/engine/EngineHost', () => ({
    EngineHost: {
        mutableWorld: () => host.world,
        get world() { return host.world; },
        getResource: () => undefined,
    },
}));

// The bake reads each node's live layout box from the viewport OBB; stub it to a
// rect keyed by runtime id so the test controls the geometry without a layout pass.
const obb = vi.hoisted(() => ({ boxes: new Map<number, { cx: number; cy: number; hw: number; hh: number; rot: number }>() }));
vi.mock('@/engine/ViewportController', () => ({
    ViewportController: {
        uiEntityWorldOBB: (rt: number) => obb.boxes.get(rt) ?? null,
    },
}));

import { EditorSession } from '@/engine/EditorSession';

const emptyScene = (): SceneData => ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;
const PX = DimensionUnit.Px;
const AUTO = DimensionUnit.Auto;

describe.skipIf(!HAS_WASM)('setField UINode position → Absolute bakes insets (headless World)', () => {
    let module: ESEngineModule;
    let S: EditorSession;
    const rt = (sourceId: number): number => S.model.runtimeFor(sourceId)!;

    beforeAll(async () => { module = await loadWasmModule(); });
    beforeEach(() => {
        const app = App.new();
        const registry = new module.Registry();
        app.connectCpp(registry as never, module);
        host.world = app.world;
        S = EditorSession.create();
        S.model.adopt(emptyScene(), new Map());
        obb.boxes.clear();
    });
    afterEach(() => S.dispose());

    // A child UINode under a parent UINode, with the two live boxes registered.
    const withParentedNode = (): { child: number; parent: number; e: number } => {
        const parent = S.commands.addEntity()!;
        S.commands.addComponent(parent, 'UINode');
        const child = S.commands.addEntity()!;
        S.commands.addComponent(child, 'UINode');
        S.commands.setParent(child, parent);
        // Parent fills [-400,400]×[-300,300]; child sits at (100,50), size 140×40.
        obb.boxes.set(rt(parent), { cx: 0, cy: 0, hw: 400, hh: 300, rot: 0 });
        obb.boxes.set(rt(child), { cx: 100, cy: 50, hw: 70, hh: 20, rot: 0 });
        return { child, parent, e: rt(child) };
    };

    const setAbsolute = (id: number): void =>
        S.commands.setField(id, 'UINode', 'position', 'enum', UIPositionType.Absolute);

    it('bakes auto insets to the px offset of the current box (left+top pinned)', () => {
        const { child, e } = withParentedNode();
        setAbsolute(child);
        const n = host.world.get(e, UINode);
        expect(n.position).toBe(UIPositionType.Absolute);
        // left = (100-70) - (0-400) = 430 ; top(y-down) = (0+300) - (50+20) = 230
        expect(n.insetLeft.unit).toBe(PX);
        expect(n.insetLeft.value).toBe(430);
        expect(n.insetTop.unit).toBe(PX);
        expect(n.insetTop.value).toBe(230);
        // Far edges stay auto — the node is pinned to top-left, free on the far sides.
        expect(n.insetRight.unit).toBe(AUTO);
        expect(n.insetBottom.unit).toBe(AUTO);
    });

    it('is ONE undo step: reverts both the flip and the seeded insets', () => {
        const { child, e } = withParentedNode();
        setAbsolute(child);
        expect(host.world.get(e, UINode).insetLeft.unit).toBe(PX);
        S.history.undo();
        const n = host.world.get(e, UINode);
        expect(n.position).toBe(UIPositionType.Relative);
        expect(n.insetLeft.unit).toBe(AUTO);
        expect(n.insetTop.unit).toBe(AUTO);
    });

    it('never clobbers an axis the user already positioned (a definite inset)', () => {
        const { child, e } = withParentedNode();
        S.commands.setField(child, 'UINode', 'insetLeft', 'dimension', { value: 12, unit: PX });
        setAbsolute(child);
        const n = host.world.get(e, UINode);
        expect(n.insetLeft.value).toBe(12); // preserved, not re-baked
        expect(n.insetTop.unit).toBe(PX); // the still-auto axis is baked
        expect(n.insetTop.value).toBe(230);
    });

    it('subtracts the node\'s own px margin so it holds position', () => {
        const { child, e } = withParentedNode();
        S.commands.setField(child, 'UINode', 'marginLeft', 'dimension', { value: 30, unit: PX });
        setAbsolute(child);
        // 430 edge offset − 30 margin = 400 inset (margin still adds the other 30).
        expect(host.world.get(e, UINode).insetLeft.value).toBe(400);
    });

    it('a centered node (auto insets + auto margins) drags: auto margins nail to 0 so the inset moves it', () => {
        const { child, e } = withParentedNode();
        S.commands.setField(child, 'UINode', 'position', 'enum', UIPositionType.Absolute);
        // Reset to the Center-anchor shape: every inset + margin auto (self-centered).
        for (const k of ['insetLeft', 'insetRight', 'insetTop', 'insetBottom', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom'])
            S.commands.setField(child, 'UINode', k, 'dimension', { value: 0, unit: AUTO });
        S.commands.setEntityXY(child, 250, 50); // center 100→250 in x (dx=150), y unchanged
        const n = host.world.get(e, UINode);
        // The dragged (x) axis: auto margins nailed to 0, inset pinned to move the node.
        expect(n.marginLeft.unit).toBe(PX);
        expect(n.marginLeft.value).toBe(0);
        expect(n.insetLeft.unit).toBe(PX);
        expect(n.insetLeft.value).toBe(580); // 430 current offset + 150 delta
        // The untouched (y) axis keeps its auto margins — only moved axes are nailed.
        expect(n.marginTop.unit).toBe(AUTO);
    });

    it('is a graceful no-op flip when no live box is available (unlaid-out node)', () => {
        const parent = S.commands.addEntity()!;
        S.commands.addComponent(parent, 'UINode');
        const child = S.commands.addEntity()!;
        S.commands.addComponent(child, 'UINode');
        S.commands.setParent(child, parent);
        // No OBBs registered → seed can't compute; the flip still applies, insets stay auto.
        setAbsolute(child);
        const n = host.world.get(rt(child), UINode);
        expect(n.position).toBe(UIPositionType.Absolute);
        expect(n.insetLeft.unit).toBe(AUTO);
    });
});
