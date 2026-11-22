// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { WaterField, currentShare, type RiverStation, type ZoneBody, type ZoneGrid, type ZoneLake, type ZoneOcean, type ZoneRiver } from '../src/water/zone';
import { polygonSdf, shoreDamp, type Point2 } from '../src/water/shore';
import { surfEnvelope, surfHeight } from '../src/water/waves';

// A square lake 40 across round the origin, its surface at y = 0.
const square: Point2[] = [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }];
const lake = (extra: Partial<ZoneLake> = {}): ZoneLake => ({
    kind: 'lake', key: 1, level: 0, waveHeight: 1, shoreWidth: 4, outline: square, toLocal: (x, z) => [x, z], toWorld: (x, z) => [x, z], ...extra,
});
// A river along +x from x = -60 into the lake at x = -10, 6 wide, at the lake's level, running at 2.
const river = (y = 0): ZoneRiver => {
    const stations: RiverStation[] = [];
    for (let x = -60; x <= -10; x += 1) stations.push({ x, z: 0, y, half: 3, dx: 1, dz: 0, speed: 2 });
    return { kind: 'river', key: 2, waveHeight: 0.2, shoreWidth: 1, stations };
};
const ocean = (level = -5): ZoneOcean => ({ kind: 'ocean', key: 3, level, waveHeight: 2, shoreWidth: 6 });
const grid: ZoneGrid = { minX: -80, minZ: -40, sizeX: 120, sizeZ: 80, nx: 241, nz: 161 };
const bake = (bodies: ZoneBody[], ground?: (x: number, z: number) => number | null): WaterField => WaterField.bake(grid, bodies, ground);

describe('an incoming shore break', () => {
    const beach = (spread: number) => WaterField.bake(grid, [ocean(0)], (_x, z) => -z, 10, [], spread);

    it('carries swell across the still shoreline without turning dry land into deep water', () => {
        const field = beach(0), dry = field.at(0, -2)!;
        expect(dry.shore).toBeLessThan(0);
        expect(dry.swell).toBe(2);
        expect(dry.amp).toBe(0);
        const cell = (x: number, z: number) => Math.round((z - grid.minZ) / grid.sizeZ * (grid.nz - 1)) * grid.nx
            + Math.round((x - grid.minX) / grid.sizeX * (grid.nx - 1));
        expect(field.swashGround[cell(0, -2)]).toBe(2);
        expect(field.swashGround[cell(0, 2)]).toBe(1);
        expect(bake([lake()]).swashGround[cell(24, 0)]).toBe(0);
        expect(field.sample(0, -2)).toBeNull();
    });

    it('bends the shared surf phase along a straight beach while preserving its physical shoreline', () => {
        const straight = beach(0), spread = beach(1);
        expect(straight.at(-3, 5)!.surf).toBeCloseTo(straight.at(7, 5)!.surf, 4);
        expect(spread.at(-3, 5)!.surf).not.toBeCloseTo(spread.at(7, 5)!.surf, 1);
        expect(spread.at(-3, 5)!.shore).toEqual(straight.at(-3, 5)!.shore);
    });
});

describe('surface and junction materials', () => {
    it('uses the body material in its interior and the river junction material at the lake edge', () => {
        const stream = { ...river(), material: 12, riverToLake: 23, riverToOcean: 27 };
        const sea = { ...ocean(), material: 5 };
        const field = bake([stream, lake({ material: 17 }), sea]);
        expect(field.materialAt(0, 0)).toBe(17);
        expect(field.materialAt(-44, 0)).toBe(12);
        expect(field.materialAt(-19, 0)).toBe(23);
        expect(field.materialAt(-44, 3)).toBe(27);
        expect(field.materialAt(-100, -60)).toBe(5);
        expect(bake([lake()]).materialTable).toBeUndefined();
    });
});

describe('the outline of a lake', () => {
    it('is the signed distance to its edge, positive inside', () => {
        expect(polygonSdf(square, 0, 0)).toBeCloseTo(20, 6);
        expect(polygonSdf(square, 19, 0)).toBeCloseTo(1, 6);
        expect(polygonSdf(square, 25, 0)).toBeCloseTo(-5, 6);
    });

    it('calms the waves toward it', () => {
        expect(shoreDamp(0, 4)).toBe(0);
        expect(shoreDamp(2, 4)).toBeCloseTo(0.5, 6);
        expect(shoreDamp(10, 4)).toBe(1);
        expect(shoreDamp(-1, 0)).toBe(1);
    });
});

