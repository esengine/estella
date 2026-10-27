// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import type { PlanetFacts } from '../src/terrain/planetQuery';
import { Environment } from '../src/worldgen/fields';
import { PlanetFace, FaceZones, faceHalf, planetFaces } from '../src/worldgen/planetSurface';
import { WorldPlan } from '../src/worldgen/plan';
import type { WorldRules } from '../src/worldgen/rules';
import { Zones } from '../src/worldgen/zones';

const radius = 4000;
/** A planet whose ground is a gentle function of the direction, with a hill, so slope and height both vary. */
/** A planet whose ground is `height` of the direction, answered for many directions at once as a provider does. */
const planetOf = (height: (dx: number, dy: number, dz: number) => number): PlanetFacts => ({
    centre: [0, -radius, 0], radius, gravity: 0, paint: null, layers: [], fieldNames: [], fieldsAt: null, height,
    sampleMany: (directions, count) => {
        const heights = new Float32Array(count);
        for (let i = 0; i < count; i++) heights[i] = height(directions[i * 3]!, directions[i * 3 + 1]!, directions[i * 3 + 2]!);
        return { heights };
    },
});
const facts = planetOf((dx, dy, dz) => 6 + 5 * Math.sin(dx * 40) * Math.cos(dz * 33) + 3 * dy);
const planet = (): PlanetFacts => facts;

const rules: WorldRules = {
    id: 't', versions: [1],
    biomes: [{ id: 'meadow', conditions: [{ field: 'height', min: -100, max: 100 }], recipes: [{ recipe: 'tuft', layer: 'cover', density: 1 }] }],
    recipes: [{ id: 'tuft', version: 1, anchor: { id: 'a', mesh: 1, material: 1, footprint: 0.4 } }],
    layers: [{ id: 'cover', spacing: 6, drawDistance: 100 }],
};

describe('a planet\'s face as a plane', () => {
    const faces = planetFaces(planet);

    it('takes a point of the plane to the planet and back', () => {
        for (const f of faces) for (const [x, z] of [[0, 0], [300, -120], [-1500, 900], [2800, 2800]] as const) {
            const d = f.directionAt(x, z);
            expect(Math.hypot(...d)).toBeCloseTo(1, 12);
            const at = f.planeOf(d[0], d[1], d[2])!;
            expect(at.x).toBeCloseTo(x, 6);
            expect(at.z).toBeCloseTo(z, 6);
        }
    });

    it('puts a point at the radius plus its height, and its frame is square and up is the direction', () => {
        const f = faces[3]!;
        const w = f.world(120, 7, -300);
        const away = Math.hypot(w[0] - facts.centre[0], w[1] - facts.centre[1], w[2] - facts.centre[2]);
        expect(away).toBeCloseTo(radius + 7, 6);
        const fr = f.frameAt(120, -300);
        const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
        expect(dot(fr.eu, fr.dir)).toBeCloseTo(0, 9);
        expect(dot(fr.ev, fr.dir)).toBeCloseTo(0, 9);
        expect(dot(fr.eu, fr.ev)).toBeLessThan(0.05);
    });

    it('reads the ground and its normal, level ground facing up', () => {
        const flat = planetOf(() => 4);
        const f = new PlanetFace(2, () => flat);
        const g = f.ground(10, 20)!;
        expect(g.y).toBe(4);
        expect(g.up).toBeCloseTo(1, 9);
        expect(g.normal[1]).toBeCloseTo(1, 9);
        const tilted = planetOf((dx) => dx * 4000 * 0.5);
        const t = new PlanetFace(2, () => tilted).ground(0, 0)!;
        expect(t.up).toBeLessThan(0.95);
    });

    it('reads noise in three dimensions: a field has no seam where two faces meet', () => {
        const noiseOf = (face: PlanetFace) => new Environment({ seed: 5, ...face.environment() });
        const a = faces[0]!, b = faces[5]!;
        // The same point of the planet, found on two faces at their shared edge.
        const half = faceHalf(radius);
        const d = a.directionAt(half, 250);
        const pa = a.planeOf(d[0], d[1], d[2])!, pb = b.planeOf(d[0], d[1], d[2])!;
        expect(noiseOf(a).sample(pa.x, pa.z).moisture).toBeCloseTo(noiseOf(b).sample(pb.x, pb.z).moisture, 9);
    });

    it('lays a world out so every plant stands on the ground, and no two faces name a thing alike', () => {
        const names = new Set<string>();
        for (const f of faces) {
            const zones = new FaceZones(f);
            const env = new Environment({ seed: 9, noise: undefined, ...f.environment() });
            const plan = new WorldPlan(rules, env, zones.zones, 9, `w#${f.face}`);
            const found = plan.placementsIn(-120, -120, 120, 120, ['cover']);
            expect(found.length).toBeGreaterThan(10);
            for (const p of found) {
                const w = f.world(p.x, p.y, p.z);
                const g = f.ground(p.x, p.z)!;
                expect(p.y).toBeCloseTo(g.y, 6);
                expect(Math.hypot(w[0] - facts.centre[0], w[1] - facts.centre[1], w[2] - facts.centre[2])).toBeCloseTo(radius + g.y, 5);
                names.add(`f${f.face}:${p.id}`);
            }
        }
        expect(names.size).toBeGreaterThan(60);
    });
});

describe('the zones of a world over a planet\'s faces', () => {
    it('are kept on the face their centre falls on, in its plane', () => {
        const faces = planetFaces(planet);
        const spot = faces[2]!.world(300, 0, -150);
        const zone = { id: 'home', kind: 'home', shape: { type: 'circle' as const, x: spot[0], y: spot[1], z: spot[2], radius: 20 }, falloff: 5, priority: 1, excludes: ['*'] };
        const mine = faces[2]!.zoneOnFace(zone)!;
        expect(mine.shape.type).toBe('circle');
        expect(mine.shape.x).toBeCloseTo(300, 4);
        expect(mine.shape.z).toBeCloseTo(-150, 4);
        expect(faces[3]!.zoneOnFace(zone)).toBeNull();
        const fz = new FaceZones(faces[2]!);
        fz.sync([zone]);
        expect([...fz.zones.all()].length).toBe(1);
        fz.sync([]);
        expect([...fz.zones.all()].length).toBe(0);
        void Zones;
    });
});
