// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from 'vitest';
import { Light, Transform, type AnyComponentDef, type ComponentData } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';
import { timeOfDayAt, TimeDrive } from '../src/postprocess/timeOfDay';
import { applyLights, resetWeatherSystem } from '../src/postprocess/weatherSystem';

const SUN = 1 as Entity, SKY = 2 as Entity, LAMP = 3 as Entity;

const light = (over: Record<string, unknown>): ComponentData<typeof Light> => ({
    type: 2, intensity: 1, color: { r: 1, g: 1, b: 1, a: 1 }, reflectionScale: 1, reflectionSaturation: 1, sourceAngle: 0,
    shadowStrength: 1, aimFollowedSun: false, followEnvironmentSun: false, meshShadows: false, environment: 0,
    bakedTint: { r: 1, g: 1, b: 1, a: 1 }, ...over,
}) as unknown as ComponentData<typeof Light>;

class Lights {
    private data = new Map<string, unknown>();
    constructor() {
        this.put(SUN, Light, light({ type: 1, intensity: 3, meshShadows: true }));
        this.put(SUN, Transform, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } as unknown as ComponentData<typeof Transform>);
        this.put(SKY, Light, light({ intensity: 0.6, color: { r: 0.8, g: 0.88, b: 1, a: 1 } }));
        this.put(LAMP, Light, light({ intensity: 0.5, environment: 7 }));
    }
    private put<C extends AnyComponentDef>(e: Entity, c: C, data: ComponentData<C>): void { this.data.set(`${e}:${c._name}`, data); }
    getEntitiesWithComponents(): Entity[] { return [SUN, SKY, LAMP]; }
    has<C extends AnyComponentDef>(e: Entity, c: C): boolean { return this.data.has(`${e}:${c._name}`); }
    get<C extends AnyComponentDef>(e: Entity, c: C): ComponentData<C> { return structuredClone(this.data.get(`${e}:${c._name}`)) as ComponentData<C>; }
    set<C extends AnyComponentDef>(e: Entity, c: C, data: ComponentData<C>): void { this.put(e, c, data); }
}

const at = (lights: Lights, hour: number, skyLightsScene: boolean) => {
    const time = timeOfDayAt(hour, 35, 10, 180);
    applyLights(lights as unknown as World, { weather: null, weatherDrive: 0, time, timeDrive: TimeDrive.All, skyLightsScene });
    return { time, sun: lights.get(SUN, Light), sky: lights.get(SKY, Light), lamp: lights.get(LAMP, Light) };
};

describe('the clock on a scene\'s lights', () => {
    beforeEach(() => resetWeatherSystem());

    it('leaves an ambient light the sky lights at its authored strength and colour, at every hour', () => {
        const lights = new Lights();
        for (const hour of [12, 17.9, 18.4, 19.4, 0, 6]) {
            const now = at(lights, hour, true);
            expect(now.sky.intensity).toBeCloseTo(0.6, 6);
            expect(now.sky.color).toEqual({ r: 0.8, g: 0.88, b: 1, a: 1 });
            expect(now.sun.intensity).toBeCloseTo(3 * now.time.light, 6);
        }
    });

    it('scales an ambient light by the hour when the sky does not light the scene', () => {
        const lights = new Lights();
        const dusk = at(lights, 18.4, false);
        expect(dusk.time.sky).toBeLessThan(0.5);
        expect(dusk.sky.intensity).toBeCloseTo(0.6 * dusk.time.sky, 6);
        expect(dusk.sky.color.r).toBeCloseTo(0.8 * dusk.time.skyTint[0], 6);
    });

    it('still scales an ambient light with an environment of its own under a sky that lights the scene', () => {
        const lights = new Lights();
        const dusk = at(lights, 18.4, true);
        expect(dusk.lamp.intensity).toBeCloseTo(0.5 * dusk.time.sky, 6);
    });

    it('follows the sky being turned on and off while the game runs, with nothing left of the mode before', () => {
        const lights = new Lights();
        const scaled = at(lights, 18.4, false).sky.intensity;
        expect(at(lights, 18.4, true).sky.intensity).toBeCloseTo(0.6, 6);
        expect(at(lights, 18.4, false).sky.intensity).toBeCloseTo(scaled, 6);
        expect(at(lights, 18.4, true).sky.intensity).toBeCloseTo(0.6, 6);
        expect(at(lights, 18.4, true).sky.color).toEqual({ r: 0.8, g: 0.88, b: 1, a: 1 });
    });

    it('does not drift over days, in either mode', () => {
        for (const skyLightsScene of [true, false]) {
            resetWeatherSystem();
            const lights = new Lights();
            const first = new Map<number, [number, number]>();
            for (let step = 0; step < 24 * 4 * 5; step++) {
                const hour = (step % (24 * 4)) / 4;
                const now = at(lights, hour, skyLightsScene);
                const seen = first.get(hour);
                if (seen === undefined) first.set(hour, [now.sun.intensity, now.sky.intensity]);
                else {
                    expect(Math.abs(now.sun.intensity - seen[0])).toBeLessThan(1e-4);
                    expect(Math.abs(now.sky.intensity - seen[1])).toBeLessThan(1e-4);
                }
            }
        }
    });
});