describe('a zone with a lake', () => {
    const field = bake([lake()]);

    it('is water inside the outline at the lake\'s level, and none outside', () => {
        const mid = field.sample(0, 0)!;
        expect(mid.key).toBe(1);
        expect(mid.height).toBeCloseTo(0, 3);
        expect(mid.shore).toBeCloseTo(20, 0);
        expect(field.sample(30, 0)).toBeNull();
    });

    it('raises its waves to their full height from the shore in', () => {
        expect(field.sample(0, 0)!.amp).toBeCloseTo(1, 3);
        expect(field.sample(19.5, 0)!.amp).toBeLessThan(0.1);
        expect(field.sample(0, 0)!.calm).toBeCloseTo(1, 3);
        expect(field.sample(19.5, 0)!.calm).toBeLessThan(0.1);
    });

    it('keeps the lake\'s height on the dry texels round it, so the surface cut at the shore is not pulled down there', () => {
        expect(field.at(30, 0)!.height).toBeCloseTo(0, 3);
        expect(field.at(30, 0)!.shore).toBeLessThan(0);
    });

    it('takes its depth from the ground, and calms the waves where it is shallow', () => {
        // The bed rises to 0.5 under the surface east of x = 0.
        const shoal = bake([lake()], (x) => (x > 0 ? -0.5 : -10));
        expect(shoal.sample(-5, 0)!.depth).toBeCloseTo(10, 3);
        expect(shoal.sample(5, 0)!.depth).toBeCloseTo(0.5, 3);
        expect(shoal.sample(5, 0)!.amp).toBeLessThan(shoal.sample(-5, 0)!.amp);
    });

    it('turns with the lake, so a lake turned a quarter about up holds its outline in the world turned', () => {
        const long: Point2[] = [{ x: -20, y: -5 }, { x: 20, y: -5 }, { x: 20, y: 5 }, { x: -20, y: 5 }];
        const turned = bake([lake({ outline: long, toLocal: (x, z) => [z, -x], toWorld: (x, z) => [-z, x] })]);
        expect(turned.sample(0, 15)).not.toBeNull();
        expect(turned.sample(15, 0)).toBeNull();
    });
});

describe('a river running into a lake', () => {
    const field = bake([lake(), river()]);

    it('is one water along its course and into the lake, with no shore across its mouth', () => {
        for (let x = -55; x <= 0; x += 0.5) {
            const s = field.sample(x, 0);
            expect(s, `water at x = ${x}`).not.toBeNull();
            expect(s!.height).toBeCloseTo(0, 3);
        }
        // Where the river's middle crosses the lake's outline the water is a river's half width or more from any shore: nothing foams there.
        expect(field.sample(-20, 0)!.shore).toBeGreaterThan(2.5);
        // Its banks run on into the lake's shores: beside the river, outside the lake, there is no water.
        expect(field.sample(-30, 5)).toBeNull();
    });

    it('carries its current, which fades out in the still water', () => {
        const mid = field.sample(-40, 0)!;
        expect(mid.flowX).toBeGreaterThan(1.5);
        expect(Math.abs(mid.flowZ)).toBeLessThan(1e-3);
        expect(Math.hypot(field.sample(0, 0)!.flowX, field.sample(0, 0)!.flowZ)).toBeLessThan(0.05);
    });

    it('is at its own height up its course, and blends to the lake\'s where they meet', () => {
        const high = bake([lake(), river(2)]);
        expect(high.sample(-50, 0)!.height).toBeCloseTo(2, 2);
        expect(high.sample(0, 0)!.height).toBeCloseTo(0, 2);
    });
});

describe('an ocean', () => {
    it('is everywhere the ground is below its level, and goes on past the region', () => {
        const field = bake([ocean()], (x) => (x > 0 ? 5 : -20));
        expect(field.sample(-30, 0)!.height).toBeCloseTo(-5, 3);
        expect(field.sample(30, 0)).toBeNull();
        const past = field.sample(5000, 5000)!;
        expect(past.key).toBe(3);
        expect(past.height).toBe(-5);
        expect(past.amp).toBe(2);
    });

    it('gives way to a lake over it: a point on the lake is the lake\'s, not the sea\'s under it', () => {
        const field = bake([ocean(-5), lake()], () => -30);
        const s = field.sample(0, 0)!;
        expect(s.key).toBe(1);
        expect(s.height).toBeCloseTo(0, 3);
        expect(field.sample(-60, 30)!.key).toBe(3);
    });
});

describe('the field as the shader reads it', () => {
    it('holds the height to a 65535th of its span, and the shore, the waves and the current in bytes', () => {
        const field = bake([lake(), river(3)]);
        const r = field.ranges();
        const { heights, field: rest } = field.encode(r);
        const k = Math.round((0 - grid.minZ) / grid.sizeZ * (grid.nz - 1)) * grid.nx + Math.round((-50 - grid.minX) / grid.sizeX * (grid.nx - 1));
        const h = r.heightMin + ((heights[k * 4]! * 256 + heights[k * 4 + 1]!) / 65535) * r.heightSpan;
        expect(h).toBeCloseTo(field.height[k]!, 3);
        expect((rest[k * 4 + 1]! / 255 - 0.5) * 2 * r.flow).toBeCloseTo(field.flowX[k]!, 1);
        // The shore as a signed square root: squared back, it is within a byte's step there (finer the nearer the shore).
        const e = (rest[k * 4]! / 255 - 0.5) * 2, want = Math.max(-r.shore, Math.min(r.shore, field.shore[k]!));
        expect(Math.abs(e * Math.abs(e) * r.shore - want)).toBeLessThanOrEqual(r.shore * (2 * Math.sqrt(Math.abs(want) / r.shore) / 255 + 1 / 65025) + 1e-6);
    });

    it('is nothing over an ocean alone: there is no region, and every point is the ocean', () => {
        const field = WaterField.bake({ minX: 0, minZ: 0, sizeX: 0, sizeZ: 0, nx: 0, nz: 0 }, [ocean(1)]);
        expect(field.at(0, 0)).toBeNull();
        expect(field.sample(0, 0)!.height).toBe(1);
    });
});

