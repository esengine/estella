// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { BATTERIES, GUNNERY, boreOf, crossing, dispersion, intercept, limit, muzzleOf, rayToSphere, scatter, slew, solve, wrap, type Mount } from '../../examples/space-frigate/src/gunSolution';

const RAD = Math.PI / 180;
const mount = (key: string, seat: { x: number; y: number; z: number }, flipped = false): Mount =>
    ({ ...BATTERIES.find((b) => b.key === key)!, seat, flipped, trunnion: { x: 0, y: 0.95, z: 1.7 }, muzzle: 5.75, spread: GUNNERY.barrels });
const A = mount('A', { x: 0, y: 3.1, z: 27 }), P = mount('P', { x: 6.6, y: 6.4, z: -12 }), V = mount('V', { x: 0, y: -5.4, z: 10 }, true);
const AIMS = [{ x: 0, y: 40, z: 900 }, { x: 700, y: -120, z: 300 }, { x: -500, y: 260, z: -400 }, { x: 60, y: -700, z: 80 }, { x: -900, y: 0, z: 5 }];

describe('where a gun points to put its shot on a point', () => {
    it('a gun trained and laid by its solution has that point down its bore, whichever way up it is mounted', () => {
        for (const m of [A, P, V]) {
            for (const aim of AIMS) {
                const at = solve(m, aim), bore = boreOf(m, at), from = muzzleOf(m, at, 0);
                const to = { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z };
                const far = Math.hypot(to.x, to.y, to.z);
                expect((to.x * bore.x + to.y * bore.y + to.z * bore.z) / far).toBeGreaterThan(0.999999);
                expect(Math.hypot(bore.x, bore.y, bore.z)).toBeCloseTo(1, 9);
            }
        }
    });

    it('dead ahead is no train and no elevation, and the port beam is a quarter turn', () => {
        const ahead = solve(A, { x: 0, y: A.seat.y + A.trunnion.y, z: 5000 });
        expect(ahead.yaw).toBeCloseTo(0, 9);
        expect(ahead.pitch).toBeCloseTo(0, 9);
        expect(solve(A, { x: 5000, y: A.seat.y + A.trunnion.y, z: A.seat.z }).yaw).toBeCloseTo(Math.PI / 2, 9);
        expect(solve(V, { x: 0, y: -900, z: V.seat.z + 900 }).pitch).toBeGreaterThan(0.6);
    });

    it('a mount hung under the hull is turned half round the keel: its own left is the ship\'s right, its up the ship\'s down', () => {
        const beam = boreOf(V, { yaw: Math.PI / 2, pitch: 0 }), up = boreOf(V, { yaw: 0, pitch: Math.PI / 2 }), ahead = boreOf(V, { yaw: 0, pitch: 0 });
        expect([beam.x, beam.y, beam.z].map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([-1, 0, 0]);
        expect([up.x, up.y, up.z].map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, -1, 0]);
        expect([ahead.x, ahead.y, ahead.z].map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 0, 1]);
        const mouth = muzzleOf(V, { yaw: 0, pitch: 0 }, 0);
        expect(mouth.y).toBeCloseTo(V.seat.y - V.trunnion.y, 9);
        expect(mouth.z).toBeCloseTo(V.seat.z + V.trunnion.z + V.muzzle, 9);
    });

    it('the two barrels leave the house a barrel spacing apart, square to the bore', () => {
        const at = solve(P, AIMS[1]!), bore = boreOf(P, at);
        const left = muzzleOf(P, at, GUNNERY.barrels), right = muzzleOf(P, at, -GUNNERY.barrels);
        const across = { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
        expect(Math.hypot(across.x, across.y, across.z)).toBeCloseTo(GUNNERY.barrels * 2, 9);
        expect(across.x * bore.x + across.y * bore.y + across.z * bore.z).toBeCloseTo(0, 9);
    });
});

