// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A land written as steps: what each op does to the ground, what the report measures of it (a road's grade, a river's falls,
 * how much is walkable, how much is creased), and what it refuses.
 */
import { describe, expect, it } from 'vitest';
import {
    applyLandEdits, bakeLand, describeLandOps, LAND_OPS, landHeightAt, landProfile, probeLand, renderLandProfile, renderLandSheet, LandBuildError,
    type LandSource, type LandStep,
} from '../src/land';

const land = (steps: LandStep[], over: Partial<LandSource> = {}) => bakeLand({ version: 1, size: [1000, 1000], resolution: 257, steps, ...over });
const flat: LandStep = { op: 'fill', height: 10 };

describe('shaping ground', () => {
    it('fills, and raises a hill to its height with a level top', () => {
        const l = land([flat, { op: 'hill', at: [0, 0], radius: 200, height: 50, flat: 40 }]);
        expect(landHeightAt(l, 0, 0)).toBeCloseTo(60, 3);
        expect(landHeightAt(l, 30, 0)).toBeCloseTo(60, 1);
        expect(landHeightAt(l, 450, 0)).toBeCloseTo(10, 3);
        expect(l.report.steps.map((s) => [s.op, s.raised, s.lowered])).toEqual([['fill', 10, 0], ['hill', 50, 0]]);
    });

    it('stands pillars with shoulders and splinters when asked, and as bare shafts when not', () => {
        const forest = (more: object) => land([flat, { op: 'pillars', at: [0, 0], radius: 400, spacing: 120, height: [80, 80], width: [50, 50], clearings: 0, seed: 5, ...more } as LandStep]);
        const bare = forest({}), stepped = forest({ ledges: 2 }), split = forest({ cluster: 1 });
        // How much rock stands: shoulders and splinters are rock the bare shafts do not have, and the tops are no higher for them.
        const rock = (l: ReturnType<typeof land>) => { let sum = 0; for (let z = -300; z <= 300; z += 10) for (let x = -300; x <= 300; x += 10) sum += landHeightAt(l, x, z) - 10; return sum; };
        expect(rock(stepped)).toBeGreaterThan(rock(bare) * 1.3);
        expect(rock(split)).toBeGreaterThan(rock(bare) * 1.05);
        expect(stepped.report.max).toBeLessThan(bare.report.max + 8);
        expect(bare.report.max).toBeGreaterThan(80);
    });

    it('stands models where the land says: one to a cell where the mask allows, sunk under the lowest ground at their foot', () => {
        const slope: LandStep[] = [flat, { op: 'hill', at: [0, 0], radius: 300, height: 100 }];
        const l = land(slope, { stands: [
            { name: 'rocks', models: [{ mesh: 'a.esmesh' }, { mesh: 'b.esmesh', material: 'b.esmaterial' }], spacing: 100, where: { within: { at: [0, 0], radius: 200 } }, scale: [0.5, 2], sink: 3, foot: 20, lean: 10, seed: 4 },
            { name: 'gate', models: [{ mesh: 'arch.esmesh' }], at: [[400, 400, 2, 90]], collide: false },
        ] });
        const rocks = l.stands[0]!, gate = l.stands[1]!;
        expect(l.report.stands).toEqual([{ name: 'rocks', count: rocks.places.length }, { name: 'gate', count: 1 }]);
        // About one to a cell inside the circle (pi * 200^2 / 100^2 is 12.6), none far outside it, and both models used.
        expect(rocks.places.length).toBeGreaterThan(6);
        expect(rocks.places.length).toBeLessThan(24);
        for (const p of rocks.places) {
            expect(Math.hypot(p.x, p.z)).toBeLessThan(330);
            expect(p.scale).toBeGreaterThanOrEqual(0.5); expect(p.scale).toBeLessThanOrEqual(2);
            expect(p.lean).toBeLessThanOrEqual(10);
            // In the ground: under the ground at its own place by its sink at the least, since the foot looks for lower ground round it.
            expect(p.y).toBeLessThanOrEqual(landHeightAt(l, p.x, p.z) - 3 * p.scale + 0.01);
        }
        expect(new Set(rocks.places.map((p) => p.model)).size).toBe(2);
        expect(rocks.collide).toBe(true);
        expect(gate).toMatchObject({ collide: false, places: [{ model: 0, x: 400, z: 400, scale: 2, turn: 90 }] });
        // The same source stands the same things.
        expect(land(slope, { stands: l.source.stands }).stands).toEqual(l.stands);
        expect(() => land([flat], { stands: [{ name: 'x', models: [], spacing: 10 }] })).toThrow(/models/);
        expect(land([flat], { stands: [{ name: 'none', models: [{ mesh: 'a.esmesh' }], spacing: 100, where: { above: 1000 } }] }).report.warnings.join(' ')).toMatch(/stands nowhere/);
    });

    it('takes a source written in another unit: every length is multiplied, and nothing that is not a length', () => {
        const steps: LandStep[] = [
            { op: 'fill', height: 0.1 }, { op: 'noise', amplitude: 0.2, scale: 3, octaves: 2, seed: 4 },
            { op: 'plateau', at: [1, 1], radius: 2, height: 0.9, edge: 0.4, tilt: [0.1, 0], where: { within: { at: [0, 0], radius: 4, feather: 1 }, noise: { scale: 2, cover: 0.9 }, gentler: 80 } },
            { op: 'road', name: 'way', path: [[-3, 0], [3, 0]], width: 0.2, grade: 0.2 },
        ];
        const stands = [{ name: 'rocks', models: [{ mesh: 'a.esmesh' }], spacing: 1, scale: [0.5, 2] as const, sink: 0.03, foot: 0.2, lean: 10, at: [[4, 4, 2, 90]], seed: 2 }];
        const metres = land(steps, { unit: 100, size: [10, 10], center: [1, -1], sea: 0.05, stands, layers: [{ name: 'rock', where: { steeper: 30, above: 0.5 } }] });
        const scaleStep = (s: LandStep): LandStep => {
            if (s.op === 'fill') return { ...s, height: 10 };
            if (s.op === 'noise') return { ...s, amplitude: 20, scale: 300 };
            if (s.op === 'plateau') return { ...s, at: [100, 100], radius: 200, height: 90, edge: 40, where: { within: { at: [0, 0], radius: 400, feather: 100 }, noise: { scale: 200, cover: 0.9 }, gentler: 80 } };
            return { ...s, path: [[-300, 0], [300, 0]], width: 20 } as LandStep;
        };
        const world = land(steps.map(scaleStep), { size: [1000, 1000], center: [100, -100], sea: 5, layers: [{ name: 'rock', where: { steeper: 30, above: 50 } }],
            stands: [{ ...stands[0]!, spacing: 100, sink: 3, foot: 20, at: [[400, 400, 2, 90]] }] });
        // The same land, sample for sample, and the same things standing on it.
        expect(metres.size).toEqual([1000, 1000]);
        expect(Array.from(metres.heights.subarray(0, 4000))).toEqual(Array.from(world.heights.subarray(0, 4000)));
        expect(metres.report.max).toBe(world.report.max);
        expect(metres.stands).toEqual(world.stands);
        expect(metres.report.roads[0]!.steepest.grade).toBe(world.report.roads[0]!.steepest.grade);
        // What it works from is in world units; a unit that is no number above 0 is refused.
        expect(metres.source.unit).toBeUndefined();
        expect(() => land([flat], { unit: 0 })).toThrow(/unit/);
    });

    it('keeps what grows: a plant by one of its maps, its lengths in the unit of the source, and refuses one with no map or no shape', () => {
        const maps = [{ name: 'meadow' }];
        const l = land([flat], { unit: 100, size: [10, 10], maps, plants: [
            { name: 'grass', map: 'meadow', blade: [0.3, 0.1, 0.6], count: 5000, cell: 16, near: 40, reach: 240, scale: [0.7, 1.3] },
            { name: 'oaks', map: 'meadow', mesh: 'oak.esmesh', texture: 'oak_color.png', count: 6, cell: 40 },
        ] });
        // Heights, widths and distances are lengths; a lean, a count and a scale are not.
        expect(l.source.plants![0]).toMatchObject({ blade: [30, 10, 0.6], count: 5000, cell: 1600, near: 4000, reach: 24000, scale: [0.7, 1.3] });
        expect(l.source.plants![1]).toMatchObject({ mesh: 'oak.esmesh', count: 6, cell: 4000 });
        expect(() => land([flat], { maps, plants: [{ name: 'x', map: 'forest', mesh: 'a.esmesh', count: 1 }] })).toThrow(/forest/);
        expect(() => land([flat], { maps, plants: [{ name: 'x', map: 'meadow', count: 1 }] })).toThrow(/mesh|blade/);
        expect(() => land([flat], { maps, plants: [{ name: 'x', map: 'meadow', mesh: 'a.esmesh', count: 0 }] })).toThrow(/count/);
    });

    it('places a plant with lods one by one: where its map is white, on the ground, the same every time', () => {
        const maps = [{ name: 'wood' }];
        const oaks = { name: 'oaks', map: 'wood', mesh: 'oak.esmesh', lods: ['oak1.esmesh', 'oak0.esmesh'], count: 2, cell: 100, scale: [0.8, 1.2] as const, sink: 5 };
        const l = land([flat], { maps, plants: [oaks, { name: 'grass', map: 'wood', blade: [30, 10], count: 100 }] });
        // Only the plant with lods is a grove; grass stays a field.
        expect(l.groves.map((g) => g.plant)).toEqual(['oaks']);
        const places = l.groves[0]!.places, count = places.length / 5;
        expect(l.report.groves).toEqual([{ plant: 'oaks', count }]);
        expect(count).toBeGreaterThan(40);
        expect(count).toBeLessThanOrEqual(200);
        for (let i = 0; i < places.length; i += 5) {
            // Each is x, y, z, a turn and a size: inside the land, sunk by its size under the ground.
            expect(Math.abs(places[i]!)).toBeLessThanOrEqual(500);
            expect(places[i + 4]!).toBeGreaterThanOrEqual(0.8);
            expect(places[i + 4]!).toBeLessThanOrEqual(1.2);
            expect(places[i + 1]!).toBeCloseTo(10 - 5 * places[i + 4]!, 0);
        }
        expect(land([flat], { maps, plants: [oaks] }).groves[0]!.places).toEqual(places);
        expect(land([flat], { maps, plants: [{ ...oaks, seed: 9 }] }).groves[0]!.places).not.toEqual(places);
    });

    it('sets a plateau level, with a cliff of the width asked round it', () => {
        const l = land([flat, { op: 'plateau', at: [0, 0], radius: 200, height: 90, edge: 40 }]);
        expect(landHeightAt(l, 0, 0)).toBeCloseTo(90, 3);
        expect(landHeightAt(l, 150, 0)).toBeCloseTo(90, 1);
        expect(landHeightAt(l, 260, 0)).toBeCloseTo(10, 1);
        // Half way down at the radius.
        expect(landHeightAt(l, 200, 0)).toBeGreaterThan(40);
        expect(landHeightAt(l, 200, 0)).toBeLessThan(60);
    });

    it('keeps a step to where its `where` says', () => {
        const l = land([flat, { op: 'hill', at: [0, 0], radius: 300, height: 100 }, { op: 'fill', height: 200, where: { above: 80, feather: 1 } }]);
        expect(landHeightAt(l, 0, 0)).toBeCloseTo(200, 0);
        expect(landHeightAt(l, 250, 0)).toBeLessThan(40);
    });

    it('says when a step changed nothing', () => {
        const l = land([flat, { op: 'hill', at: [9000, 9000], radius: 50, height: 10 }]);
        expect(l.report.warnings.join(' ')).toContain('changed nothing');
    });

    it('brings down what is steeper than a talus angle', () => {
        const steep = land([flat, { op: 'plateau', at: [0, 0], radius: 200, height: 110, edge: 12 }]);
        const eased = land([flat, { op: 'plateau', at: [0, 0], radius: 200, height: 110, edge: 12 }, { op: 'talus', angle: 35 }]);
        expect(steep.report.slopes.cliff).toBeGreaterThan(0.01);
        expect(eased.report.slopes.cliff).toBeLessThan(steep.report.slopes.cliff * 0.2);
    });
});

