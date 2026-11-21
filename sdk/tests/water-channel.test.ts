// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A body's Curve Channel: the bed's profile across its edge from an elevation curve, where it starts against the shore, how it is
 *        laid over the ground (only cut, only raised, either way), the bank's falloff, the offset and the terraces; a lake and a river cut by
 *        it; and the islands, exclusion volumes and zone a body answers as acting on it.
 */
import { describe, expect, it } from 'vitest';
import { ChannelBlend, ChannelFalloff, channelAt, channelHeight, channelHeights, lakeChannelModifier, type ChannelSettings, type OutlineSpace } from '../src/water/landShape';
import { riverBedModifiers } from '../src/water/riverBed';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { ChannelShape, WaterBody, WaterForm, WaterPlugin, WatersRes } from '../src/water/waterPlugin';
import { WaterZone } from '../src/water/zone';

const linear = (u: number): number => u;
const settings = (extra: Partial<ChannelSettings> = {}): ChannelSettings => ({
    curve: linear, edgeOffset: 0, ramp: 10, blend: ChannelBlend.Min, falloff: 5, zOffset: 0, terraceAlpha: 0, terraceSpacing: 1, terraceSmoothness: 0, ...extra,
});

describe('a channel’s profile', () => {
    it('runs from the water’s surface at the curve’s start to the full depth at the ramp’s end', () => {
        const s = settings();
        expect(channelHeight(0, 4, 6, 10, s)).toBeCloseTo(4, 6);
        expect(channelHeight(5, 4, 6, 10, s)).toBeCloseTo(1, 6);
        expect(channelHeight(10, 4, 6, 10, s)).toBeCloseTo(-2, 6);
        expect(channelHeight(30, 4, 6, 10, s)).toBeCloseTo(-2, 6);
    });

    it('starts the curve the edge offset in from the shore, and out on the bank where it is negative', () => {
        expect(channelHeight(2, 4, 6, 10, settings({ edgeOffset: 2 }))).toBeCloseTo(4, 6);
        expect(channelHeight(0, 4, 6, 10, settings({ edgeOffset: -5 }))).toBeCloseTo(1, 6);
    });

    it('gives the ground back across the bank’s falloff, and leaves it past that', () => {
        const s = settings();
        const near = channelHeight(-1, 4, 6, 10, s), far = channelHeight(-4, 4, 6, 10, s);
        expect(near).toBeGreaterThanOrEqual(4);
        expect(near).toBeLessThan(far);
        expect(channelHeight(-6, 4, 6, 10, s)).toBe(10);
    });

    it('only cuts with Min, only raises with Max, and lays the profile either way with Alpha Blend', () => {
        // Ground at -5 under a bed whose profile is at 1 there.
        expect(channelHeight(5, 4, 6, -5, settings({ blend: ChannelBlend.Min }))).toBe(-5);
        expect(channelHeight(5, 4, 6, -5, settings({ blend: ChannelBlend.Max }))).toBeCloseTo(1, 6);
        expect(channelHeight(5, 4, 6, -5, settings({ blend: ChannelBlend.AlphaBlend }))).toBeCloseTo(1, 6);
        expect(channelHeight(5, 4, 6, 10, settings({ blend: ChannelBlend.Max }))).toBe(10);
    });

    it('moves the whole cut by its z offset, and steps it into terraces', () => {
        expect(channelHeight(10, 4, 6, 10, settings({ zOffset: -1 }))).toBeCloseTo(-3, 6);
        const stepped = channelHeight(5.5, 4, 6, 10, settings({ terraceAlpha: 1, terraceSpacing: 1 }));
        expect(stepped).toBe(Math.floor(stepped));
    });
});

