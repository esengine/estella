// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  timeOfDay.ts
 * @brief Where the sun and the moon are at an hour of the day, and what that does to the light, the fog and the sky.
 *
 * @details The sun is placed by the astronomy that fits in four lines — an hour angle, a latitude and a declination — so a
 *          day has the right shape (a long arc in summer, a low one in winter, sunrise toward the east) with three numbers a
 *          person can understand. Everything else is the same idea as the weather: MULTIPLIERS of what the scene already
 *          says (the sun at its strength times a curve, the fog's colour times how dark it is) so the same hour fits any
 *          scene. The moon stands opposite the sun and is the directional light's aim while the sun is down.
 *
 *          The state is applied in two places, as the weather's is: to the lights (in play mode, from the weather
 *          system, which owns the lights so the two scale one number and not each other's last answer) and to the
 *          effects the volumes resolve.
 */
import type { BlendedEffect, Rgba } from './volumeBlending';
import { getEffectDef } from './effects';

export interface TimeOfDayState {
    /** The hour this is the state of, 0..24. */
    hour: number;
    /** Unit vectors toward the sun and the moon, in world space (Y up). */
    sunDir: [number, number, number];
    moonDir: [number, number, number];
    /** The sun's height above the horizon in degrees, negative below it. */
    sunElevation: number;
    /** The sun's azimuth as the effects take it: degrees from +Z toward +X. */
    sunAzimuth: number;
    /** 0 at night, 1 by day, with the dusk between. */
    daylight: number;
    /** The unit vector the key (directional) light shines FROM: the sun by day, the moon by night. */
    lightDir: [number, number, number];
    /** × the key light's strength, and what it is tinted: warm at the horizon, white overhead, blue by moonlight. */
    light: number;
    lightTint: [number, number, number];
    /** × the ambient light's strength, and its tint. */
    sky: number;
    skyTint: [number, number, number];
    /** × what baked reflection probes show, and × their colour. */
    reflection: number;
    reflectionSaturation: number;
    /** × Height Fog's colour (how lit the haze is), and the dusk colour it moves toward and how far. */
    fogBrightness: number;
    fogDusk: number;
    /** Stops added to the exposure compensation: a night is kept readable, not as bright as a day. */
    exposure: number;
}

/** What a time of day drives. A bit each, so a project can take the sky from the clock and keep its own light. */
export const TimeDrive = {
    Lights: 1,
    Sky: 2,
    Fog: 4,
    Exposure: 8,
    Reflections: 16,
    All: 31,
} as const;

const RAD = Math.PI / 180;

const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
    [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** A direction from an elevation and an azimuth, both in radians, the azimuth from +Z toward +X. */
function direction(elevation: number, azimuth: number): [number, number, number] {
    const c = Math.cos(elevation);
    return [c * Math.sin(azimuth), Math.sin(elevation), c * Math.cos(azimuth)];
}

/**
 * The sun's place at an hour: its elevation and its azimuth from +Z toward +X, in radians.
 *
 * @param hour        Solar time, 0..24; 12 is noon.
 * @param latitude    Degrees; where on the planet. Positive is north.
 * @param declination Degrees, -23.5..23.5: the season. Positive is summer in the north.
 * @param north       Degrees the world is turned from compass north (+Z) toward +X.
 */
export function sunPosition(hour: number, latitude: number, declination: number, north: number): { elevation: number; azimuth: number } {
    const phi = latitude * RAD;
    const delta = declination * RAD;
    const hourAngle = (hour - 12) * 15 * RAD;
    const sinE = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle);
    const elevation = Math.asin(Math.min(Math.max(sinE, -1), 1));
    // From north, clockwise (east is 90): mornings are east of the meridian and afternoons west of it.
    const cosA = (Math.sin(delta) - sinE * Math.sin(phi)) / Math.max(Math.cos(elevation) * Math.cos(phi), 1e-5);
    let compass = Math.acos(Math.min(Math.max(cosA, -1), 1));
    if (hourAngle > 0) compass = 2 * Math.PI - compass;
    // Compass north is +Z and east is +X until `north` turns the world; the effects count azimuth from +Z toward +X.
    return { elevation, azimuth: compass + north * RAD };
}

/** The time of day at an hour. @beta */
export function timeOfDayAt(hour: number, latitude = 40, declination = 15, north = 0): TimeOfDayState {
    const h = ((hour % 24) + 24) % 24;
    const sun = sunPosition(h, latitude, declination, north);
    const sinE = Math.sin(sun.elevation);
    const sunDir = direction(sun.elevation, sun.azimuth);
    // The moon stands opposite the sun and higher than the sun is low, so it is up for most of a night. Matches Sky Atmosphere.
    const moonEl = -sun.elevation * 0.85 + 12 * RAD;
    const moonDir = direction(moonEl, sun.azimuth + Math.PI);
    const sinM = Math.sin(moonEl);

    const daylight = smooth(-0.12, 0.28, sinE);
    const dusk = Math.exp(-sinE * sinE * 60);

    // The sun's own light: gone a little below the horizon, warm and weak while it is low.
    const sunStrength = Math.pow(smooth(-0.03, 0.3, sinE), 1.1);
    const warm = smooth(0, 0.4, sinE);
    const sunTint: [number, number, number] = [1, mix(0.55, 0.97, warm), mix(0.3, 0.94, warm)];
    // The moon's: a few hundredths of the sun's, blue, and only once the sun is well out of the way.
    const moonStrength = 0.06 * smooth(0.0, 0.12, sinM) * smooth(-0.03, -0.12, sinE);
    const sunUp = sinE > -0.03;

    const nightSky: [number, number, number] = [0.5, 0.62, 1];
    const duskSky: [number, number, number] = [1, 0.72, 0.55];
    const skyTint = mix3(mix3(nightSky, [1, 1, 1], daylight), duskSky, dusk * 0.45);

    return {
        hour: h,
        sunDir, moonDir,
        sunElevation: sun.elevation / RAD,
        sunAzimuth: ((sun.azimuth / RAD) % 360 + 360) % 360,
        daylight,
        lightDir: sunUp ? sunDir : moonDir,
        light: sunUp ? sunStrength : moonStrength,
        lightTint: sunUp ? sunTint : [0.55, 0.68, 1],
        sky: mix(0.14, 1, daylight) * mix(1, 0.8, dusk),
        skyTint,
        reflection: mix(0.12, 1, daylight),
        reflectionSaturation: mix(0.6, 1, daylight),
        fogBrightness: mix(0.035, 1, daylight),
        fogDusk: dusk * 0.5,
        exposure: (1 - daylight) * 1.1,
    };
}

export function timeScaleOfLight(time: TimeOfDayState, sun: boolean, litBySky: boolean): { scale: number; tint: [number, number, number] } {
    if (sun) return { scale: time.light, tint: time.lightTint };
    if (litBySky) return { scale: 1, tint: [1, 1, 1] };
    return { scale: time.sky, tint: time.skyTint };
}

/** The state the frame is under, or null when no TimeOfDay is. Set by the weather system, read by the volumes. */
let current: { state: TimeOfDayState; drive: number; lightsApplied: boolean } | null = null;

export function setCurrentTimeOfDay(state: TimeOfDayState | null, drive: number = TimeDrive.All, lightsApplied = false): void {
    current = state ? { state, drive, lightsApplied } : null;
}

/** The time of day the frame is under, or null. @beta */
export function currentTimeOfDay(): TimeOfDayState | null {
    return current ? current.state : null;
}

export function currentTimeDrive(): number {
    return current ? current.drive : 0;
}

/** Whether the scene's lights are being moved by the clock (play mode); in the editor the effects stand in for them. */
export function timeLightsApplied(): boolean {
    return current ? current.lightsApplied : false;
}

function value(effect: BlendedEffect, type: string, name: string, fallback = 0): number {
    const set = effect.uniforms.get(name);
    if (set !== undefined) return set;
    return getEffectDef(type)?.uniforms.find((u) => u.name === name)?.defaultValue ?? fallback;
}

function scaled(c: Rgba, k: number): Rgba {
    return { r: c.r * k, g: c.g * k, b: c.b * k, a: c.a };
}

/**
 * Applies the hour to what the volumes blended: the sky takes the sun's place, the fog is lit as the day is, the exposure
 * is kept readable.
 *
 * @details In the editor the scene's lights are not moved by the clock, so the effects that follow "the scene's sun" are
 *          told where the clock's sun is instead; in play they follow the light, which the clock has moved.
 */
export function applyTimeToEffects(effects: Map<string, BlendedEffect>, state: TimeOfDayState, drive: number, lightsApplied: boolean): void {
    if (drive & TimeDrive.Sky) {
        const sky = effects.get('skyAtmosphere');
        if (sky && sky.enabled) {
            // The sky always takes the sun from the clock: the key light is the moon at night, and a sky must not draw it as the sun.
            sky.uniforms.set('u_followSun', 0);
            sky.uniforms.set('u_sunAzimuth', state.sunAzimuth);
            sky.uniforms.set('u_sunElevation', state.sunElevation);
        }
    }
    if (drive & TimeDrive.Fog) {
        const fog = effects.get('heightFog');
        if (fog && fog.enabled) {
            if (!lightsApplied) {
                fog.uniforms.set('u_followSun', 0);
                fog.uniforms.set('u_sunAzimuth', state.sunAzimuth);
                fog.uniforms.set('u_sunElevation', state.sunElevation);
                // Without the light the glow has to go with the sun on its own.
                fog.uniforms.set('u_inscatter', value(fog, 'heightFog', 'u_inscatter') * smooth(-0.05, 0.2, state.sunDir[1]));
            }
            const colour = fog.colors.get('u_fogColor')
                ?? getEffectDef('heightFog')?.colors?.find((c) => c.name === 'u_fogColor')?.defaultValue;
            if (colour) {
                const dusk: [number, number, number] = [0.95, 0.55, 0.35];
                const a = state.fogDusk;
                const toward = {
                    r: colour.r * (1 - a) + dusk[0] * a, g: colour.g * (1 - a) + dusk[1] * a, b: colour.b * (1 - a) + dusk[2] * a, a: colour.a,
                };
                // The haze at night is a little blue as well as dark: the sky it is lit by is.
                const night = 1 - state.daylight;
                const blue = { r: toward.r * (1 - 0.3 * night), g: toward.g * (1 - 0.15 * night), b: toward.b, a: toward.a };
                fog.colors.set('u_fogColor', scaled(blue, state.fogBrightness));
            }
        }
    }
    if (drive & TimeDrive.Exposure) {
        const ae = effects.get('autoExposure');
        if (ae && ae.enabled) ae.uniforms.set('u_bias', value(ae, 'autoExposure', 'u_bias') + state.exposure);
        else if (state.exposure > 1e-3) {
            const grade = effects.get('colorGrade');
            if (grade && grade.enabled) grade.uniforms.set('u_exposure', value(grade, 'colorGrade', 'u_exposure') + state.exposure * 1.5);
        }
    }
}