describe('round ground', () => {
    const edged: LandStep[] = [flat, { op: 'plateau', at: [0, 0], radius: 250, height: 60, edge: 8 }, { op: 'terrace', step: 12, sharp: 0.9 }];

    it('measures creases, and a smooth takes them out', () => {
        const before = land(edged), after = land([...edged, { op: 'smooth', radius: 40 }]);
        expect(before.report.creased).toBeGreaterThan(0.005);
        expect(after.report.creased).toBeLessThan(before.report.creased * 0.2);
        // Broad shapes keep their place: the plateau is still a plateau.
        expect(landHeightAt(after, 0, 0)).toBeCloseTo(60, 0);
    });

    it('leaves no new crease where a masked smooth ends', () => {
        const hills: LandStep[] = [flat, { op: 'ridge', path: [[-300, -200], [300, -150]], height: 260, width: 220, seed: 3 }];
        const before = land(hills), after = land([...hills, { op: 'smooth', radius: 30, where: { gentler: 40 } }]);
        expect(after.report.creased).toBeLessThanOrEqual(before.report.creased + 0.002);
    });
});

describe('water', () => {
    it('cuts a river\'s bed under its water, falling as its heights say', () => {
        const l = land([{ op: 'fill', height: 60 }, { op: 'river', name: 'r', path: [[-400, 0, 50], [400, 0, 20]], width: 20 }]);
        const river = l.report.rivers[0]!;
        expect(river.name).toBe('r');
        expect(river.points[0]!.y).toBe(50);
        expect(landHeightAt(l, -200, 0)).toBeLessThan(42.5);          // the bed, under the water at 42.5 there
        expect(landHeightAt(l, -200, 0)).toBeGreaterThan(36);
        expect(landHeightAt(l, -200, 300)).toBeCloseTo(60, 1);         // the country beyond its valley
        expect(probeLand(l, [[-200, 0]])[0]!.river).toBeLessThan(0);
    });

    it('refuses a river that rises, naming the point', () => {
        expect(() => land([flat, { op: 'river', path: [[-400, 0, 5], [0, 0, 9], [400, 0, 1]], width: 10 }])).toThrow(/rises from 5\.0 to 9\.0 at point 1/);
    });

    it('finds a fall where two points close together drop', () => {
        const l = land([{ op: 'fill', height: 100 }, { op: 'river', path: [[-400, 0, 90], [-10, 0, 88], [10, 0, 30], [400, 0, 25]], width: 16 }]);
        expect(l.report.rivers[0]!.falls).toHaveLength(1);
        expect(l.report.rivers[0]!.falls[0]!.drop).toBe(58);
        expect(l.report.rivers[0]!.falls[0]!.at).toEqual([-10, 88, 0]);
    });

    it('warns of a river carried above the ground it crosses', () => {
        const l = land([flat, { op: 'river', name: 'high', path: [[-400, 0, 80], [400, 0, 70]], width: 12 }]);
        expect(l.report.warnings.join(' ')).toMatch(/"high"\) banks the ground up by/);
    });

    it('holds a lake at its level, and lets a stream find it', () => {
        const l = land([
            { op: 'fill', height: 40 }, { op: 'hill', at: [-300, 0], radius: 320, height: 120 },
            { op: 'lake', name: 'pool', at: [250, 0], radius: 80, level: 36, depth: 8 },
            { op: 'stream', name: 'beck', from: [-280, 10], width: 6 },
        ]);
        expect(l.report.lakes[0]).toMatchObject({ name: 'pool', level: 36 });
        expect(landHeightAt(l, 250, 0)).toBeLessThan(30);
        const beck = l.report.rivers.find((r) => r.name === 'beck')!;
        const end = beck.points[beck.points.length - 1]!;
        // It ran downhill all the way, toward the low ground.
        for (let i = 1; i < beck.points.length; i++) expect(beck.points[i]!.y).toBeLessThanOrEqual(beck.points[i - 1]!.y);
        expect(end.x).toBeGreaterThan(-100);
    });

    it('ends the land at a coast: a beach inside it, the bed outside, and a cliff where the ground stood high', () => {
        const l = land([{ op: 'fill', height: 6 }, { op: 'hill', at: [330, 0], radius: 120, height: 80 }, { op: 'coast', at: [0, 0], radius: 380, beach: 60, cliffs: 30, shelf: [30, 3], floor: 50 }], { sea: 0 });
        expect(landHeightAt(l, 0, 0)).toBeCloseTo(6, 1);
        expect(landHeightAt(l, -375, 0)).toBeLessThan(1.5);            // the beach's foot
        expect(landHeightAt(l, -480, 0)).toBeLessThan(-10);            // out at sea
        expect(landHeightAt(l, 372, 0)).toBeGreaterThan(20);           // the hill meets the sea as a cliff
        expect(probeLand(l, [[0, 0]])[0]!.coast).toBeCloseTo(380, 0);
    });

    it('refuses a coast with no sea to run down to', () => {
        expect(() => land([flat, { op: 'coast', at: [0, 0], radius: 300, beach: 40, floor: 30 }])).toThrow(/give the source a `sea` height/);
    });
});