describe('a channel’s bank, effects and terrace mask', () => {
    it('adds the cut onto the ground with Additive, keeping its slope', () => {
        const s = settings({ blend: ChannelBlend.Additive });
        expect(channelHeight(20, 4, 6, 10, s)).toBeCloseTo(4, 6);
        expect(channelHeight(20, 4, 6, 20, s)).toBeCloseTo(14, 6);
        expect(channelHeight(-2, 4, 6, 20, s)).toBeCloseTo(20, 6);
        expect(channelHeights(-2, 4, s).shifts![0]).toBeLessThanOrEqual(-6);
    });

    it('runs the bank out at its angle until it meets the ground, cutting a hill and filling a hollow with Alpha Blend', () => {
        const s = settings({ falloffMode: ChannelFalloff.Angle, falloffAngle: 45, falloff: 100, blend: ChannelBlend.AlphaBlend });
        expect(channelHeight(-3, 4, 6, 10, s)).toBeCloseTo(7, 6);
        expect(channelHeight(-8, 4, 6, 10, s)).toBeCloseTo(10, 6);
        expect(channelHeight(-3, 4, 6, -5, s)).toBeCloseTo(1, 6);
        expect(channelHeight(-3, 4, 6, -5, settings({ falloffMode: ChannelFalloff.Angle, falloffAngle: 45, falloff: 100 }))).toBe(-5);
    });

    it('keeps a flat edge at the water’s level before the falloff', () => {
        const s = settings({ bankEdge: 3, blend: ChannelBlend.AlphaBlend });
        expect(channelHeight(-2.5, 4, 6, 10, s)).toBeCloseTo(4, 6);
        expect(channelHeight(-3 - 5, 4, 6, 10, s)).toBe(10);
        expect(channelHeight(-3 - 2.5, 4, 6, 10, s)).toBeGreaterThan(4);
    });

    it('rounds the outer edge where the bank meets the ground, and leaves the ground exact past the rounding', () => {
        const angle = { falloffMode: ChannelFalloff.Angle, falloffAngle: 45, falloff: 100, blend: ChannelBlend.AlphaBlend };
        const hard = channelHeight(-6, 4, 6, 10, settings(angle)), soft = channelHeight(-6, 4, 6, 10, settings({ ...angle, outerSmooth: 2 }));
        expect(hard).toBeCloseTo(10, 6);
        expect(soft).toBeLessThan(hard);
        expect(channelHeight(-9, 4, 6, 10, settings({ ...angle, outerSmooth: 2 }))).toBeCloseTo(10, 6);
    });

    it('raises no ridge where the bank starts, with the ground far from the water either way', () => {
        const angle = { falloffMode: ChannelFalloff.Angle, falloffAngle: 45, falloff: 100, blend: ChannelBlend.AlphaBlend, bankEdge: 2, outerSmooth: 8 };
        for (const ground of [30, -30]) {
            expect(channelHeight(-2, 4, 6, ground, settings(angle))).toBeCloseTo(4, 6);
            expect(channelHeight(-1, 4, 6, ground, settings(angle))).toBeCloseTo(4, 6);
        }
    });

    it('rounds the inner edge where the bed leaves the bank', () => {
        const s = settings({ blend: ChannelBlend.AlphaBlend });
        // The bank is level and the bed falls away from it: rounded, the bank's last stretch begins to fall before the edge.
        const hard = channelHeight(-0.5, 4, 6, 4, s), soft = channelHeight(-0.5, 4, 6, 4, settings({ blend: ChannelBlend.AlphaBlend, innerSmooth: 4 }));
        expect(hard).toBeCloseTo(4, 6);
        expect(soft).toBeLessThan(hard);
        expect(channelHeight(30, 4, 6, 4, settings({ blend: ChannelBlend.AlphaBlend, innerSmooth: 4 }))).toBeCloseTo(-2, 6);
    });

    it('steps only inside the terrace mask’s span out from the edge', () => {
        const angle = { falloffMode: ChannelFalloff.Angle, falloffAngle: 45, falloff: 100, blend: ChannelBlend.AlphaBlend, terraceAlpha: 1, terraceSpacing: 1 };
        const masked = settings({ ...angle, terraceMaskStart: 4, terraceMaskLength: 3 });
        expect(channelHeight(-2.5, 4, 6, 20, masked)).toBeCloseTo(6.5, 6);
        const inside = channelHeight(-5.5, 4, 6, 20, masked);
        expect(inside).toBe(Math.floor(inside));
    });

    it('bends the edge by its curl noise and softens it by its blur, leaving the deep middle as it was', () => {
        const edge = (x: number): { d: number; surface: number; depth: number } => ({ d: x, surface: 4, depth: 6 });
        const plain = settings({ blend: ChannelBlend.AlphaBlend });
        const curled = settings({ blend: ChannelBlend.AlphaBlend, curlAmount1: 3, curlTiling1: 10 });
        let moved = 0;
        for (let z = 0; z < 40; z += 1) moved = Math.max(moved, Math.abs(channelAt((x) => edge(x), 3, z, 10, curled) - channelAt((x) => edge(x), 3, z, 10, plain)));
        expect(moved).toBeGreaterThan(0.1);
        const blurred = settings({ blend: ChannelBlend.AlphaBlend, blurRadius: 3 });
        expect(channelAt((x) => edge(x), 0, 0, 10, blurred)).not.toBeCloseTo(channelAt((x) => edge(x), 0, 0, 10, plain), 3);
        expect(channelAt((x) => edge(x), 30, 0, 10, blurred)).toBeCloseTo(-2, 6);
    });
});

