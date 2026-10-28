// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  weatherSystem.ts
 * @brief Runs the scene's Weather and TimeOfDay: advances them, and puts them on the lights.
 *
 * @details Only the lights are written to — the effects are read from `currentWeather()` and `currentTimeOfDay()` by the
 *          volume system a step later, which is what lets the editor preview the post-process half of a weather or an hour
 *          without the scene's own lights being changed (and saved) by it. The lights are rewritten only in play mode, from
 *          the strengths they were authored with, and put back when the weather and the clock go. One system owns both
 *          because both scale the same lights: each from what the author set, neither from the other's last answer.
 */
import { defineSystem } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Query, Mut } from '../ecs/query';
import { GetWorld } from '../ecs/system';
import {
    Weather, TimeOfDay, Light, Transform,
    type WeatherData, type TimeOfDayData, type LightData, type TransformData,
} from '../ecs/component';
import { AudioSource, type AudioSourceData } from '../audio/AudioComponents';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { isEditor, isPlayMode } from '../ecs/env';
import {
    blendWeather, setCurrentWeather, weatherPresetId, WEATHER_NONE, WeatherDrive, type WeatherState,
} from './weather';
import { Material } from '../render/material';
import { timeOfDayAt, setCurrentTimeOfDay, TimeDrive, type TimeOfDayState } from './timeOfDay';

/** What a light was authored with, kept so a weather scales the author's number and never its own last answer. */
interface LightBase {
    intensity: number;
    color: { r: number; g: number; b: number; a: number };
    reflectionScale: number;
    reflectionSaturation: number;
    sourceAngle: number;
    shadowStrength: number;
    aimFollowedSun: boolean;
    bakedTint: { r: number; g: number; b: number; a: number };
    /** The aim the light had, once the clock has taken it. */
    rotation: { x: number; y: number; z: number; w: number } | null;
    applied: string;
}

const bases = new Map<Entity, LightBase>();

/** The materials the weather has put its wind on, so they can be set back to 1 when it goes. */
const blown = new Set<number>();

/**
 * The weather's wind on sprites that sway: a material that declares `u_swayWind` (the Sway template) is told how hard it blows, as the Foliage
 * module tells its own. A value written per frame, not scaled from an authored one, so there is nothing to put back but the 1 it started at.
 */
function blowSprites(wind: number): void {
    if (wind === 1 && blown.size === 0) return;
    for (const material of Material.materialsDeclaring('u_swayWind')) {
        Material.setUniform(material, 'u_swayWind', wind);
        if (wind === 1) blown.delete(material); else blown.add(material);
    }
}

/** Where each Weather is in its sequence, and how long it has held. Not in the component: a scene file need not carry it. */
const cycles = new Map<Entity, { index: number; held: number }>();

/** The volume a rain track was authored at, so the weather scales the author's number and not its own last answer. */
const soundBases = new Map<Entity, number>();

const LIGHT_DIRECTIONAL = 1;
const LIGHT_AMBIENT = 2;

function restoreLights(world: World): void {
    for (const [entity, base] of bases) {
        if (world.has(entity, Light)) {
            const data = world.get(entity, Light) as LightData;
            world.set(entity, Light, {
                ...data, intensity: base.intensity, color: { ...base.color },
                reflectionScale: base.reflectionScale, reflectionSaturation: base.reflectionSaturation,
                sourceAngle: base.sourceAngle, shadowStrength: base.shadowStrength, aimFollowedSun: base.aimFollowedSun,
                bakedTint: { ...base.bakedTint },
            });
        }
        if (base.rotation && world.has(entity, Transform)) {
            const t = world.get(entity, Transform) as TransformData;
            world.set(entity, Transform, { ...t, rotation: { ...base.rotation } });
        }
    }
    bases.clear();
}

