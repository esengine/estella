// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A hanging part as a ring of chains: where they run, how a vertex is shared between them, and what stays out of the way. */
import { describe, expect, it } from 'vitest';
import { bakeModel, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';
import { prefabOf } from '../src/modeling/rig';

const skirt: ModelStep = { op: 'lathe', profile: [[0.4, 1], [0.7, 0]], sides: 48, curve: 0, closed: false, tag: 'skirt' };
const body: ModelStep = { op: 'box', size: [0.3, 2, 0.3], at: [0, 1, 0], tag: 'body' };
const rig = { joints: [{ name: 'hips', at: [0, 1, 0] }, { name: 'top', at: [0, 2, 0], parent: 'hips' }, { name: 'thigh', at: [0.2, 0.9, 0], parent: 'hips' }] };
const dressed = (drape: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): BakedModel => bakeModel({
    version: 1, rig: { ...rig, drape: [{ faces: 'skirt', parent: 'hips', chains: 8, bones: 3, ...drape }], ...extra }, steps: [body, skirt, { op: 'slice', faces: 'skirt', axis: 'y', at: [0.25, 0.5, 0.75] }, { op: 'weld' }],
});

describe('rig.drape', () => {
    it('adds a chain of joints per slice round it, hanging from its parent', () => {
        const m = dressed();
        expect(m.rig!.joints).toHaveLength(3 + 8 * 4);
        expect(m.rig!.springs).toHaveLength(8);
        for (const s of m.rig!.springs!) expect(m.rig!.joints[s.root]!.parent).toBe(0);
    });

    it('runs each chain from the top edge to the hem, flaring out as the skirt does', () => {
        const m = dressed();
        for (const s of m.rig!.springs!) {
            const [top, hem] = [m.rig!.joints[s.root]!.at, m.rig!.joints[s.root + 3]!.at];
            expect(top[1]).toBeGreaterThan(0.9);
            expect(hem[1]).toBeLessThan(0.1);
            expect(Math.hypot(hem[0], hem[2])).toBeGreaterThan(Math.hypot(top[0], top[2]) + 0.15);
        }
    });

    it('shares each skirt vertex out to whole weight, and no further than the bones either side', () => {
        const m = dressed();
        const { joints, weights } = m.rig!.skin;
        const first = 3;
        m.poly.positions.forEach((p, v) => {
            if (Math.hypot(p[0], p[2]) < 0.35) return;
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += weights[v * 4 + k]!;
                if (weights[v * 4 + k]! > 1e-4) expect(joints[v * 4 + k]).toBeGreaterThanOrEqual(first);
            }
            expect(sum).toBeCloseTo(1, 5);
        });
    });

    it('blends between neighbouring chains, so no seam opens down the skirt', () => {
        const m = dressed();
        const { joints, weights } = m.rig!.skin;
        let blended = 0;
        m.poly.positions.forEach((p, v) => {
            if (Math.hypot(p[0], p[2]) < 0.35) return;
            const chains = new Set<number>();
            for (let k = 0; k < 4; k++) if (weights[v * 4 + k]! > 0.05) chains.add(Math.floor((joints[v * 4 + k]! - 3) / 4));
            if (chains.size === 2) blended++;
        });
        expect(blended).toBeGreaterThan(m.poly.positions.length * 0.3);
    });

    it('leaves the body bound to the body', () => {
        const m = dressed();
        const { joints, weights } = m.rig!.skin;
        m.poly.positions.forEach((p, v) => {
            if (Math.hypot(p[0], p[2]) > 0.25) return;
            for (let k = 0; k < 4; k++) if (weights[v * 4 + k]! > 1e-4) expect(joints[v * 4 + k]).toBeLessThan(3);
        });
    });

    it('makes no chain where a cape has nothing', () => {
        const cape: ModelStep = { op: 'plane', size: [1, 1.2], at: [0, 1, -0.3], tag: 'cape' };
        const standing: ModelStep = { op: 'transform', faces: 'cape', rotate: [90, 0, 0], pivot: [0, 1, -0.3] };
        const m = bakeModel({ version: 1, rig: { ...rig, drape: [{ faces: 'cape', parent: 'hips', chains: 12 }] }, steps: [body, cape, standing, { op: 'slice', faces: 'cape', axis: 'y', at: [0.8, 1.2] }, { op: 'weld' }] });
        expect(m.rig!.springs!.length).toBeLessThan(12);
        expect(m.rig!.springs!.length).toBeGreaterThan(0);
    });

    it('stops at what a rig can hold', () => {
        expect(() => bakeModel({ version: 1, rig: { ...rig, drape: Array.from({ length: 8 }, () => ({ faces: 'skirt', parent: 'hips', chains: 40, bones: 6 })) }, steps: [body, skirt] })).toThrow(/a rig holds at most 256/);
    });

    it('refuses what cannot be meant', () => {
        const steps = [body, skirt];
        const withDrape = (drape: unknown, more: Record<string, unknown> = {}) => validateModelSource({ steps, rig: { ...rig, drape: [drape], ...more } });
        expect(() => withDrape({ faces: 'skirt' })).toThrow(/names no joint/);
        expect(() => withDrape({ parent: 'hips' })).toThrow(/needs faces/);
        expect(() => withDrape({ faces: 'skirt', parent: 'hips', chains: 1 })).toThrow(/chains must be 2..40/);
        expect(() => withDrape({ faces: 'skirt', parent: 'hips', stiffness: 2 })).toThrow(/stiffness must be 0..1/);
        expect(() => withDrape({ faces: 'skirt', parent: 'hips', colliders: ['leg'] })).toThrow(/no collider "leg"/);
        expect(() => withDrape({ faces: 'skirt', parent: 'hips', swing: 1 })).toThrow(/unknown field "swing"/);
        expect(() => bakeModel({ version: 1, rig: { ...rig, drape: [{ faces: 'nothing', parent: 'hips' }] }, steps })).toThrow(/matched no face/);
    });
});

