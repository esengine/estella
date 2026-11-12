// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Defaults follow the project's units: a length a default fills in is written at 100 units a metre and scaled by
 *        the project's own, so a character is a 1.6 m person in a centimetre project and in a metre one alike.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setWorldUnitsPerMeter, worldUnitScale, REFERENCE_UNITS_PER_METER } from '../src/ecs/worldUnits';
import { defineComponent } from '../src/ecs/component';
import { CharacterController3D, BoxCollider3D } from '../src/physics3d/Physics3DComponents';
import { FirstPersonController, FirstPersonViewModel } from '../src/gameplay/FirstPersonController';
import { NavVolume } from '../src/ai/nav/NavVolume';
import { Terrain } from '../src/terrain/terrainPlugin';
import { getComponent } from '../src/ecs/component';

afterEach(() => setWorldUnitsPerMeter(REFERENCE_UNITS_PER_METER));

describe('world-unit defaults', () => {
    it('are the defaults as written at the reference 100 units a metre — the same object', () => {
        expect(worldUnitScale()).toBe(1);
        const raw = FirstPersonController._default;
        expect(raw.moveSpeed).toBe(320);
        expect(FirstPersonController._default).toBe(raw);
        expect(CharacterController3D._default.radius).toBe(30);
    });

    it('in a metre project are metres: a 1.6 m character, a 3.2 m/s walk, a near plane of a centimetre', () => {
        setWorldUnitsPerMeter(1);
        const cc = CharacterController3D._default;
        expect(cc.radius).toBeCloseTo(0.3);
        expect(cc.halfHeight).toBeCloseTo(0.5);
        expect(FirstPersonController.create().moveSpeed).toBeCloseTo(3.2);
        expect(FirstPersonViewModel.create().nearPlane).toBeCloseTo(0.01);
        expect(BoxCollider3D._default.halfExtents).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
        expect(NavVolume.create().cellSize).toBeCloseTo(0.5);
    });

    it('make a new Terrain a kilometre of ground on 2 m cells whatever a unit is in the project', () => {
        expect(Terrain._default).toMatchObject({ sizeX: 100000, sizeZ: 100000, height: 15000, cellSize: 200, drawDistance: 400000, collisionDistance: 6400 });
        setWorldUnitsPerMeter(1);
        const t = Terrain._default;
        expect([t.sizeX, t.sizeZ, t.height, t.cellSize, t.drawDistance, t.collisionDistance].map((v) => Math.round(v * 1000) / 1000)).toEqual([1000, 1000, 150, 2, 4000, 64]);
        // What is not a length stays: how many hills, how steep rock is.
        expect(t.frequency).toBe(3);
    });

    it('never touch a value the scene states, nor a field that is not a length', () => {
        setWorldUnitsPerMeter(1);
        const fp = FirstPersonController.create({ moveSpeed: 5 });
        expect(fp.moveSpeed).toBe(5);
        expect(fp.sprintMultiplier).toBe(1.6);
        expect(fp.pitchMax).toBe(85);
        expect(CharacterController3D._default.maxSlope).toBe(0.87);
    });

    it('reach the generated builtins too (particles)', () => {
        setWorldUnitsPerMeter(1);
        const emitter = getComponent('ParticleEmitter')!._default as { speedMin: number; startSizeMin: number; rate: number };
        expect(emitter.speedMin).toBeCloseTo(5);
        expect(emitter.startSizeMin).toBeCloseTo(1);
        expect(emitter.rate).toBe(10);
    });

    it('refuses a world-unit field that names no field', () => {
        expect(() => defineComponent('WorldUnitTypo', { speed: 1 }, { worldUnitFields: ['sped'] })).toThrow(/sped/);
    });
});