/** The rotation that turns a thing facing -Z (a light) to face `f`: a turn about Y, then one about X. */
function aimQuaternion(f: [number, number, number]): { x: number; y: number; z: number; w: number } {
    const len = Math.hypot(f[0], f[1], f[2]) || 1;
    const yaw = Math.atan2(-f[0], -f[2]);
    const pitch = Math.asin(Math.min(Math.max(f[1] / len, -1), 1));
    const qy = { w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 };
    const qx = { w: Math.cos(pitch / 2), x: Math.sin(pitch / 2), y: 0, z: 0 };
    return {
        w: qy.w * qx.w - qy.x * qx.x - qy.y * qx.y - qy.z * qx.z,
        x: qy.w * qx.x + qy.x * qx.w + qy.y * qx.z - qy.z * qx.y,
        y: qy.w * qx.y - qy.x * qx.z + qy.y * qx.w + qy.z * qx.x,
        z: qy.w * qx.z + qy.x * qx.y - qy.y * qx.x + qy.z * qx.w,
    };
}

/**
 * Whether the scene's key light already shines the way the clock says: the case in the editor when something other than the
 * clock (a script, a hand) has set the lights to the hour, and the effects that follow the sun should follow that light.
 */
function keyLightAgrees(world: World, time: TimeOfDayState): boolean {
    for (const entity of world.getEntitiesWithComponents([Light])) {
        const data = world.get(entity, Light) as LightData;
        if (data.type !== LIGHT_DIRECTIONAL || !(data.followEnvironmentSun || data.meshShadows) || !world.has(entity, Transform)) continue;
        const q = (world.get(entity, Transform) as TransformData).rotation;
        const f: [number, number, number] = [-2 * (q.x * q.z + q.w * q.y), -2 * (q.y * q.z - q.w * q.x), -(1 - 2 * (q.x * q.x + q.y * q.y))];
        const l = time.lightDir;
        return -(f[0] * l[0] + f[1] * l[1] + f[2] * l[2]) > 0.9985;
    }
    return false;
}

/** What is scaling the lights this frame: a weather, a time of day, either, both. */
interface Rig {
    weather: WeatherState | null;
    weatherDrive: number;
    time: TimeOfDayState | null;
    timeDrive: number;
}

