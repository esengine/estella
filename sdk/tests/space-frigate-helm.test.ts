// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it } from 'vitest';
import { PITCH_THRUST, TURN_RATE, YAW_THRUST, engage, helm, setElevation, setRudder, steady, stepHelm, type HelmKeys } from '../../examples/space-frigate/src/helm';

const IDLE: HelmKeys = { ahead: false, astern: false, port: false, starboard: false, climb: false, dive: false, steady: false, approach: false, align: false, level: false };
const STEP = 1 / 60;
const level = { x: 0, y: 0, z: 0, w: 1 };
const run = (seconds: number, each?: () => void): void => { for (let left = Math.round(seconds / STEP); left > 0; left--) { stepHelm(IDLE, STEP); each?.(); } };

beforeEach(() => {
    Object.assign(helm, {
        yaw: 0, pitch: 0, roll: 0, lean: 0, yawRate: 0, pitchRate: 0, rollRate: 0, jets: { yaw: 0, pitch: 0, roll: 0 }, mode: 'manual', order: 0.75, rudder: 0, elevation: 0, helmAngle: 0,
        attitude: { ...level }, level: { ...level }, frame: { ...level }, forward: { x: 0, y: 0, z: 1 }, gate: { x: 0, y: 14, z: 2600 }, arrivals: 0, arrived: false, aim: null,
    });
});

describe('how the space frigate answers its helm', () => {
    it('she does not answer at once: a turn builds no faster than her thrusters push', () => {
        setRudder(-1);
        setElevation(1);
        run(0.5);
        expect(helm.yawRate).toBeGreaterThan(0);
        expect(helm.yawRate).toBeLessThanOrEqual(YAW_THRUST * 0.5 + 1e-9);
        expect(helm.yawRate).toBeLessThan(TURN_RATE * 0.5);
        expect(helm.pitchRate).toBeLessThanOrEqual(PITCH_THRUST * 0.5 + 1e-9);
        expect(helm.jets).toEqual({ yaw: 1, pitch: 1, roll: 0 });
    });

    it('a steady turn needs no thrust, and stopping it fires the other side until she is still', () => {
        setRudder(-1);
        run(12);
        expect(helm.yawRate).toBeCloseTo(TURN_RATE, 3);
        expect(Math.abs(helm.jets.yaw)).toBeLessThan(0.02);
        steady();
        run(0.2);
        expect(helm.jets.yaw).toBe(-1);
        expect(helm.yawRate).toBeGreaterThan(TURN_RATE * 0.8);
        run(8);
        expect(Math.abs(helm.yawRate)).toBeLessThan(1e-4);
        expect(Math.abs(helm.jets.yaw)).toBeLessThan(0.01);
    });

    it('a rudder order left on carries her all the way round', () => {
        setRudder(1);
        let turned = 0, before = helm.yaw, astern = 1;
        run(30, () => {
            let step = helm.yaw - before;
            step -= Math.round(step / (Math.PI * 2)) * Math.PI * 2;
            turned += step;
            before = helm.yaw;
            astern = Math.min(astern, helm.forward.z);
        });
        expect(Math.abs(turned)).toBeGreaterThan(Math.PI * 2);
        expect(astern).toBeLessThan(-0.999);
        expect(Math.abs(helm.forward.y)).toBeLessThan(1e-9);
    });

    it('a pitch order left on takes her over the top and round again', () => {
        setElevation(1);
        let up = 0, down = 0, back = 1;
        run(40, () => { up = Math.max(up, helm.forward.y); down = Math.min(down, helm.forward.y); back = Math.min(back, helm.forward.z); });
        expect(up).toBeGreaterThan(0.999);
        expect(down).toBeLessThan(-0.999);
        expect(back).toBeLessThan(-0.999);
    });

    it('with the orders back at the middle she keeps the attitude she has, and does not come level', () => {
        setElevation(1);
        setRudder(-1);
        run(4);
        steady();
        run(3);
        const held = { ...helm.forward }, climb = helm.pitch;
        expect(climb).toBeGreaterThan(0.5);
        run(30);
        expect(Math.hypot(helm.forward.x - held.x, helm.forward.y - held.y, helm.forward.z - held.z)).toBeLessThan(2e-3);
        expect(helm.pitch).toBeGreaterThan(0.5);
        expect(helm.rudder).toBe(0);
        expect(helm.elevation).toBe(0);
    });

    it('a key steps an order one place and holds it there', () => {
        stepHelm({ ...IDLE, starboard: true }, STEP);
        stepHelm(IDLE, STEP);
        expect(helm.rudder).toBeCloseTo(1 / 3, 9);
        stepHelm({ ...IDLE, starboard: true }, STEP);
        stepHelm(IDLE, STEP);
        expect(helm.rudder).toBeCloseTo(2 / 3, 9);
        stepHelm({ ...IDLE, climb: true }, STEP);
        stepHelm(IDLE, STEP);
        expect(helm.elevation).toBeCloseTo(0.5, 9);
        run(2);
        expect(helm.rudder).toBeCloseTo(2 / 3, 9);
        expect(helm.elevation).toBeCloseTo(0.5, 9);
    });

    it('steering herself to a gate she comes round to face it wherever it lies, from whatever attitude', () => {
        setElevation(1);
        run(5);
        helm.gate = { x: -1800, y: 2400, z: -3000 };
        engage('align');
        run(45);
        const far = Math.hypot(helm.gate.x, helm.gate.y, helm.gate.z);
        expect((helm.forward.x * helm.gate.x + helm.forward.y * helm.gate.y + helm.forward.z * helm.gate.z) / far).toBeGreaterThan(0.9999);
        expect(helm.mode).toBe('align');
    });

    it('asked to come level she brings her bow to the horizon and her deck flat, from any attitude, and then holds', () => {
        for (const [pitched, turned] of [[4, 3], [13, 0], [7, 9]] as const) {
            setElevation(1);
            run(pitched);
            setRudder(1);
            run(turned);
            steady();
            run(3);
            engage('level');
            expect(helm.mode).toBe('level');
            run(60);
            expect(Math.abs(helm.forward.y)).toBeLessThan(0.01);
            expect(Math.abs(helm.lean)).toBeLessThan(0.01);
            expect(helm.mode).toBe('manual');
            expect(Math.abs(helm.yawRate) + Math.abs(helm.pitchRate) + Math.abs(helm.rollRate)).toBeLessThan(0.01);
        }
    });

    it('a hand on the rudder takes her back from coming level', () => {
        setElevation(1);
        run(5);
        engage('level');
        run(1);
        setRudder(1 / 3);
        expect(helm.mode).toBe('manual');
        const climb = helm.pitch;
        run(0.5);
        expect(helm.pitch).toBeGreaterThan(climb * 0.5);
    });
});
