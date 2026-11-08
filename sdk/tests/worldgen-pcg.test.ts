// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { Environment, type EnvironmentInputs } from '../src/worldgen/fields';
import { fitGroundFootprint, type GroundingOptions } from '../src/worldgen/grounding';
import { roadZones, setRoad, removeRoad } from '../src/worldgen/roads';
import { WorldPlan } from '../src/worldgen/plan';
import { Zones, zoneDistance } from '../src/worldgen/zones';
import { parseWorldRules } from '../src/worldgen/rulesAsset';
import type { WorldRules } from '../src/worldgen/rules';
import { placements, type PlaneSpec } from '../src/worldgen/planWorker';

const flat: EnvironmentInputs = { seed: 7, ground: () => ({ y: 10, up: 1 }) };
const base: GroundingOptions = { size: [8, 4], maxRelief: 4 };
const rules = (): WorldRules => ({
    id: 'pcg', versions: [1],
    biomes: [{ id: 'plain', conditions: [], recipes: [{ recipe: 'house', layer: 'buildings', density: 1 }, { recipe: 'pine', layer: 'forest', density: 1 }] }],
    recipes: [
        { id: 'house', version: 1, anchor: { id: 'base', mesh: 1, footprint: 1, scale: [1.1, 1.8], grounding: base } },
        { id: 'pine', version: 1, tags: ['tree'], anchor: { id: 'tree', mesh: 2, footprint: 1, scale: [1, 3], scaleFootprint: true } },
    ],
    layers: [{ id: 'buildings', spacing: 30, drawDistance: 200 }, { id: 'forest', spacing: 8, drawDistance: 200 }],
});
const plan = (r = rules(), zones = new Zones(), inputs = flat) => new WorldPlan(r, new Environment(inputs), zones, 7, 'world');