describe('rig.colliders', () => {
    it('puts them under their joints in the prefab, and a drape names them', () => {
        const colliders = [{ name: 'leg', joint: 'thigh', radius: 0.2, height: 0.8, at: [0.2, 0.5, 0] as [number, number, number] }];
        const m = dressed({ colliders: ['leg'] }, { colliders });
        const prefab = prefabOf('dress', 'dress.esmesh', m.rig!.joints, true, null, null, { springs: m.rig!.springs!, colliders }) as { entities: { prefabEntityId: string; name: string; parent: string; children: string[]; components: { type: string; data: Record<string, unknown> }[] }[] };
        const collider = prefab.entities.find((e) => e.prefabEntityId === 'collider:leg')!;
        const thigh = prefab.entities.find((e) => e.name === 'thigh')!;
        expect(collider.parent).toBe(thigh.prefabEntityId);
        expect(thigh.children).toContain('collider:leg');
        expect(collider.components.find((c) => c.type === 'SpringBoneCollider')!.data).toEqual({ shape: 1, radius: 0.2, height: 0.8 });
        const position = collider.components.find((c) => c.type === 'Transform')!.data.position as { y: number };
        expect(position.y).toBeCloseTo(-0.4, 5);
        const springs = prefab.entities.filter((e) => e.components.some((c) => c.type === 'SpringBone'));
        expect(springs).toHaveLength(8);
        for (const s of springs) expect(s.components.find((c) => c.type === 'SpringBone')!.data.colliders).toEqual(['collider:leg']);
    });

    it('refuses what cannot be meant', () => {
        const withColliders = (c: unknown) => validateModelSource({ steps: [body], rig: { ...rig, colliders: [c] } });
        expect(() => withColliders({ name: 'a', joint: 'nope', radius: 1 })).toThrow(/names no joint "nope"/);
        expect(() => withColliders({ name: 'a', joint: 'thigh', radius: 0 })).toThrow(/radius must be positive/);
        expect(() => withColliders({ joint: 'thigh', radius: 1 })).toThrow(/needs a name/);
        expect(() => withColliders({ name: 'a', joint: 'thigh', radius: 1, size: 2 })).toThrow(/unknown field "size"/);
    });
});

describe('the pleats pattern', () => {
    it('makes as many folds as it is asked for, round the y axis', () => {
        const m = bakeModel({ version: 1, steps: [{ op: 'cylinder', radius: 1, height: 1, sides: 240, tag: 'tube' }, { op: 'delete', faces: { any: ['+y', '-y'] } }, { op: 'displace', pattern: 'pleats', amplitude: 0.05, scale: 1, count: 12, detail: 5 }] });
        const ring = m.poly.positions.filter((p) => p[1] > 0).sort((a, b) => Math.atan2(a[0], a[2]) - Math.atan2(b[0], b[2])).map((p) => Math.hypot(p[0], p[2]));
        let folds = 0;
        for (let i = 1; i < ring.length; i++) if (ring[i - 1]! - ring[i]! > 0.04) folds++;
        expect(folds).toBeGreaterThanOrEqual(11);
        expect(folds).toBeLessThanOrEqual(13);
    });
});