describe('a lake and a river cut by their curve channel', () => {
    it('lays a lake’s floor from its outline, reaching out over the bank’s falloff', () => {
        const space: OutlineSpace = { outline: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
            toLocal: (x, z) => [x, z], toWorld: (x, z) => [x, z], scale: 1 };
        const floor = lakeChannelModifier('l', space, 2, 6, settings());
        expect(floor.apply(0, 0, 10)).toBeCloseTo(-4, 6);
        expect(floor.bounds).toEqual([-25, -25, 25, 25]);
        expect(floor.heights).toEqual([-4, 2]);
    });

    it('lays a river’s bed from its middle out, to the depth its stations carry', () => {
        const stations = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, z: 0, y: 0, half: 10, dx: 1, dz: 0, speed: 1, depth: i < 5 ? 2 : 6 }));
        const bed = riverBedModifiers('r', stations, 0, settings({ ramp: 5 }));
        const at = (x: number, z: number): number => bed.reduce((h, m) => (x >= m.bounds[0] && x <= m.bounds[2] && z >= m.bounds[1] && z <= m.bounds[3] ? m.apply(x, z, h) : h), 10);
        expect(at(20, 0)).toBeCloseTo(-2, 6);
        expect(at(80, 0)).toBeCloseTo(-6, 6);
        expect(at(80, 8)).toBeGreaterThan(at(80, 0));
        expect(at(80, 40)).toBe(10);
    });
});

describe('what acts on a body of water', () => {
    it('names the islands and exclusion volumes over it, none that are elsewhere, and its zone', async () => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        const app = App.new();
        const module = createMockModule();
        app.connectCpp(module.getRegistry(), module);
        app.addPlugin(new WaterPlugin());
        const spawn = (x: number, z: number, data: Record<string, unknown>): number => {
            const e = app.world.spawn();
            app.world.insert(e, Transform, { position: { x, y: 0, z }, worldPosition: { x, y: 0, z } });
            app.world.insert(e, WaterBody, { ...WaterBody._default, ...data });
            return e as number;
        };
        const zone = app.world.spawn();
        app.world.insert(zone, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
        app.world.insert(zone, WaterZone, { ...WaterZone._default, sizeX: 400, sizeZ: 400 });
        const lake = spawn(0, 0, { form: WaterForm.Lake, sizeX: 60, sizeZ: 60, channelShape: ChannelShape.BuiltIn });
        const isle = spawn(10, 10, { form: WaterForm.Island, sizeX: 10, sizeZ: 10, shoreWidth: 2 });
        const farIsle = spawn(150, 150, { form: WaterForm.Island, sizeX: 10, sizeZ: 10, shoreWidth: 2 });
        const room = spawn(-10, 0, { form: WaterForm.Exclusion, sizeX: 5, sizeZ: 5, sizeY: 4 });
        for (let i = 0; i < 20; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); }
        const got = app.getResource(WatersRes).influencesOf(lake as never);
        expect(got.islands).toEqual([isle]);
        expect(got.islands).not.toContain(farIsle);
        expect(got.exclusions).toEqual([room]);
        expect(got.zone).toBe(zone);
    });
});
