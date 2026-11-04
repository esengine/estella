// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, MeshRenderer } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { ChainCollider2D } from '../src/physics/PhysicsComponents';
import { MeshRenderers } from '../src/render/meshRenderer';
import { Parent } from '../src/ecs/component';
import { Spline } from '../src/spline/splinePlugin';
import { TerrainBand2D, buildTerrainBand, installTerrainBands, type TerrainBand2DData } from '../src/spline/terrainBand2D';
import { triangulateRing } from '../src/render/vectorPath';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const band = (over: Partial<TerrainBand2DData> = {}): TerrainBand2DData => ({
    resolution: 50, depth: 50, tile: 100, edgeWidth: 0, edgeColor: { r: 0, g: 1, b: 0, a: 1 }, edgeTexture: 0, edgeTile: 64, collider: false, ...over,
});
const pt = (x: number, y: number) => ({ x, y, z: 0, width: 1 });

/** The summed area of the triangles of a geometry, from `from` to `to` indices. */
function coverage(g: { positions: number[]; indices: number[] }, from = 0, to = g.indices.length): number {
    let a = 0;
    for (let i = from; i < to; i += 3) {
        const [p, q, r] = [g.indices[i]!, g.indices[i + 1]!, g.indices[i + 2]!];
        const ax = g.positions[p * 2]!, ay = g.positions[p * 2 + 1]!;
        a += Math.abs((g.positions[q * 2]! - ax) * (g.positions[r * 2 + 1]! - ay) - (g.positions[r * 2]! - ax) * (g.positions[q * 2 + 1]! - ay)) / 2;
    }
    return a;
}

describe('triangulateRing', () => {
    it('covers a square the same way round either way', () => {
        const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
        const g = (r: typeof ring) => ({ positions: r.flatMap((p) => [p.x, p.y]), indices: triangulateRing(r) });
        expect(coverage(g(ring))).toBeCloseTo(100);
        expect(coverage(g(ring.slice().reverse()))).toBeCloseTo(100);
    });
});

describe('buildTerrainBand', () => {
    it('fills an open profile from its curve down to the depth', () => {
        const b = buildTerrainBand([pt(0, 0), pt(100, 0)], false, band())!;
        // 100 wide, 50 deep.
        expect(coverage(b.geometry)).toBeCloseTo(5000, 0);
        expect(b.closed).toBe(false);
        expect(b.outline[0]).toEqual({ x: 0, y: 0 });
        expect(b.outline[b.outline.length - 1]!.x).toBeCloseTo(100);
    });

    it('goes left to right whichever way the profile was drawn', () => {
        const a = buildTerrainBand([pt(0, 0), pt(100, 0)], false, band())!;
        const r = buildTerrainBand([pt(100, 0), pt(0, 0)], false, band())!;
        expect(coverage(r.geometry)).toBeCloseTo(coverage(a.geometry), 0);
        expect(r.outline[0]!.x).toBeCloseTo(0);
    });

    it('fills what a closed spline encloses, wound either way', () => {
        const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];
        const b = buildTerrainBand(square, true, band({ resolution: 10 }))!;
        expect(b.closed).toBe(true);
        // The triangles cover exactly the ring the curve was cut into (the curve bulges past the square's corners, so not the square's 10000).
        let ring = 0;
        for (let i = 0; i < b.outline.length; i++) { const a = b.outline[i]!, c = b.outline[(i + 1) % b.outline.length]!; ring += a.x * c.y - c.x * a.y; }
        expect(coverage(b.geometry)).toBeCloseTo(Math.abs(ring) / 2, 0);
        expect(coverage(b.geometry)).toBeGreaterThan(10000);
        const flipped = buildTerrainBand(square.slice().reverse(), true, band({ resolution: 10 }))!;
        expect(coverage(flipped.geometry)).toBeCloseTo(coverage(b.geometry), 0);
    });

    it('draws a lip only when it has a width, under the surface and over the fill', () => {
        const none = buildTerrainBand([pt(0, 0), pt(100, 0)], false, band())!;
        const lip = buildTerrainBand([pt(0, 0), pt(100, 0)], false, band({ edgeWidth: 10 }))!;
        expect(lip.geometry.indices.length).toBeGreaterThan(none.geometry.indices.length);
        // The fill's triangles come first, then the lip's: 100 x 10 of them, on the fill side of the curve (below it).
        const fillIndices = none.geometry.indices.length;
        expect(coverage(lip.geometry, fillIndices)).toBeCloseTo(1000, 0);
        const edgeVertices = lip.geometry.positions.slice(none.geometry.positions.length);
        for (let i = 1; i < edgeVertices.length; i += 2) {
            expect(edgeVertices[i]!).toBeLessThanOrEqual(1e-6);
            expect(edgeVertices[i]!).toBeGreaterThanOrEqual(-10 - 1e-6);
        }
        // The lip is the lip's colour, the fill is white.
        expect(lip.geometry.colors!.slice(0, 4)).toEqual([1, 1, 1, 1]);
        expect(lip.geometry.colors!.slice(none.geometry.positions.length / 2 * 4, none.geometry.positions.length / 2 * 4 + 4)).toEqual([0, 1, 0, 1]);
    });

    it('lays the fill\'s texture in world units, so it repeats at one size', () => {
        const b = buildTerrainBand([pt(0, 0), pt(200, 0)], false, band({ tile: 100 }))!;
        const last = b.outline.length - 1;
        expect(b.geometry.uvs![last * 2]).toBeCloseTo(2);
    });

    it('draws a lip with an image as a mesh of its own, the image laid by distance along the surface', () => {
        const flat = buildTerrainBand([pt(0, 0), pt(200, 0)], false, band({ edgeWidth: 10 }))!;
        const b = buildTerrainBand([pt(0, 0), pt(200, 0)], false, band({ edgeWidth: 10, edgeTexture: 7, edgeTile: 50 }))!;
        // The fill is the same without the lip in it, and the lip is its own.
        const none = buildTerrainBand([pt(0, 0), pt(200, 0)], false, band())!;
        expect(b.geometry.indices.length).toBe(none.geometry.indices.length);
        expect(flat.edge).toBeNull();
        const e = b.edge!;
        expect(coverage(e)).toBeCloseTo(2000, 0);
        // v is 0 on the surface and 1 at the lip's inner edge; u runs 0 to 4 over 200 units at 50 a repeat.
        const us = e.uvs!.filter((_, i) => i % 2 === 0), vs = e.uvs!.filter((_, i) => i % 2 === 1);
        expect(new Set(vs)).toEqual(new Set([0, 1]));
        expect(Math.min(...us)).toBeCloseTo(0);
        expect(Math.max(...us)).toBeCloseTo(4, 1);
        expect(e.colors!.every((c) => c === 1)).toBe(true);
    });

    it('builds nothing from one point', () => {
        expect(buildTerrainBand([pt(0, 0)], false, band())).toBeNull();
    });
});