describe('building ground fit', () => {
    it('rotates and scales the entire base with the engine yaw convention', () => {
        const inputs = { ground: (x: number, z: number) => ({ y: x + 2 * z, up: 1 }) };
        const r = fitGroundFootprint(inputs, 10, 20, Math.PI / 2, 2, { size: [8, 4], samples: 5, offset: 0.5 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.fit).toMatchObject({ min: 30, max: 70, mean: 50, relief: 40, y: 71, supportDepth: 41, buriedDepth: 0, samples: 25 });
    });
    it('checks edges for missing ground, steep slopes and water even when the centre is safe', () => {
        const edge = (x: number, z: number) => Math.abs(x) >= 4 && Math.abs(z) >= 2;
        const fit = (inputs: Pick<EnvironmentInputs, 'ground' | 'waterDepth'>) => fitGroundFootprint(inputs, 0, 0, 0, 1, base, { minUp: 0.8 });
        expect(fit({ ground: (x, z) => edge(x, z) ? null : { y: 10, up: 1 } })).toEqual({ ok: false, reason: 'noGround' });
        expect(fit({ ground: (x, z) => ({ y: 10, up: edge(x, z) ? 0.4 : 1 }) })).toEqual({ ok: false, reason: 'slope' });
        expect(fit({ ...flat, waterDepth: (x, z) => edge(x, z) ? 1 : 0 })).toEqual({ ok: false, reason: 'water' });
    });
    it('rejects excessive relief and reports foundation support and burial separately', () => {
        const slope = { ground: (x: number) => ({ y: x, up: 1 }) };
        expect(fitGroundFootprint(slope, 0, 0, 0, 1, base)).toEqual({ ok: false, reason: 'relief' });
        for (const [mode, y, supportDepth, buriedDepth] of [['highest', 4, 8, 0], ['lowest', -4, 0, 8], ['mean', 0, 4, 4], ['center', 0, 4, 4]] as const) {
            const r = fitGroundFootprint(slope, 0, 0, 0, 1, { size: [8, 4], mode });
            expect(r).toMatchObject({ ok: true, fit: { y, supportDepth, buriedDepth } });
        }
    });
    it('rejects invalid dimensions, unbounded grids, modes and offsets before sampling', () => {
        for (const patch of [{ size: [0, 4] }, { samples: 100000 }, { samples: 4 }, { mode: 'bad' }, { offset: Infinity }, { maxRelief: -1 }]) {
            expect(() => fitGroundFootprint(flat, 0, 0, 0, 1, { ...base, ...patch } as GroundingOptions)).toThrow(/grounding/);
        }
    });
});

describe('PCG road reservations', () => {
    it('covers diagonal segments, sharp joins and round ends, without reserving distant land', () => {
        const zs = roadZones({ id: 'trail', points: [[0, 0], [20, 20], [40, 0]], width: 4, clearance: 1 });
        const inside = (x: number, z: number) => zs.some((q) => zoneDistance(q.shape, x, z) <= 0);
        for (const [x, z] of [[0, -2.9], [10, 10], [20, 22.9], [30, 10], [42.9, 0]]) expect(inside(x!, z!)).toBe(true);
        expect(inside(20, 0)).toBe(false);
        expect(inside(0, 5)).toBe(false);
    });
    it('replaces shortened roads idempotently, removes stale joins and preserves other roads', () => {
        const z = new Zones();
        setRoad(z, { id: 'a', points: [[0, 0], [20, 0], [40, 0]], width: 4 });
        setRoad(z, { id: 'a/b', points: [[100, 0], [120, 0]], width: 4 });
        const short = { id: 'a', points: [[0, 0], [10, 0]] as [number, number][], width: 4 };
        setRoad(z, short); const rev = z.revision; setRoad(z, short);
        expect(z.revision).toBe(rev);
        expect(z.at(40, 0)).toHaveLength(0);
        expect(z.at(100, 0).length).toBeGreaterThan(0);
        const before = [...z.all()];
        expect(() => setRoad(z, { ...short, width: -1 })).toThrow(/width/);
        expect([...z.all()]).toEqual(before);
        removeRoad(z, 'a');
        expect(z.at(0, 0)).toHaveLength(0);
        expect(z.at(100, 0).length).toBeGreaterThan(0);
    });
    it('keeps scaled trees and whole building bases clear of roads and one another', () => {
        const z = new Zones(); setRoad(z, { id: 'main', points: [[-100, 0], [100, 0]], width: 6 });
        const ps = plan(rules(), z).placementsIn(-90, -90, 90, 90);
        expect(ps.some((p) => p.grounding)).toBe(true);
        expect(ps.some((p) => p.recipe === 'pine')).toBe(true);
        for (const p of ps) {
            expect(Math.abs(p.z)).toBeGreaterThanOrEqual(3 + p.footprint);
            if (p.grounding) expect(p.footprint).toBeCloseTo(Math.hypot(8, 4) * p.scale / 2);
            else expect(p.footprint).toBe(p.scale);
            for (const q of ps) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z) + 1e-9).toBeGreaterThanOrEqual(p.footprint + q.footprint);
        }
    });
    it('preserves existing world-space footprints unless model scaling is requested', () => {
        const r = rules(); delete r.recipes[1]!.anchor.scaleFootprint;
        expect(plan(r).placementsIn(-60, -60, 60, 60, ['forest']).every((p) => p.footprint === 1)).toBe(true);
    });
    it('is independent of chunk order and identical in a worker plan', async () => {
        const r = rules(), z = new Zones(); setRoad(z, { id: 'r', points: [[-70, -20], [0, 30], [70, -20]], width: 7 });
        const a = plan(r, z), b = plan(r, z);
        const cells = [[-64, -64], [0, -64], [-64, 0], [0, 0]] as const;
        const sort = (ps: ReturnType<WorldPlan['placementsIn']>) => ps.sort((x, y) => x.id.localeCompare(y.id));
        const forward = cells.flatMap(([x, z]) => a.placementsIn(x, z, x + 64, z + 64));
        const reverse = [...cells].reverse().flatMap(([x, z]) => b.placementsIn(x, z, x + 64, z + 64));
        expect(sort(forward)).toEqual(sort(reverse));
        const spec: PlaneSpec = { plane: true, rules: r, seed: 7, world: 'world', ground: null, flatY: 10, water: null, layers: [], zones: [...z.all()] };
        const remote = (await Promise.all(r.layers.map((l) => placements({ id: 1, key: 'pcg-test', spec, layer: l.id, far: false, x0: -64, z0: -64, x1: 64, z1: 64 })))).flat();
        expect(sort(remote)).toEqual(sort(forward));
    });
    it('exposes relief rejections and validates new fields when loading files', () => {
        const r = rules(), p = plan(r, new Zones(), { seed: 7, ground: (x) => ({ y: x * 4, up: 1 }) });
        expect(p.stats('buildings', -60, -60, 60, 60).relief).toBe(16);
        const roundtrip = parseWorldRules(JSON.parse(JSON.stringify(r)), 'pcg.esworld');
        expect(roundtrip.recipes[0]!.anchor.grounding).toEqual(base);
        r.recipes[0]!.anchor.grounding = { ...base, samples: 4 };
        expect(() => parseWorldRules(r, 'pcg.esworld')).toThrow(/pcg.esworld.recipes\[0\].anchor.*grounding.samples/);
        r.recipes[0]!.anchor.grounding = base; r.recipes[0]!.anchor.attach = 'align';
        expect(() => parseWorldRules(r)).toThrow(/upright/);
    });
});
