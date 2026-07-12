// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneCommands.setUINodeAnchor writes the box fields a preset resolves to
 *        (through the shared setField channel), as ONE undo step, and the written
 *        UINode reads back as that preset via the SDK's detectAnchor — the same
 *        derivation the inspector grid uses to highlight the active cell.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, UINode, AnchorAxis, UIPositionType, DimensionUnit, detectAnchor } from 'esengine';
import type { ESEngineModule, SceneData } from 'esengine';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const host = vi.hoisted(() => ({ world: null as unknown as App['world'] }));
vi.mock('@/engine/EngineHost', () => ({
    EngineHost: {
        mutableWorld: () => host.world,
        get world() { return host.world; },
        getResource: () => undefined,
    },
}));

import { EditorSession } from '@/engine/EditorSession';

const emptyScene = (): SceneData => ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;

describe.skipIf(!HAS_WASM)('SceneCommands.setUINodeAnchor (headless World)', () => {
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
    });
    afterEach(() => S.dispose());

    const withUINode = (): { id: number; e: number } => {
        const id = S.commands.addEntity()!;
        S.commands.addComponent(id, 'UINode');
        return { id, e: rt(id) };
    };
    const AUTO = DimensionUnit.Auto;
    const PX = DimensionUnit.Px;

    it('Center/Center makes the node Absolute with auto insets + auto margins', () => {
        const { id, e } = withUINode();
        S.commands.setUINodeAnchor([id], { h: AnchorAxis.Center, v: AnchorAxis.Center });
        const n = host.world.get(e, UINode);
        expect(n.position).toBe(UIPositionType.Absolute);
        for (const d of [n.insetLeft, n.insetRight, n.insetTop, n.insetBottom,
                         n.marginLeft, n.marginRight, n.marginTop, n.marginBottom]) {
            expect(d.unit).toBe(AUTO);
        }
    });

    it('Start/Start pins the near edges (px) and frees the far edges (auto)', () => {
        const { id, e } = withUINode();
        S.commands.setUINodeAnchor([id], { h: AnchorAxis.Start, v: AnchorAxis.Start });
        const n = host.world.get(e, UINode);
        expect(n.insetLeft.unit).toBe(PX);
        expect(n.insetTop.unit).toBe(PX);
        expect(n.insetRight.unit).toBe(AUTO);
        expect(n.insetBottom.unit).toBe(AUTO);
    });

    it('Stretch/Stretch drives the size via auto', () => {
        const { id, e } = withUINode();
        S.commands.setUINodeAnchor([id], { h: AnchorAxis.Stretch, v: AnchorAxis.Stretch });
        const n = host.world.get(e, UINode);
        expect(n.insetLeft.unit).toBe(PX);
        expect(n.insetRight.unit).toBe(PX);
        expect(n.width.unit).toBe(AUTO);
        expect(n.height.unit).toBe(AUTO);
    });

    it('the write is ONE undo step (reverts position back to Relative)', () => {
        const { id, e } = withUINode();
        expect(host.world.get(e, UINode).position).toBe(UIPositionType.Relative);
        S.commands.setUINodeAnchor([id], { h: AnchorAxis.End, v: AnchorAxis.Center });
        expect(host.world.get(e, UINode).position).toBe(UIPositionType.Absolute);
        S.history.undo();
        expect(host.world.get(e, UINode).position).toBe(UIPositionType.Relative);
    });

    it('the written box reads back as the preset via detectAnchor (grid highlight)', () => {
        const { id, e } = withUINode();
        for (const h of [AnchorAxis.Start, AnchorAxis.Center, AnchorAxis.End, AnchorAxis.Stretch]) {
            for (const v of [AnchorAxis.Start, AnchorAxis.Center, AnchorAxis.End, AnchorAxis.Stretch]) {
                S.commands.setUINodeAnchor([id], { h, v });
                expect(detectAnchor(host.world.get(e, UINode))).toEqual({ h, v });
            }
        }
    });

    it('applies to a multi-selection in one undo step', () => {
        const a = withUINode();
        const b = withUINode();
        S.commands.setUINodeAnchor([a.id, b.id], { h: AnchorAxis.Center, v: AnchorAxis.Start });
        expect(host.world.get(a.e, UINode).position).toBe(UIPositionType.Absolute);
        expect(host.world.get(b.e, UINode).position).toBe(UIPositionType.Absolute);
        S.history.undo();
        expect(host.world.get(a.e, UINode).position).toBe(UIPositionType.Relative);
        expect(host.world.get(b.e, UINode).position).toBe(UIPositionType.Relative);
    });
});
