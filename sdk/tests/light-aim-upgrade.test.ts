// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    light-aim-upgrade.test.ts
 * @brief   A file that names a light's aim arrives aiming there.
 *
 *          The engine reads a light's aim off its entity, so a scene naming
 *          `direction`/`directionZ` has to load as the rotation whose forward IS
 *          that direction. The pixel gates say so about frames; this says so about
 *          the arithmetic, which is where an axis convention goes wrong in silence.
 */
import { describe, it, expect } from 'vitest';
import { migrateSceneData, type SceneData } from '../src/scene/scene';
import { migratePrefabData } from '../src/prefab/migrate';
import { lightAimOf, lightAimRotation, LIGHT_FORWARD } from '../src/render/lightAim';
import { q } from '../src/math/quat';
import type { Quat, Vec3 } from '../src/types';

const DIRECTIONAL = 1;
const POINT = 0;
const SPOT = 3;

const sceneWith = (components: { type: string; data: Record<string, unknown> }[]): SceneData =>
    ({
        version: 1,
        name: 'test',
        entities: [{ id: 0, name: 'Light', parent: null, children: [], components }],
    } as unknown as SceneData);

const componentsOf = (scene: SceneData) => scene.entities[0]!.components;
const find = (scene: SceneData, type: string) => componentsOf(scene).find((c) => c.type === type);

/** The unit vector a migrated entity's rotation lights along. */
function aimAfter(scene: SceneData): Vec3 {
    const rotation = find(scene, 'Transform')?.data['rotation'] as Quat | undefined;
    return lightAimOf(rotation ?? { w: 1, x: 0, y: 0, z: 0 });
}

const unit = (v: Vec3): Vec3 => {
    const len = Math.hypot(v.x, v.y, v.z);
    return { x: v.x / len, y: v.y / len, z: v.z / len };
};

const expectAim = (got: Vec3, want: Vec3) => {
    const w = unit(want);
    expect(got.x).toBeCloseTo(w.x, 6);
    expect(got.y).toBeCloseTo(w.y, 6);
    expect(got.z).toBeCloseTo(w.z, 6);
};

describe('a light aimed by fields becomes a light aimed by its entity', () => {
    it('turns every authored aim into the rotation with that forward', () => {
        // The whole space, not one case: a convention that is inverted or swapped
        // survives a single vector and dies here.
        const aims: Vec3[] = [
            { x: 0.3, y: -0.5, z: -0.8 },
            { x: 0, y: -1, z: -1 },
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0.25, y: 0, z: -1 },
            { x: 0, y: 0, z: 1 },
        ];
        for (const aim of aims) {
            const { data } = migrateSceneData(sceneWith([
                { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
                { type: 'Light2D', data: { type: DIRECTIONAL, direction: { x: aim.x, y: aim.y }, directionZ: aim.z } },
            ]));
            expectAim(aimAfter(data), aim);
        }
    });

    it('reads a file that named only the plane at the component default', () => {
        const { data } = migrateSceneData(sceneWith([
            { type: 'Transform', data: {} },
            { type: 'Light2D', data: { type: DIRECTIONAL, direction: { x: 0.25, y: 0 } } },
        ]));
        expectAim(aimAfter(data), { x: 0.25, y: 0, z: -1 });
    });

    it('leaves an unrotated light unrotated — the 2D scene it was', () => {
        const { data } = migrateSceneData(sceneWith([
            { type: 'Light2D', data: { type: DIRECTIONAL, direction: { x: 0, y: 0 }, directionZ: -1 } },
        ]));
        // Nothing to turn, so nothing is added: no Transform is the identity already.
        expect(find(data, 'Transform')).toBeUndefined();
        expectAim(aimAfter(data), LIGHT_FORWARD);
    });

    it('reads an aim of nothing the way the engine did — into the screen', () => {
        const { data } = migrateSceneData(sceneWith([
            { type: 'Light2D', data: { type: DIRECTIONAL, direction: { x: 0, y: 0 }, directionZ: 0 } },
        ]));
        expectAim(aimAfter(data), LIGHT_FORWARD);
    });

    it('gives a light with no Transform the one its aim needs', () => {
        const { data } = migrateSceneData(sceneWith([
            { type: 'Light2D', data: { type: SPOT, direction: { x: 1, y: 0 } } },
        ]));
        expect(find(data, 'Transform')).toBeDefined();
        expectAim(aimAfter(data), { x: 1, y: 0, z: -1 });
    });

    it('drops the dead fields from a light that never aimed, and leaves its rotation', () => {
        const turned = q.fromEuler([0, 0, 90]);
        const { data } = migrateSceneData(sceneWith([
            { type: 'Transform', data: { rotation: turned } },
            { type: 'Light2D', data: { type: POINT, direction: { x: 1, y: 0 }, directionZ: -1 } },
        ]));
        expect(find(data, 'Light')!.data['direction']).toBeUndefined();
        expect(find(data, 'Light')!.data['directionZ']).toBeUndefined();
        expect(find(data, 'Transform')!.data['rotation']).toEqual(turned);
    });

    it('is idempotent — a migrated scene migrates to itself', () => {
        const once = migrateSceneData(sceneWith([
            { type: 'Light2D', data: { type: DIRECTIONAL, direction: { x: 0.3, y: -0.5 }, directionZ: -0.8 } },
        ]));
        expect(once.migrated).toBe(true);
        const twice = migrateSceneData(once.data);
        expect(twice.migrated).toBe(false);
        expectAim(aimAfter(twice.data), { x: 0.3, y: -0.5, z: -0.8 });
    });

    it('upgrades a light in a prefab through the same door', () => {
        const { data, migrated } = migratePrefabData({
            version: '2',
            rootEntityId: 'root',
            entities: [{
                prefabEntityId: 'root',
                name: 'Torch',
                parent: null,
                children: [],
                visible: true,
                components: [{ type: 'Light2D', data: { type: SPOT, direction: { x: 0, y: -1 } } }],
            }],
        });
        expect(migrated).toBe(true);
        const transform = data.entities[0]!.components.find((c) => c.type === 'Transform');
        expectAim(lightAimOf(transform!.data['rotation'] as Quat), { x: 0, y: -1, z: -1 });
    });
});

describe('the aim helpers', () => {
    it('round-trip: a rotation built from an aim lights along it', () => {
        for (const aim of [{ x: 1, y: 2, z: 3 }, { x: -4, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }]) {
            expectAim(lightAimOf(lightAimRotation(aim)), aim);
        }
    });

    it('turns nothing for an aim of nothing, rather than producing NaN', () => {
        const rotation = lightAimRotation({ x: 0, y: 0, z: 0 });
        expect(rotation).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    });

    it('rotationTo stays a unit quaternion, including the half turn', () => {
        for (const to of [{ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: -1 }]) {
            const r = q.rotationTo(LIGHT_FORWARD, to);
            expect(Math.hypot(r.w, r.x, r.y, r.z)).toBeCloseTo(1, 9);
        }
    });
});