describe.skipIf(!HAS_WASM)('TerrainBand2D system', () => {
    let engine: ESEngineModule, registry: CppRegistry, world: World;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); });
    afterEach(() => { for (const e of world.getAllEntities()) world.despawn(e); world.disconnectCpp(); registry.delete(); });

    function install() {
        const uploads: number[] = [];
        const held = new Set<number>();
        const api = {
            setGeometry: (e: number) => { uploads.push(e); held.add(e); },
            clearGeometry: (e: number) => { held.delete(e); },
            getGeometry: (e: number) => (held.has(e) ? {} : undefined),
        };
        let system: { _fn: () => void } | null = null;
        const app = {
            world,
            hasResource: (r: unknown) => r === MeshRenderers,
            getResource: () => api,
            addSystemToSchedule: (_s: unknown, def: { _fn: () => void }) => { system = def; },
        };
        installTerrainBands(app as never);
        return { run: () => system!._fn(), uploads, lose: (e: number) => { held.delete(e); } };
    }

    function ground(over: Partial<TerrainBand2DData> = {}) {
        const e = world.spawn();
        world.insert(e, Transform);
        world.insert(e, Spline, { points: [pt(0, 0), pt(100, 0), pt(200, 0), pt(300, 0)], closed: false });
        world.insert(e, TerrainBand2D, band(over));
        return e;
    }

    it('gives the entity a MeshRenderer and uploads its mesh once, until something changes', () => {
        const { run, uploads } = install();
        const e = ground();
        run(); run();
        expect(world.has(e, MeshRenderer)).toBe(true);
        expect(uploads).toEqual([e]);
        world.insert(e, TerrainBand2D, band({ edgeWidth: 8 }));
        run();
        expect(uploads).toEqual([e, e]);
    });

    it('builds the mesh again when the editor has cleared it', () => {
        const { run, uploads, lose } = install();
        const e = ground();
        run();
        lose(e);
        run();
        expect(uploads).toEqual([e, e]);
    });

    it('draws a lip that has an image on an entity under the band, and takes it away with the image', () => {
        const { run } = install();
        const e = ground({ edgeWidth: 8, edgeTexture: 7 });
        run();
        const kids = () => world.getAllEntities().filter((c) => c !== e && world.has(c, Parent) && (world.get(c, Parent) as { entity: number }).entity === e);
        const [lip] = kids();
        expect(lip).toBeDefined();
        expect((world.get(lip!, MeshRenderer) as { texture: number }).texture).toBe(7);
        world.insert(e, TerrainBand2D, band({ edgeWidth: 8, edgeTexture: 0 }));
        run();
        expect(kids().length).toBe(0);
    });

    it('writes a chain collider along the surface in physics units, and takes it back', () => {
        const { run } = install();
        const e = ground({ collider: true });
        run();
        const chain = world.get(e, ChainCollider2D);
        expect(chain.isLoop).toBe(false);
        // 100 pixels to the unit by default.
        expect(chain.points[chain.points.length - 1]!.x).toBeCloseTo(3);
        world.insert(e, TerrainBand2D, band({ collider: false }));
        run();
        expect(world.has(e, ChainCollider2D)).toBe(false);
    });
});
