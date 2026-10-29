// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Graphics: a script draws a path and keeps it until `clear()`; it becomes the geometry of the node's own mesh renderer, in the node's space.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { MeshRenderer, Transform, ensureBuiltinComponentsRegistered, type MeshRendererGeometry } from '../../src/ecs/component';
import type { MeshRendererAPI } from '../../src/render/meshRenderer';
import { Color, Graphics, Line, Node, Vec3 } from '../../src/cocos';
import { setGraphicsMeshApi } from '../../src/cocos/ui/graphics';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';
import { pointerApp, type PointerApp } from './helpers/pointerApp';

/** The geometry API, recording what a Graphics hands it. */
class FakeMeshApi {
    geometry = new Map<number, MeshRendererGeometry>();
    setGeometry(entity: number, g: MeshRendererGeometry): void { this.geometry.set(entity, g); }
    clearGeometry(entity: number): void { this.geometry.delete(entity); }
}

describe.skipIf(!HAS_WASM)('Graphics', () => {
    let module: ESEngineModule;
    let P: PointerApp | undefined;
    let api: FakeMeshApi;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    beforeEach(() => { api = new FakeMeshApi(); setGraphicsMeshApi(api as unknown as MeshRendererAPI); });
    afterEach(() => { setGraphicsMeshApi(null); P?.dispose(); P = undefined; });

    async function graphics(): Promise<{ node: Node; g: Graphics }> {
        P = pointerApp(module);
        const node = new Node('g');
        P.app.world.insert(node._entity, Transform);
        const g = node.addComponent<Graphics>('Graphics')!;
        await P.frame(1);
        return { node, g };
    }

    const shown = (node: Node): MeshRendererGeometry | undefined => api.geometry.get(node._entity as number);
    const bounds = (g: MeshRendererGeometry) => {
        const xs = g.positions.filter((_, i) => i % 2 === 0), ys = g.positions.filter((_, i) => i % 2 === 1);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    };

    it('fills a rectangle as the triangles of its corners, in the fill colour, on the node\'s own mesh', async () => {
        const { node, g } = await graphics();
        g.fillColor = new Color(255, 0, 0, 255);
        g.rect(10, 20, 30, 40);
        g.fill();
        await P!.frame(1);
        const geometry = shown(node)!;
        expect(geometry.indices).toHaveLength(6);
        expect(bounds(geometry)).toEqual({ minX: 10, maxX: 40, minY: 20, maxY: 60 });
        expect(geometry.colors!.slice(0, 4)).toEqual([1, 0, 0, 1]);
        expect(P!.app.world.has(node._entity, MeshRenderer)).toBe(true);
    });

    it('fills a path that is not a rectangle: a triangle, a rounded rectangle, a circle', async () => {
        const { node, g } = await graphics();
        g.moveTo(0, 0);
        g.lineTo(10, 0);
        g.lineTo(5, 8);
        g.close();
        g.fill();
        await P!.frame(1);
        expect(shown(node)!.indices).toHaveLength(3);

        g.clear();
        g.roundRect(0, 0, 40, 20, 6);
        g.fill();
        await P!.frame(1);
        expect(shown(node)!.indices.length).toBeGreaterThan(30);

        g.clear();
        g.circle(0, 0, 10);
        g.fill();
        await P!.frame(1);
        const b = bounds(shown(node)!);
        expect(b.maxX).toBeCloseTo(10, 4);
        expect(b.minY).toBeCloseTo(-10, 0);
    });

    it('strokes a path at the line width, in the stroke colour', async () => {
        const { node, g } = await graphics();
        g.lineWidth = 4;
        g.strokeColor = new Color(0, 255, 0, 255);
        g.moveTo(0, 0);
        g.lineTo(100, 0);
        g.stroke();
        await P!.frame(1);
        const geometry = shown(node)!;
        const b = bounds(geometry);
        expect(b.maxX - b.minX).toBeGreaterThanOrEqual(100);
        expect(b.maxY - b.minY).toBeCloseTo(4, 4);       // butt caps: as wide as the line
        expect(geometry.colors!.slice(0, 4)).toEqual([0, 1, 0, 1]);
    });

    it('rounds the ends of a stroke when the cap is round', async () => {
        const { node, g } = await graphics();
        g.lineWidth = 10;
        g.lineCap = Graphics.LineCap.ROUND;
        g.moveTo(0, 0);
        g.lineTo(100, 0);
        g.stroke();
        await P!.frame(1);
        const b = bounds(shown(node)!);
        expect(b.minX).toBeCloseTo(-5, 1);   // the cap is a round of short flat pieces
        expect(b.maxX).toBeCloseTo(105, 1);
    });

    it('keeps what was drawn until it is cleared, and a path begun after a draw starts afresh', async () => {
        const { node, g } = await graphics();
        g.rect(0, 0, 5, 5);
        g.fill();
        g.rect(20, 0, 5, 5);
        g.fill();
        await P!.frame(1);
        expect(shown(node)!.indices).toHaveLength(12);        // two rectangles, the first not drawn a second time
        g.clear();
        await P!.frame(1);
        expect(shown(node)).toBeUndefined();
    });

    it('draws nothing while it is disabled and comes back when it is enabled', async () => {
        const { node, g } = await graphics();
        g.rect(0, 0, 5, 5);
        g.fill();
        await P!.frame(1);
        g.enabled = false;
        await P!.frame(1);
        expect(shown(node)).toBeUndefined();
        g.enabled = true;
        await P!.frame(2);
        expect(shown(node)).toBeDefined();
    });

    it('draws a Line as a stroked polyline, carrying a world-space line back through its node', async () => {
        P = pointerApp(module);
        const node = new Node('line');
        P.app.world.insert(node._entity, Transform);
        node.setPosition(100, 50, 0);
        node.setScale(new Vec3(2, 2, 1));
        const line = node.addComponent<Line>('Line')!;
        line.width = 4;
        line.color = new Color(0, 0, 255, 255);
        line.worldSpace = true;
        line.positions = [{ x: 100, y: 50, z: 0 }, { x: 140, y: 50, z: 0 }];   // 40 along in the world: 20 in the node's own scaled space
        await P.frame(2);
        const geometry = api.geometry.get(node._entity as number)!;
        const b = bounds(geometry);
        expect(b.minX).toBeCloseTo(0, 3);
        expect(b.maxX).toBeCloseTo(20, 3);
        expect(geometry.colors!.slice(0, 4)).toEqual([0, 0, 1, 1]);
        line.worldSpace = false;
        line.positions = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
        await P.frame(2);
        expect(bounds(api.geometry.get(node._entity as number)!).maxX).toBeCloseTo(10, 3);
    });
});
