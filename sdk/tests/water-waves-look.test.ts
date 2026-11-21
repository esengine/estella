// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A body's waves calmed by the depth of its water, its shape grown past its outline, its colour given by priority where it overlaps
 *        another, and its look from under its water laid over another body's by priority, blend weight and blend radius.
 */
import { describe, expect, it } from 'vitest';
import { WaterField, WaterZone, insideBody, type ZoneGrid, type ZoneLake, type ZoneOcean, type ZoneRiver } from '../src/water/zone';
import type { Point2 } from '../src/water/shore';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Camera, Transform } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { UnderwaterLook, WaterBody, WaterForm, WaterPlugin } from '../src/water/waterPlugin';
import { UnderwaterPlugin } from '../src/water/underwater';
import { currentUnderwater } from '../src/postprocess/underwater';

const grid: ZoneGrid = { minX: -100, minZ: -100, sizeX: 200, sizeZ: 200, nx: 201, nz: 201 };
const square = (half: number): Point2[] => [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
const lakeAt = (cx: number, half: number, extra: Partial<ZoneLake> = {}): ZoneLake => ({
    kind: 'lake', key: 1, level: 0, waveHeight: 1, shoreWidth: 1, outline: square(half),
    toLocal: (x, z) => [x - cx, z], toWorld: (x, z) => [x + cx, z], ...extra,
});

describe('the waves calmed by depth', () => {
    it('calm where the water is shallower than the attenuation depth, and by no depth where it is 0', () => {
        // Ground a unit under the lake's surface: shallow water far from any shore.
        const shallow = (): number => -1;
        const calmAt = (attenuationDepth?: number): number => {
            const s = WaterField.bake(grid, [lakeAt(0, 60, attenuationDepth === undefined ? {} : { attenuationDepth })], shallow).sample(0, 0)!;
            return s.calm;
        };
        expect(calmAt(10)).toBeLessThan(0.1);
        expect(calmAt(0)).toBeCloseTo(1, 2);
        // Absent, the shore width (1) says it: a unit deep is calm-free.
        expect(calmAt()).toBeCloseTo(1, 2);
    });
});

describe('a body grown past its outline', () => {
    it('has water past its outline as far as its dilation, and none past that', () => {
        const plain = WaterField.bake(grid, [lakeAt(0, 20)]), grown = WaterField.bake(grid, [lakeAt(0, 20, { dilation: 4 })]);
        expect(plain.sample(22, 0)).toBeNull();
        expect(grown.sample(22, 0)?.key).toBe(1);
        expect(grown.sample(26, 0)).toBeNull();
    });
});

describe('the colour where two bodies overlap', () => {
    const red = lakeAt(-15, 20, { key: 1, color: [1, 0, 0] });
    const blue = lakeAt(15, 20, { key: 2, color: [0, 0, 1] });
    const colourAt = (field: WaterField, x: number): number[] => {
        const k = Math.round((0 - grid.minZ) / grid.sizeZ * (grid.nz - 1)) * grid.nx + Math.round((x - grid.minX) / grid.sizeX * (grid.nx - 1));
        return [field.look[k * 3]!, field.look[k * 3 + 1]!, field.look[k * 3 + 2]!];
    };

    it('blends equal priorities by how far inside each the water is', () => {
        const [r, , b] = colourAt(WaterField.bake(grid, [red, blue]), 0);
        expect(r).toBeGreaterThan(0.2);
        expect(b).toBeGreaterThan(0.2);
    });

    it('gives the higher priority the overlap', () => {
        const [r, , b] = colourAt(WaterField.bake(grid, [red, { ...blue, priority: 1 }]), 0);
        expect(b).toBeCloseTo(1, 3);
        expect(r).toBeCloseTo(0, 3);
    });
});

describe('inside a body', () => {
    it('measures in from a lake’s outline and a river’s banks, and has every point in an ocean', () => {
        expect(insideBody(lakeAt(0, 20), 5, 0)!.inside).toBeCloseTo(15, 6);
        expect(insideBody(lakeAt(0, 20, { dilation: 3 }), 22, 0)!.inside).toBeCloseTo(1, 6);
        const river: ZoneRiver = { kind: 'river', key: 4, waveHeight: 0, shoreWidth: 1, stations: [
            { x: 0, z: 0, y: 5, half: 4, dx: 1, dz: 0, speed: 1 }, { x: 10, z: 0, y: 3, half: 4, dx: 1, dz: 0, speed: 1 }] };
        expect(insideBody(river, 5, 1)).toMatchObject({ inside: 3, level: 4 });
        const ocean: ZoneOcean = { kind: 'ocean', key: 3, level: 0, waveHeight: 1, shoreWidth: 4 };
        expect(insideBody(ocean, 1e4, -1e4)!.inside).toBeGreaterThan(1e4);
    });
});

describe('the look from under the water of two bodies', () => {
    it('lays the higher priority over the lower by its blend weight, fades it in across its blend radius, and leaves a body with it off out', async () => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        const app = App.new();
        const module = createMockModule();
        app.connectCpp(module.getRegistry(), module);
        app.addPlugin(new WaterPlugin());
        app.addPlugin(new UnderwaterPlugin());
        const zone = app.world.spawn();
        app.world.insert(zone, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
        app.world.insert(zone, WaterZone, { ...WaterZone._default, sizeX: 200, sizeZ: 200 });
        const look = (r: number, g: number, b: number) => ({ underwaterLook: UnderwaterLook.Own, underwaterAbsorption: { r, g, b, a: 1 } });
        const sea = app.world.spawn();
        app.world.insert(sea, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
        app.world.insert(sea, WaterBody, { ...WaterBody._default, form: WaterForm.Ocean, ...look(1, 0, 0) });
        const lake = app.world.spawn();
        app.world.insert(lake, Transform, { position: { x: 0, y: 2, z: 0 }, worldPosition: { x: 0, y: 2, z: 0 } });
        app.world.insert(lake, WaterBody, { ...WaterBody._default, form: WaterForm.Lake, sizeX: 60, sizeZ: 60, ...look(0, 0, 1),
            underwaterPriority: 1, underwaterBlendWeight: 0.5, underwaterBlendRadius: 10 });
        const step = async (n = 1): Promise<void> => { for (let i = 0; i < n; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };
        await step(40);
        const eye = app.world.spawn();
        app.world.insert(eye, Transform, { position: { x: 0, y: -1, z: 0 }, worldPosition: { x: 0, y: -1, z: 0 } });
        app.world.insert(eye, Camera, { isActive: true, nearPlane: 0.1 });
        await step();
        // Under both: the lake's half over the sea's.
        expect(currentUnderwater()!.absorption.map((v) => Number(v.toFixed(3)))).toEqual([0.5, 0, 0.5]);
        expect(currentUnderwater()!.amount).toBeCloseTo(1, 6);
        // Five out past the lake's outline, half way across its blend radius: a quarter of it.
        app.world.insert(eye, Transform, { position: { x: 35, y: -1, z: 0 }, worldPosition: { x: 35, y: -1, z: 0 } });
        await step();
        expect(currentUnderwater()!.absorption[2]).toBeCloseTo(0.25, 3);
        // The sea's priority over the lake's: all sea.
        app.world.insert(eye, Transform, { position: { x: 0, y: -1, z: 0 }, worldPosition: { x: 0, y: -1, z: 0 } });
        app.world.insert(sea, WaterBody, { ...app.world.get(sea, WaterBody), underwaterPriority: 2 });
        await step();
        expect(currentUnderwater()!.absorption).toEqual([1, 0, 0]);
        // Both off: nothing under water.
        app.world.insert(sea, WaterBody, { ...app.world.get(sea, WaterBody), underwaterEnabled: false });
        app.world.insert(lake, WaterBody, { ...app.world.get(lake, WaterBody), underwaterEnabled: false });
        await step();
        expect(currentUnderwater()).toBeNull();
    });
});