describe('roads', () => {
    const slope: LandStep[] = [flat, { op: 'plateau', at: [0, 0], radius: 150, height: 50, edge: 120 }];

    it('holds a road to its grade where its length allows', () => {
        // Forty up; a way that goes back and forth has the length for it.
        const l = land([...slope, { op: 'road', name: 'up', path: [[-330, 0], [-250, 90], [-200, -60], [-140, 80], [-90, -40], [-40, 20]], width: 8, grade: 0.15 }]);
        const road = l.report.roads[0]!;
        expect(road.reachable).toBe(true);
        expect(road.steepest.grade).toBeLessThanOrEqual(0.15 * 1.02 + 1e-6);
        expect(l.report.warnings.join(' ')).not.toContain('"up"');
        // The ground is cut and filled to it: along its line it is as steep as the road, no more.
        const walked = landProfile(l, road.points.map((p) => [p.x, p.z] as const));
        // (a hairpin's two legs share a bank, so the ground at a turn is a little steeper than the way's own line)
        expect(walked.steepest.degrees).toBeLessThan(20);
        expect(walked.going.walkable).toBe(1);
    });

    it('says a road is too steep, and how long it would need to be, when it is not', () => {
        const l = land([...slope, { op: 'road', name: 'straight', path: [[-240, 0], [-60, 0]], width: 8, grade: 0.1 }]);
        const road = l.report.roads[0]!;
        expect(road.reachable).toBe(false);
        expect(road.steepest.grade).toBeGreaterThan(0.1);
        expect(l.report.warnings.join(' ')).toMatch(/road "straight" is .* steeper than the 0\.1 asked.*needs about \d+/);
    });
});

