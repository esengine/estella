// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** The views run the game's IK: feet on a test floor, a head turned to a goal, and what the file then tells the engine. */
import { describe, expect, it } from 'vitest';
import { bakeModel, controllerOf, jointPositions, renderRigSheet, validateModelSource, type AnimationSource, type BakedModel, type ModelStep, type RigSource } from '../src/modeling';

const rig: RigSource = { joints: [
    { name: 'hips', at: [0, 2, 0] },
    { name: 'thigh', at: [0.3, 2, 0], parent: 'hips', mirror: 'x' },
    { name: 'shin', at: [0.3, 1, 0.05], parent: 'thigh', mirror: 'x' },
    { name: 'foot', at: [0.3, 0, 0], parent: 'shin', mirror: 'x' },
    { name: 'head', at: [0, 3, 0], parent: 'hips' },
    { name: 'crown', at: [0, 3.5, 0], parent: 'head' },
], goals: [{ name: 'beacon', at: [4, 3, 0] }] };
const body: ModelStep = { op: 'organic', resolution: 48, blend: 0.1, parts: [
    { tag: 'torso', shape: 'chain', points: [[0, 2, 0, 0.35], [0, 3.4, 0, 0.25]] },
    { tag: 'leg', shape: 'chain', mirror: 'x', points: [[0.3, 2, 0, 0.15], [0.3, 1, 0.05, 0.12], [0.3, 0, 0, 0.1]] },
] };
const clip: AnimationSource = { name: 'stand', duration: 1, tracks: [{ joint: 'crown', rotate: [[0, 0, 0, 0]] }] };
const plant = (side: string, extra = {}) => ({ kind: 'foot-plant', tip: `foot.${side}`, pole: 'beacon', ...extra });
const controller = (ik: unknown[]) => ({ initial: 's', states: [{ name: 's', clip: 'stand' }], ik });
const bake = (ik: unknown[]): BakedModel => bakeModel({ version: 1, rig, animations: [clip], controller: controller(ik), steps: [body] });
const solveOf = (m: BakedModel, ground?: { height?: number; slope?: [number, number] }) => ({ ik: m.rig!.ik!, goals: m.rig!.goals!, ...(ground ? { ground } : {}) });