function applyLights(world: World, rig: Rig): void {
    const { weather, time } = rig;
    const lightsByWeather = !!weather && (rig.weatherDrive & WeatherDrive.Lights) !== 0;
    const reflectionsByWeather = !!weather && (rig.weatherDrive & WeatherDrive.Reflections) !== 0;
    const lightsByTime = !!time && (rig.timeDrive & TimeDrive.Lights) !== 0;
    const reflectionsByTime = !!time && (rig.timeDrive & TimeDrive.Reflections) !== 0;

    const lights = world.getEntitiesWithComponents([Light]);
    // The sun of the scene, for the clock to aim: the lights that follow a panorama's sun or cast shadows, else the first directional.
    const suns = new Set<Entity>();
    let firstDirectional: Entity | null = null;
    for (const entity of lights) {
        const data = world.get(entity, Light) as LightData;
        if (data.type !== LIGHT_DIRECTIONAL) continue;
        if (firstDirectional === null) firstDirectional = entity;
        if (data.followEnvironmentSun || data.meshShadows) suns.add(entity);
    }
    if (suns.size === 0 && firstDirectional !== null) suns.add(firstDirectional);

    for (const entity of lights) {
        const data = world.get(entity, Light) as LightData;
        if (data.type !== LIGHT_DIRECTIONAL && data.type !== LIGHT_AMBIENT) continue;
        let base = bases.get(entity);
        if (!base) {
            base = {
                intensity: data.intensity, color: { ...data.color },
                reflectionScale: data.reflectionScale ?? 1, reflectionSaturation: data.reflectionSaturation ?? 1,
                sourceAngle: data.sourceAngle ?? 0, shadowStrength: data.shadowStrength ?? 1,
                aimFollowedSun: data.aimFollowedSun ?? false,
                bakedTint: { ...(data.bakedTint ?? { r: 1, g: 1, b: 1, a: 1 }) }, rotation: null,
                applied: '',
            };
            bases.set(entity, base);
        }
        const sun = data.type === LIGHT_DIRECTIONAL;
        const wScale = lightsByWeather ? (sun ? weather!.sun : weather!.sky) : 1;
        const tScale = lightsByTime ? (sun ? time!.light : time!.sky) : 1;
        const wTint: [number, number, number] = lightsByWeather && sun ? weather!.sunTint : [1, 1, 1];
        const tTint: [number, number, number] = lightsByTime ? (sun ? time!.lightTint : time!.skyTint) : [1, 1, 1];
        const reflections = !sun && (reflectionsByWeather || reflectionsByTime);
        const refl = (reflectionsByWeather ? weather!.reflection : 1) * (reflectionsByTime ? time!.reflection : 1);
        const reflSat = (reflectionsByWeather ? weather!.reflectionSaturation : 1) * (reflectionsByTime ? time!.reflectionSaturation : 1);
        const aimed = lightsByTime && sun && suns.has(entity);
        // A bake holds one moment's light, so the ambient light's scale and tint are laid over it too.
        const bake = !sun && (lightsByWeather || lightsByTime);
        // The key is what the light would be told: nothing is written for a frame that would say the same again.
        const key = [
            wScale, tScale, wTint[0], wTint[1], wTint[2], tTint[0], tTint[1], tTint[2], reflections ? refl : 0, reflections ? reflSat : 0,
            lightsByWeather && sun ? weather!.shadowSoftness : 0, lightsByWeather && sun ? weather!.shadowStrength : 0,
            bake ? 1 : 0, aimed ? time!.lightDir[0] : 0, aimed ? time!.lightDir[1] : 0, aimed ? time!.lightDir[2] : 0,
        ].map((v) => v.toFixed(5)).join(',');
        if (base.applied === key) continue;
        base.applied = key;
        const color = {
            r: base.color.r * wTint[0] * tTint[0], g: base.color.g * wTint[1] * tTint[1], b: base.color.b * wTint[2] * tTint[2], a: base.color.a,
        };
        // A sun's width in the sky is 0.53 degrees: softer shadows are a wider source, and a hard-edged light (0) gains the
        // difference too, so the setting always means something.
        const widen = lightsByWeather && sun ? Math.max(weather!.shadowSoftness - 1, 0) * 0.53 : 0;
        world.set(entity, Light, {
            ...data, intensity: base.intensity * wScale * tScale, color,
            sourceAngle: base.sourceAngle + widen,
            shadowStrength: lightsByWeather && sun ? Math.min(base.shadowStrength * weather!.shadowStrength, 1) : base.shadowStrength,
            reflectionScale: reflections ? base.reflectionScale * refl : base.reflectionScale,
            reflectionSaturation: reflections ? base.reflectionSaturation * reflSat : base.reflectionSaturation,
            aimFollowedSun: aimed ? true : base.aimFollowedSun,
            bakedTint: bake
                ? { r: base.bakedTint.r * wScale * tScale * tTint[0], g: base.bakedTint.g * wScale * tScale * tTint[1], b: base.bakedTint.b * wScale * tScale * tTint[2], a: 1 }
                : { ...base.bakedTint },
        });
        if (aimed && world.has(entity, Transform)) {
            const t = world.get(entity, Transform) as TransformData;
            if (!base.rotation) base.rotation = { ...t.rotation };
            const l = time!.lightDir;
            world.set(entity, Transform, { ...t, rotation: aimQuaternion([-l[0], -l[1], -l[2]]) });
        } else if (!aimed && base.rotation && world.has(entity, Transform)) {
            const t = world.get(entity, Transform) as TransformData;
            world.set(entity, Transform, { ...t, rotation: { ...base.rotation } });
            base.rotation = null;
        }
    }
}

function restoreSound(world: World): void {
    for (const [entity, volume] of soundBases) {
        if (world.has(entity, AudioSource)) {
            const data = world.get(entity, AudioSource) as AudioSourceData;
            world.set(entity, AudioSource, { ...data, volume, playing: false });
        }
    }
    soundBases.clear();
}

/** The rain's track, loud as the weather is: raised while it rains at all, lowered when it stops. */
function applySound(world: World, source: number, state: WeatherState): void {
    const entity = source as Entity;
    if (!world.has(entity, AudioSource)) return;
    const data = world.get(entity, AudioSource) as AudioSourceData;
    let base = soundBases.get(entity);
    if (base === undefined) {
        base = data.volume;
        soundBases.set(entity, base);
    }
    const volume = base * Math.min(state.sound, 1.5);
    const playing = state.sound > 0.02;
    if (Math.abs(data.volume - volume) < 1e-4 && data.playing === playing) return;
    world.set(entity, AudioSource, { ...data, volume, playing, loop: true });
}