describe('layers, maps and edits', () => {
    const source: LandSource = {
        version: 1, size: [1000, 1000], resolution: 129, sea: 0,
        steps: [{ id: 'base', op: 'fill', height: 10 }, { id: 'rock', op: 'plateau', at: [0, 0], radius: 200, height: 120, edge: 30 }, { op: 'road', path: [[-450, 300], [450, 300]], width: 10 }],
        layers: [{ name: 'grass' }, { name: 'dirt', where: { near: { what: 'road', within: 0, fade: 4 } } }, { name: 'rock', where: { steeper: 40 } }],
        maps: [{ name: 'grass', where: { layer: 'grass' } }],
    };

    it('lays each layer over those before it, the weights of a place summing to one', () => {
        const l = bakeLand(source);
        expect(l.weights.map((w) => w.name)).toEqual(['grass', 'dirt', 'rock']);
        for (const k of [0, 5000, 8000, l.m * l.m - 1]) expect(l.weights.reduce((sum, w) => sum + w.values[k]!, 0)).toBeGreaterThan(252);
        const at = probeLand(l, [[0, 300], [205, 0], [-400, -400]]);
        expect(at[0]!.layers).toHaveProperty('dirt');
        expect(at[1]!.layers).toHaveProperty('rock');
        expect(at[2]!.layers).toEqual({ grass: 1 });
        expect(l.report.layers.find((c) => c.name === 'rock')!.cover).toBeGreaterThan(0);
        expect(l.maps[0]!.name).toBe('grass');
    });

    it('lays a wash of colour, each tint over those before it, its alpha how much is laid', () => {
        const l = bakeLand({ ...source, tints: [{ color: [0.2, 0.5, 0.1], where: { layer: 'grass' } }, { color: [1, 1, 1], where: { above: 100, feather: 1 } }] });
        expect(l.tint).not.toBeNull();
        const at = (x: number, z: number): number[] => { const i = Math.round((x / 1000 + 0.5) * (l.m - 1)), j = Math.round((z / 1000 + 0.5) * (l.m - 1)), o = (j * l.m + i) * 4; return [...l.tint!.subarray(o, o + 4)]; };
        // Meadow: the first tint, written as sRGB, laid whole.
        expect(at(-400, -400)).toEqual([124, 188, 89, 255]);
        // The plateau's top: white over it.
        expect(at(0, 0)).toEqual([255, 255, 255, 255]);
        expect(bakeLand(source).tint).toBeNull();
    });

    it('edits a step by its id, and refuses one that is not there', () => {
        const edited = applyLandEdits(source, [{ op: 'set', step: 'rock', fields: { height: 60 } }, { op: 'insert', step: { op: 'smooth', radius: 20 }, after: 'rock' }]);
        expect(edited.steps.map((s) => s.op)).toEqual(['fill', 'plateau', 'smooth', 'road']);
        expect(landHeightAt(bakeLand(edited), 0, 0)).toBeCloseTo(60, 0);
        expect(source.steps).toHaveLength(3);
        expect(() => applyLandEdits(source, [{ op: 'remove', step: 'lake' }])).toThrow(/there is no step "lake"/);
    });

    it('refuses a source that is not one, in its own terms', () => {
        expect(() => bakeLand({ version: 1, size: [10, 10], resolution: 100, steps: [flat] })).toThrow(/resolution 100 must be one of/);
        expect(() => bakeLand({ version: 1, size: [10, 10], resolution: 129, steps: [{ op: 'mountain' }] })).toThrow(LandBuildError);
        expect(() => bakeLand({ ...source, layers: [{ name: 'grass' }, { name: 'moss', where: { layer: 'sand' } }] })).toThrow(/"sand", which is not a layer laid before/);
    });

    it('describes every op it runs', () => {
        const text = describeLandOps();
        for (const op of Object.keys(LAND_OPS)) expect(text).toContain(`${op}(`);
    });
});

