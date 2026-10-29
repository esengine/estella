// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Graphics: a script draws a path and keeps it until `clear()`; each frame it is played into the engine's `Draw`, in the node's place.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { Color, Graphics, Node, Vec3 } from '../../src/cocos';
import { clearDrawCallbacks, getDrawCallbacks } from '../../src/render/customDraw';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';
import { pointerApp, type PointerApp } from './helpers/pointerApp';

const calls: Array<{ op: string; args: any[] }> = [];
vi.mock('../../src/render/draw', () => ({
    Draw: new Proxy({}, { get: (_t, op: string) => (...args: unknown[]) => { calls.push({ op, args }); } }),
}));

describe.skipIf(!HAS_WASM)('Graphics', () => {
    let module: ESEngineModule;
    let P: PointerApp | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    beforeEach(() => { calls.length = 0; });
    afterEach(() => { clearDrawCallbacks(); P?.dispose(); P = undefined; });

    async function graphics(x = 0, y = 0, scale = 1): Promise<{ node: Node; g: Graphics }> {
        P = pointerApp(module);
        const node = new Node('g');
        P.app.world.insert(node._entity, Transform);
        node.setPosition(x, y, 0);
        node.setScale(new Vec3(scale, scale, 1));
        const g = node.addComponent<Graphics>('Graphics')!;
        await P.frame(1);
        return { node, g };
    }

    /** Play the frame's draw callbacks, as the renderer does. */
    const paint = (): void => { calls.length = 0; for (const entry of getDrawCallbacks().values()) entry.fn(); };

    it('fills a rectangle where its node is', async () => {
        const { g } = await graphics(100, 50);
        g.fillColor = new Color(255, 0, 0, 255);
        g.rect(0, 0, 20, 10);
        g.fill();
        paint();
        expect(calls).toHaveLength(1);
        expect(calls[0]!.op).toBe('rect');
        expect(calls[0]!.args[0]).toEqual({ x: 100, y: 50 });
        expect(calls[0]!.args[1]).toEqual({ x: 20, y: 10 });
        expect(calls[0]!.args[2]).toMatchObject({ r: 1, g: 0, b: 0, a: 1 });
    });

    it('keeps what it drew until it is cleared, and draws it again every frame', async () => {
        const { g } = await graphics();
        g.circle(0, 0, 10);
        g.fill();
        paint();
        paint();
        expect(calls.map((c) => c.op)).toEqual(['circle']);
        g.clear();
        paint();
        expect(calls).toEqual([]);
    });

    it('strokes a path as lines of the stroke colour and width, scaled with the node', async () => {
        const { g } = await graphics(0, 0, 2);
        g.lineWidth = 3;
        g.strokeColor = new Color(0, 255, 0, 255);
        g.moveTo(0, 0);
        g.lineTo(10, 0);
        g.lineTo(10, 10);
        g.stroke();
        paint();
        expect(calls.map((c) => c.op)).toEqual(['line', 'line']);
        expect(calls[0]!.args[1]).toEqual({ x: 20, y: 0 });
        expect(calls[0]!.args[3]).toBe(6);
        expect(calls[1]!.args[1]).toEqual({ x: 20, y: 20 });
    });

    it('closes a path back to its start', async () => {
        const { g } = await graphics();
        g.moveTo(0, 0);
        g.lineTo(10, 0);
        g.lineTo(0, 10);
        g.close();
        g.stroke();
        paint();
        expect(calls).toHaveLength(3);
    });

    it('starts a new path after something was drawn, so earlier shapes are not drawn again', async () => {
        const { g } = await graphics();
        g.rect(0, 0, 5, 5);
        g.fill();
        g.rect(20, 0, 5, 5);
        g.fill();
        paint();
        expect(calls.map((c) => c.op)).toEqual(['rect', 'rect']);
        expect(calls[1]!.args[0]).toEqual({ x: 20, y: 0 });
    });

    it('stops drawing when it is disabled', async () => {
        const { g } = await graphics();
        g.rect(0, 0, 5, 5);
        g.fill();
        g.enabled = false;
        await P!.frame(1);   // the lifecycle runs with the frame
        paint();
        expect(calls).toEqual([]);
    });
});