/** The preset a name or an id in a sequence stands for. */
function presetOf(token: string): number | undefined {
    const trimmed = token.trim();
    if (trimmed === '') return undefined;
    const named = weatherPresetId(trimmed.toLowerCase());
    if (named !== undefined) return named;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
}

function advance(entity: Entity, data: WeatherData, dt: number): void {
    if (data.target !== WEATHER_NONE) {
        data.progress += dt / Math.max(data.duration, 0.01);
        if (data.progress >= 1) {
            data.preset = data.target;
            data.target = WEATHER_NONE;
            data.progress = 0;
        }
        return;
    }
    if (!data.sequence) return;
    const list = data.sequence.split(',').map(presetOf).filter((v): v is number => v !== undefined);
    if (list.length < 2) return;
    let cycle = cycles.get(entity);
    if (!cycle) {
        // Joins the sequence where the scene is: the first entry that is the weather now, else the start.
        const at = list.indexOf(data.preset);
        cycle = { index: at < 0 ? 0 : at, held: 0 };
        cycles.set(entity, cycle);
    }
    cycle.held += dt;
    if (cycle.held < data.hold) return;
    cycle.held = 0;
    cycle.index = (cycle.index + 1) % list.length;
    data.target = list[cycle.index];
    data.progress = 0;
}

// system-access: the weather reads and writes the lights, the sound sources and the post-process volumes it drives, which no query names.
export const weatherSystem = defineSystem(
    [Query(Mut(Weather)), Query(Mut(TimeOfDay)), Res(Time), GetWorld()],
    (weathers: Iterable<[Entity, WeatherData]>, times: Iterable<[Entity, TimeOfDayData]>, time: TimeData, world: World) => {
        let found: [Entity, WeatherData] | null = null;
        for (const entry of weathers) { found = entry; break; }
        let clock: [Entity, TimeOfDayData] | null = null;
        for (const entry of times) { clock = entry; break; }
        if (!found && !clock) {
            blowSprites(1);
            if (bases.size > 0) restoreLights(world);
            if (soundBases.size > 0) restoreSound(world);
            cycles.clear();
            setCurrentWeather(null);
            setCurrentTimeOfDay(null);
            return;
        }
        const playing = !isEditor() || isPlayMode();

        let weatherState: WeatherState | null = null;
        let weatherDrive = 0;
        if (found) {
            const [entity, data] = found;
            if (playing) advance(entity, data, time.delta);
            weatherState = blendWeather(data.preset, data.target, data.progress);
            weatherDrive = data.drive;
            setCurrentWeather(weatherState, data.drive);
        } else {
            setCurrentWeather(null);
        }

        let timeState: TimeOfDayState | null = null;
        let timeDrive = 0;
        if (clock) {
            const data = clock[1];
            if (playing && data.daySeconds > 0) data.hour = (data.hour + time.delta * 24 / data.daySeconds) % 24;
            timeState = timeOfDayAt(data.hour, data.latitude, data.declination, data.north);
            timeDrive = data.drive;
            setCurrentTimeOfDay(timeState, data.drive, (playing && (data.drive & TimeDrive.Lights) !== 0) || (!playing && keyLightAgrees(world, timeState)));
        } else {
            setCurrentTimeOfDay(null);
        }

        blowSprites(weatherState && playing && (weatherDrive & WeatherDrive.Wind) ? weatherState.wind : 1);

        const lightWork = (weatherState !== null && (weatherDrive & (WeatherDrive.Lights | WeatherDrive.Reflections)) !== 0)
            || (timeState !== null && (timeDrive & (TimeDrive.Lights | TimeDrive.Reflections)) !== 0);
        if (playing && lightWork) applyLights(world, { weather: weatherState, weatherDrive, time: timeState, timeDrive });
        else if (bases.size > 0) restoreLights(world);

        if (found && playing && (found[1].drive & WeatherDrive.Sound) && found[1].soundSource) applySound(world, found[1].soundSource, weatherState!);
        else if (soundBases.size > 0) restoreSound(world);
    },
    { name: 'WeatherSystem' }
);

/** Forgets what the system remembers: a device loss, a test, an app shut down. */
export function resetWeatherSystem(): void {
    bases.clear();
    soundBases.clear();
    blown.clear();
    cycles.clear();
    setCurrentWeather(null);
    setCurrentTimeOfDay(null);
}