describe('looking at a land', () => {
    const l = land([flat, { op: 'ridge', path: [[-300, -200], [300, -200]], height: 200, width: 200 }, { op: 'river', path: [[0, -100, 9], [0, 450, 2]], width: 14 }], { sea: 0 });

    it('draws the views asked, side by side, and says the grid they are read by', () => {
        const one = renderLandSheet(l, ['relief'], { size: 256 });
        const three = renderLandSheet(l, ['relief', 'slope', 'creases'], { size: 256 });
        expect(one.width).toBe(256);
        expect(three.width).toBe(256 * 3 + 12);
        expect(three.grid).toBe(200);
        expect(three.region).toEqual({ at: [0, 0], size: [1000, 1000] });
        expect(() => renderLandSheet(l, ['isometric' as never])).toThrow(/unknown view "isometric"/);
    });

    it('reads the ground along a line, with its steepest stretch', () => {
        const profile = landProfile(l, [[200, 400], [200, -200]]);
        expect(profile.length).toBe(600);
        expect(profile.max).toBeGreaterThan(150);
        expect(profile.steepest.degrees).toBeGreaterThan(20);
        expect(profile.going.walkable).toBeGreaterThan(0.3);
        const picture = renderLandProfile(profile, 0);
        expect(picture.rgba.length).toBe(picture.width * picture.height * 4);
    });

    it('reads a place: its height, its slope and the way it falls', () => {
        const [south] = probeLand(l, [[200, -120]]);
        expect(south!.slope).toBeGreaterThan(10);
        // South of the crest the ground runs downhill to the south: toward +z, which is 180.
        expect(Math.abs(south!.falls - 180)).toBeLessThan(40);
        expect(south!.aboveSea).toBeCloseTo(south!.height, 5);
    });
});