describe('a river\'s current', () => {
    it('is quicker in a narrow reach than a wide one', () => {
        expect(currentShare(2, 6)).toBe(1);
        expect(currentShare(6, 6)).toBe(0.5);
        expect(currentShare(60, 6)).toBe(0.125);
    });
});

describe('the shore distance', () => {
    it('is how far across the ground the water\'s edge is, for an ocean over a gentle beach as for a lake', () => {
        // The beach rises one unit in twenty from x = 0: at x = -20 the sea is one deep and twenty from its edge.
        const field = bake([ocean(0)], (x) => x * 0.05);
        expect(field.sample(-20, 0)!.shore).toBeCloseTo(20, 0);
        expect(field.at(10, 0)!.shore).toBeCloseTo(-10, 0);
    });
});

describe('the surf', () => {
    const at = (shore: number, t: number): number => surfHeight(shore, 1, 10, 1, t);

    it('runs in toward the shore', () => {
        // The crest nearest the shore, found at two moments: it has come closer.
        const crest = (t: number): number => {
            let best = -1, where = 0;
            for (let d = 0; d <= 20; d += 0.05) { const h = at(d, t); if (h > best) { best = h; where = d; } }
            return where;
        };
        const t0 = 0.3;
        expect(crest(t0 + 0.2)).toBeLessThan(crest(t0));
    });

    it('is none past four lengths out or far up the ground, and stands highest as it shoals', () => {
        expect(surfEnvelope(45, 40)).toBe(0);
        expect(surfEnvelope(-9, 40)).toBe(0);
        expect(surfEnvelope(5, 40)).toBe(1);
        for (let t = 0; t < 3; t += 0.37) expect(at(41, t)).toBe(0);
    });
});

describe('the distance the surf runs in by', () => {
    // A beach along z = 0 (the sea to +z, rising 1 in 10 inland) with a river cut through it along x = 0, its mouth on the beach.
    const g: ZoneGrid = { minX: -200, minZ: -100, sizeX: 400, sizeZ: 200, nx: 401, nz: 201 };
    const ground = (x: number, z: number): number => (Math.abs(x) < 12 && z < 10 ? -Math.min(8, (12 - Math.abs(x)) * 0.5) : -z * 0.1);
    const stations: RiverStation[] = [];
    for (let z = -100; z <= 10; z += 5) stations.push({ x: 0, z, y: 0.5, half: 12, dx: 0, dz: 1, speed: 3 });
    const mouth: ZoneRiver = { kind: 'river', key: 9, waveHeight: 0, shoreWidth: 2, stations };
    const field = WaterField.bake(g, [{ kind: 'ocean', key: 3, level: 0, waveHeight: 2, shoreWidth: 6 }, mouth], ground, 80);

    it('runs straight across a river mouth, where the shore itself bends into it', () => {
        // Off the mouth the shore distance dips toward the river's water; the surf's runs on as along the open beach.
        const off = field.sample(0, 20)!, beach = field.sample(120, 20)!;
        expect(Math.abs(off.surf - beach.surf)).toBeLessThan(Math.abs(off.shore - beach.shore));
        expect(Math.abs(off.surf - beach.surf)).toBeLessThan(10);
    });

    it('takes a river for land', () => {
        expect(field.sample(0, -50)!.surf).toBeLessThan(0);
        expect(field.sample(0, -50)!.shore).toBeGreaterThan(0);
    });
});

describe('how steep the shore is', () => {
    it('is a beach where the ground shelves gently and rock where it drops away', () => {
        // The sea to +z; west of x = 0 the ground shelves 1 in 20, east of it a cliff drops 2 in 1.
        const g: ZoneGrid = { minX: -100, minZ: -50, sizeX: 200, sizeZ: 100, nx: 201, nz: 101 };
        const ground = (x: number, z: number): number => (x < 0 ? -z * 0.05 : -z * 2);
        const field = WaterField.bake(g, [{ kind: 'ocean', key: 3, level: 0, waveHeight: 2, shoreWidth: 6 }], ground, 20);
        const at = (x: number, z: number): number => field.steep[Math.round(z - g.minZ) * g.nx + Math.round(x - g.minX)]!;
        expect(at(-50, 2)).toBeLessThan(0.1);
        expect(at(50, 2)).toBeGreaterThan(0.9);
    });
});