describe('previewing a foot-plant', () => {
    const m = bake([plant('L', { pelvis: 'hips' }), plant('R', { pelvis: 'hips' })]);
    const at = (ground?: { height?: number; slope?: [number, number] }) => jointPositions(m.rig!.joints, clip, 0, solveOf(m, ground));

    it('with no floor to stand on, does nothing', () => {
        expect(at()['foot.L']).toEqual(jointPositions(m.rig!.joints, clip, 0)['foot.L']);
    });

    it('puts both feet on a raised floor, the knees bending and the hips staying', () => {
        const p = at({ height: 0.4 });
        expect(p['foot.L']![1]).toBeCloseTo(0.4, 4);
        expect(p['foot.R']![1]).toBeCloseTo(0.4, 4);
        expect(p.hips![1]).toBeCloseTo(2, 5);
    });

    it('on a floor below, the hips come down and the feet reach it', () => {
        const p = at({ height: -0.5 });
        expect(p.hips![1]).toBeCloseTo(1.5, 5);
        expect(p['foot.L']![1]).toBeCloseTo(-0.5, 3);
    });

    it('on a slope each foot lands at its own height, and the lower one sets the hips', () => {
        const slope = 0.25;
        const p = at({ slope: [slope, 0] });
        expect(p['foot.L']![1]).toBeCloseTo(0.3 * slope, 3);
        expect(p['foot.R']![1]).toBeCloseTo(-0.3 * slope, 3);
        expect(p.hips![1]).toBeCloseTo(2 - 0.3 * slope, 4);
    });

    it('a sheet shows it: orange floor lines, and a silhouette that follows', () => {
        const orange = (s: { width: number; height: number; rgba: Uint8Array }): number => {
            let n = 0;
            for (let i = 0; i < s.width * s.height; i++) if (s.rgba[i * 4] === 255 && s.rgba[i * 4 + 2] === 0) n++;
            return n;
        };
        const flat = renderRigSheet(m, [clip], { views: ['front'], panel: 128, skeleton: false });
        const floored = renderRigSheet(m, [clip], { views: ['front'], panel: 128, skeleton: false, ground: { slope: [0.3, 0] } });
        expect(orange(flat)).toBe(0);
        expect(orange(floored)).toBeGreaterThan(20);
        expect(floored.rgba).not.toEqual(flat.rgba);
    });

    it('`ik: false` shows the clips alone', () => {
        const on = renderRigSheet(m, [clip], { views: ['front'], panel: 96, ground: { height: 0.6 } });
        const off = renderRigSheet(m, [clip], { views: ['front'], panel: 96, ground: { height: 0.6 }, ik: false });
        expect(on.rgba).not.toEqual(off.rgba);
    });

    it('writes what the engine reads, the joints by path and no target', () => {
        const doc = controllerOf(controller([plant('L', { pelvis: 'hips', layers: 2, smooth: 0.1 })]) as never, [clip], (n) => `${n}.estimeline`, rig) as { ik: Record<string, unknown>[] };
        expect(doc.ik[0]).toEqual({ kind: 'foot-plant', tip: 'hips/thigh.L/shin.L/foot.L', target: '', pole: 'beacon', pelvis: 'hips', layers: 2, smooth: 0.1 });
    });

    it('refuses what cannot run, naming it', () => {
        const check = (ik: unknown) => validateModelSource({ version: 1, rig, animations: [clip], controller: controller([ik]), steps: [body] });
        expect(() => check({ kind: 'foot-plant', tip: 'foot.L', target: 'beacon' })).toThrow(/has no target/);
        expect(() => check({ kind: 'foot-plant', tip: 'foot.L', pelvis: 'nope' })).toThrow(/pelvis "nope" is not a joint/);
        expect(() => check({ kind: 'foot-plant', tip: 'hips' })).toThrow(/foot-plant ik needs two bones above "hips"/);
        expect(() => check({ kind: 'look-at', tip: 'head', target: 'beacon', pelvis: 'hips' })).toThrow(/belong to a foot-plant/);
        expect(() => check({ kind: 'foot-plant', tip: 'foot.L', reach: 'far' })).toThrow(/reach must be a number/);
    });
});

describe('previewing the rest', () => {
    it('a look-at turns the joint to its goal, where the clip left it straight', () => {
        const m = bake([{ kind: 'look-at', tip: 'head', target: 'beacon', axis: 'y' }]);
        const before = jointPositions(m.rig!.joints, clip, 0);
        const after = jointPositions(m.rig!.joints, clip, 0, solveOf(m));
        expect(before.crown![0]).toBeCloseTo(0, 5);
        expect(after.crown![0]).toBeGreaterThan(0.45); // its half-unit bone now leans along +X, toward the beacon
        expect(after.crown![1]).toBeCloseTo(3, 3);
    });

    it('a two-bone puts the tip on a goal', () => {
        const near: RigSource = { ...rig, goals: [{ name: 'grab', at: [0.9, 1, 0.5] }] };
        const m = bakeModel({ version: 1, rig: near, animations: [clip], controller: controller([{ kind: 'two-bone', tip: 'foot.L', target: 'grab' }]), steps: [body] });
        const p = jointPositions(m.rig!.joints, clip, 0, solveOf(m));
        expect(Math.hypot(p['foot.L']![0] - 0.9, p['foot.L']![1] - 1, p['foot.L']![2] - 0.5)).toBeLessThan(1e-3);
    });
});

describe('the shape budget', () => {
    it('warns when the deltas would not fit, since the mesh then never changes shape', () => {
        const shapes = Array.from({ length: 80 }, (_, i) => ({ name: `s${i}`, moves: [{ faces: 'all', push: 0.01 }] }));
        const dense: ModelStep = { op: 'organic', resolution: 96, parts: [{ shape: 'sphere', radius: 1 }] };
        const m = bakeModel({ version: 1, shapes, steps: [dense] });
        expect(m.report.warnings.join()).toMatch(/never change shape/);
        const few = bakeModel({ version: 1, shapes: shapes.slice(0, 2), steps: [dense] });
        expect(few.report.warnings.join()).not.toMatch(/never change shape/);
    });
});