describe('what a mount lets a gun do', () => {
    it('a gun asked past its arc stops at the edge of it and does not bear', () => {
        const aft = limit(A, { yaw: Math.PI, pitch: 0 });
        expect(aft.bears).toBe(false);
        expect(Math.abs(aft.yaw)).toBeCloseTo(A.half, 9);
        expect(limit(A, { yaw: 100 * RAD, pitch: 0.2 })).toEqual({ yaw: 100 * RAD, pitch: 0.2, bears: true });
        expect(limit(P, { yaw: -90 * RAD, pitch: 0 }).bears).toBe(false);
        expect(limit(P, { yaw: 90 * RAD, pitch: 0 }).bears).toBe(true);
        expect(limit(V, { yaw: Math.PI, pitch: 0 }).bears).toBe(true);
    });

    it('a gun asked above or below its elevation stops there and does not bear', () => {
        const high = limit(A, { yaw: 0, pitch: 80 * RAD });
        expect(high.bears).toBe(false);
        expect(high.pitch).toBeCloseTo(GUNNERY.high, 9);
        expect(limit(A, { yaw: 0, pitch: -20 * RAD }).pitch).toBeCloseTo(GUNNERY.low, 9);
    });

    it('it trains no faster than its rate, and gets there', () => {
        let at = { yaw: 0, pitch: 0 };
        const to = { yaw: 90 * RAD, pitch: 20 * RAD };
        const first = slew(A, at, to, 0.1);
        expect(first.yaw).toBeCloseTo(GUNNERY.traverse * 0.1, 9);
        expect(first.pitch).toBeCloseTo(GUNNERY.elevate * 0.1, 9);
        for (let i = 0; i < 100; i++) at = slew(A, at, to, 0.05);
        expect(at.yaw).toBeCloseTo(to.yaw, 9);
        expect(at.pitch).toBeCloseTo(to.pitch, 9);
    });

    it('a gun with a blind arc goes round the long way, never through what it cannot point at', () => {
        let at = { yaw: 140 * RAD, pitch: 0 };
        const to = { yaw: -140 * RAD, pitch: 0 };
        let widest = 0;
        for (let i = 0; i < 400 && Math.abs(at.yaw - to.yaw) > 1e-9; i++) {
            at = slew(A, at, to, 0.05);
            widest = Math.max(widest, Math.abs(wrap(at.yaw - A.centre)));
        }
        expect(at.yaw).toBeCloseTo(to.yaw, 9);
        expect(widest).toBeLessThanOrEqual(A.half + 1e-9);
    });

    it('a gun that turns all the way round takes the short way', () => {
        const next = slew(V, { yaw: 170 * RAD, pitch: 0 }, { yaw: -170 * RAD, pitch: 0 }, 0.1);
        expect(wrap(next.yaw - 170 * RAD)).toBeCloseTo(GUNNERY.traverse * 0.1, 9);
    });
});

describe('what a line of sight meets', () => {
    it('gives how far along it a sphere is met, and nothing for one behind or beside it', () => {
        const from = { x: 0, y: 0, z: 0 }, way = { x: 0, y: 0, z: 1 };
        expect(rayToSphere(from, way, { x: 0, y: 0, z: 100 }, 10)).toBeCloseTo(90, 9);
        expect(rayToSphere(from, way, { x: 6, y: 0, z: 100 }, 10)).toBeCloseTo(92, 9);
        expect(rayToSphere(from, way, { x: 11, y: 0, z: 100 }, 10)).toBe(Infinity);
        expect(rayToSphere(from, way, { x: 0, y: 0, z: -100 }, 10)).toBe(Infinity);
    });
});

describe('what the fire control allows for', () => {
    it('lays ahead of a crossing target by where it will be when the shot arrives', () => {
        const at = { x: 0, y: 0, z: 1400 }, drift = { x: 70, y: 0, z: 0 };
        const { point, time } = intercept(at, drift, 1400);
        expect(time).toBeGreaterThan(1);
        expect(point.x).toBeCloseTo(70 * time, 6);
        expect(Math.hypot(point.x, point.y, point.z) / 1400).toBeCloseTo(time, 3);
        expect(intercept(at, { x: 0, y: 0, z: 0 }, 1400)).toEqual({ point: at, time: 1 });
    });

    it('a closing target is met sooner and an opening one later', () => {
        const at = { x: 0, y: 0, z: 1400 };
        expect(intercept(at, { x: 0, y: 0, z: -200 }, 1400).time).toBeLessThan(1);
        expect(intercept(at, { x: 0, y: 0, z: 200 }, 1400).time).toBeGreaterThan(1);
    });

    it('only the part of its motion across the line of sight counts as crossing', () => {
        expect(crossing({ x: 0, y: 0, z: 500 }, { x: 30, y: 40, z: 900 })).toBeCloseTo(50, 9);
        expect(crossing({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: -300 })).toBeCloseTo(0, 9);
    });

    it('its shots scatter more the farther and faster the target, and less the longer it has been held', () => {
        const near = dispersion(400, 20, 0), far = dispersion(1600, 20, 0), fast = dispersion(400, 120, 0), held = dispersion(1600, 20, GUNNERY.settle);
        expect(far).toBeGreaterThan(near);
        expect(fast).toBeGreaterThan(near);
        expect(held).toBeLessThan(far);
        expect(held).toBeGreaterThan(GUNNERY.loose);
        expect(dispersion(1600, 20, GUNNERY.settle * 4)).toBeCloseTo(held, 12);
        expect(dispersion(0, 0, 0)).toBeCloseTo(GUNNERY.loose, 12);
    });

    it('a scattered shot leaves within its angle of the bore, anywhere round it', () => {
        const bore = { x: 0.6, y: 0, z: 0.8 }, angle = 2 * RAD;
        const off = (a: number, b: number): number => { const w = scatter(bore, angle, a, b); expect(Math.hypot(w.x, w.y, w.z)).toBeCloseTo(1, 9); return Math.acos(Math.min(1, w.x * bore.x + w.y * bore.y + w.z * bore.z)); };
        expect(off(0, 0.3)).toBeCloseTo(0, 9);
        expect(off(1, 0)).toBeCloseTo(angle, 9);
        expect(off(1, 0.25)).toBeCloseTo(angle, 9);
        expect(off(0.25, 0.7)).toBeCloseTo(Math.atan(Math.tan(angle * 0.5)), 9);
        const a = scatter(bore, angle, 1, 0), b = scatter(bore, angle, 1, 0.5);
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(Math.sin(angle));
    });
});
