// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A spline point says how the curve runs on from it (a curve, its own tangents, straight, held) and can carry what a river reads
 *        there (depth, velocity, audio intensity); a river built on it runs, cuts and sounds by them.
 */
import { describe, expect, it } from 'vitest';
import { SplineCurve, type SplinePoint } from '../src/spline/curve';
import { riverStations } from '../src/water/waterPlugin';
import { riverBedModifiers } from '../src/water/riverBed';
import { WaterField, type ZoneGrid } from '../src/water/zone';

const p = (x: number, z: number, extra: Partial<SplinePoint> = {}): SplinePoint => ({ x, y: 0, z, width: 4, ...extra });
const same = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

describe('how a curve runs from a point', () => {
    const bend = [p(0, 0), p(10, 0), p(10, 10)];

    it('is straight where the point is linear', () => {
        const curve = new SplineCurve([p(0, 0, { type: 'linear' }), p(10, 0), p(10, 10)]);
        for (let s = 0; s <= 10; s += 1) expect(curve.position(s)[2]).toBeCloseTo(0, 6);
        expect(new SplineCurve(bend).position(5)[2]).not.toBeCloseTo(0, 3);
    });

    it('leaves along its own tangent where it has one', () => {
        // Leaving straight down +z, the curve starts toward +z before it turns to the next point.
        const curve = new SplineCurve([p(0, 0, { type: 'customTangent', leaveTangent: { x: 0, y: 0, z: 30 } }), p(10, 0)]);
        const [tx, , tz] = curve.tangent(0.01);
        expect(tz).toBeGreaterThan(Math.abs(tx));
        expect(curve.position(curve.length)[0]).toBeCloseTo(10, 6);
    });

    it('holds at the point where it is constant', () => {
        const curve = new SplineCurve([p(0, 0, { type: 'constant' }), p(10, 0), p(10, 10)]);
        expect(curve.position(0)[0]).toBeCloseTo(0, 6);
        expect(curve.position(curve.length)).toEqual([10, 0, 10]);
    });
});

describe('what the points carry', () => {
    it('eases along the curve, a point without one taking the one before it, and is null where none carries it', () => {
        const curve = new SplineCurve([p(0, 0, { velocity: 2, depth: 1 }), p(10, 0), p(20, 0, { velocity: 6 })]);
        expect(curve.value('velocity', 0)).toBeCloseTo(2, 6);
        expect(curve.value('velocity', curve.length)).toBeCloseTo(6, 6);
        expect(curve.value('velocity', curve.length * 0.25)).toBeCloseTo(2, 6);
        expect(curve.value('depth', curve.length)).toBeCloseTo(1, 6);
        expect(curve.value('audioIntensity', 5)).toBeNull();
    });

    it('runs a river back toward its start where the velocity is negative, at that speed', () => {
        const stations = riverStations(new SplineCurve([p(0, 0, { velocity: -3 }), p(20, 0, { velocity: -3 })]), 5, same, same, 1);
        expect(stations.every((s) => s.speed === -3)).toBe(true);
        const grid: ZoneGrid = { minX: -10, minZ: -10, sizeX: 40, sizeZ: 20, nx: 81, nz: 41 };
        const field = WaterField.bake(grid, [{ kind: 'river', key: 1, waveHeight: 0, shoreWidth: 0, stations }], () => -5);
        expect(field.sample(10, 0)!.flowX).toBeLessThan(-2);
    });

    it('keeps the river\'s own speed, quicker where it narrows, where no point carries a velocity', () => {
        const stations = riverStations(new SplineCurve([p(0, 0), p(20, 0)]), 5, same, same, 1);
        expect(stations[0]!.speed).toBeGreaterThan(0);
    });

    it('cuts the bed to each point\'s depth, and sounds as loud as the points say', () => {
        const stations = riverStations(new SplineCurve([p(0, 0, { depth: 1, audioIntensity: 0.2 }), p(40, 0, { depth: 5, audioIntensity: 0.8 })]), 5, same, same, 1);
        const bed = riverBedModifiers('b', stations, 0);
        const at = (x: number): number => bed.reduce((h, m) => (x >= m.bounds[0] && x <= m.bounds[2] ? m.apply(x, 0, h) : h), 10);
        expect(at(2)).toBeGreaterThan(at(38));
        expect(at(38)).toBeCloseTo(-5, 0);
        const grid: ZoneGrid = { minX: -10, minZ: -10, sizeX: 60, sizeZ: 20, nx: 121, nz: 41 };
        const field = WaterField.bake(grid, [{ kind: 'river', key: 1, waveHeight: 0, shoreWidth: 0, stations }], () => -8);
        expect(field.sample(5, 0)!.audio).toBeLessThan(field.sample(35, 0)!.audio);
        expect(field.sample(35, 0)!.audio).toBeGreaterThan(0.6);
    });
});
