// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  weather.ts
 * @brief What a weather IS — a handful of scales and levels — and how it reaches the picture.
 *
 * @details A weather is not a set of effect parameters: a project's fog density is in its own units and its sun is as
 *          bright as its author made it. A preset therefore speaks in MULTIPLIERS of what the scene already says (the sun
 *          at a quarter of its strength, the fog five times as thick) and in a few absolute levels where a number means
 *          the same everywhere (how hard it rains, how wet the ground is). The same preset then fits any scene.
 *
 *          The state is blended between two presets by a transition's progress, and applied in two places: to the lights
 *          (the component's own, in play mode only — see weatherSystem) and, after the volumes have blended, to the
 *          effects that result.
 */
import type { BlendedEffect, Rgba } from './volumeBlending';
import { getEffectDef } from './effects';

export interface WeatherState {
    /** × the directional lights' strength. */
    sun: number;
    /** × the ambient light's strength. */
    sky: number;
    /** × the directional light's colour. */
    sunTint: [number, number, number];
    /** How soft its shadows are, in suns: 1 leaves them as authored, 8 makes the source eight times wider across the
     *  sky — an overcast sky's shadows are barely there, and the ones that are fade into the ground. */
    shadowSoftness: number;
    /** × how dark the light's shadows are. */
    shadowStrength: number;
    /** × Height Fog's density. */
    fogDensity: number;
    /** The colour fog moves toward, and how far (0 = its own colour). */
    fogTint: [number, number, number];
    fogTintAmount: number;
    /** × Height Fog's sun glow and the shafts it carries. */
    fogGlow: number;
    /** × Height Fog's sky haze, capped at 1. */
    skyFog: number;
    /** × Colour Grade's saturation and contrast. */
    saturation: number;
    contrast: number;
    /** Stops added to Auto Exposure's compensation. */
    exposure: number;
    /** The rain effect's strength, and the wetness and puddles it leaves. Absolute. */
    rain: number;
    wetness: number;
    puddles: number;
    /** × Screen Space Reflections' strength. */
    ssr: number;
    /** × what baked reflection probes show, and × their colour (1 keeps it, 0 is grey): a probe was baked under
     *  whatever sky the scene had then. */
    reflection: number;
    reflectionSaturation: number;
    /** How overcast the sky is, 0 clear .. 1 grey: what Sky Atmosphere draws no sun, moon or stars through. */
    overcast: number;
    /** How loud the rain on the soundtrack is, 0..2. */
    sound: number;
    /** × the wind: how far plants sway (a Foliage material's u_windStrength). */
    wind: number;
    /** × the waves' height on every body of water, in what is drawn and in what the surface answers. */
    waves: number;
}

export type WeatherPreset = Partial<WeatherState>;

const NEUTRAL: WeatherState = {
    sun: 1, sky: 1, sunTint: [1, 1, 1], shadowSoftness: 1, shadowStrength: 1,
    fogDensity: 1, fogTint: [0.7, 0.72, 0.76], fogTintAmount: 0, fogGlow: 1, skyFog: 1,
    saturation: 1, contrast: 1, exposure: 0,
    rain: 0, wetness: 0, puddles: 0, ssr: 1,
    reflection: 1, reflectionSaturation: 1, overcast: 0, sound: 0, wind: 1, waves: 1,
};

/** The presets every project has. Their ids are the dropdown's values, so they only ever grow. */
export const WEATHER_CLEAR = 0;
export const WEATHER_MIST = 1;
export const WEATHER_OVERCAST = 2;
export const WEATHER_RAIN = 3;
export const WEATHER_STORM = 4;
/** What `target` says when there is nothing to move toward. */
export const WEATHER_NONE = -1;

const registry = new Map<number, { name: string; state: WeatherState }>();
const byName = new Map<string, number>();
let nextCustomId = 100;

function fill(preset: WeatherPreset): WeatherState {
    return {
        ...NEUTRAL, ...preset,
        sunTint: preset.sunTint ?? NEUTRAL.sunTint,
        fogTint: preset.fogTint ?? NEUTRAL.fogTint,
    };
}

function define(id: number, name: string, preset: WeatherPreset): void {
    registry.set(id, { name, state: fill(preset) });
    byName.set(name, id);
}

define(WEATHER_CLEAR, 'clear', {});
define(WEATHER_MIST, 'mist', {
    sun: 0.45, sky: 0.9, shadowSoftness: 3, shadowStrength: 0.8, fogDensity: 8, fogTint: [0.86, 0.86, 0.84], fogTintAmount: 0.7, fogGlow: 1.8, skyFog: 1.7,
    saturation: 0.86, contrast: 0.94, exposure: 0.2, wetness: 0.2, puddles: 0.1, ssr: 1.3, reflection: 0.85,
    reflectionSaturation: 0.9, overcast: 0.55, wind: 0.4, waves: 0.6,
});
define(WEATHER_OVERCAST, 'overcast', {
    sun: 0.25, sky: 0.85, sunTint: [0.9, 0.93, 1], shadowSoftness: 8, shadowStrength: 0.5, fogDensity: 3, fogTint: [0.62, 0.66, 0.72], fogTintAmount: 0.5,
    fogGlow: 0.3, skyFog: 1.4, saturation: 0.85, contrast: 0.96, exposure: 0.25, wetness: 0.1, ssr: 1.2,
    reflection: 0.7, reflectionSaturation: 0.7, overcast: 0.95, wind: 1.5, waves: 1.3,
});
define(WEATHER_RAIN, 'rain', {
    sun: 0.04, sky: 0.75, sunTint: [0.8, 0.86, 1], shadowSoftness: 10, shadowStrength: 0.3, fogDensity: 5.5, fogTint: [0.58, 0.63, 0.7], fogTintAmount: 0.8,
    fogGlow: 0, skyFog: 1.7, saturation: 0.73, contrast: 0.93, exposure: 0.45, rain: 1.1, wetness: 1, puddles: 0.6,
    ssr: 2.6, reflection: 0.55, reflectionSaturation: 0.5, overcast: 0.9, sound: 1, wind: 1.9, waves: 1.5,
});
define(WEATHER_STORM, 'storm', {
    sun: 0.02, sky: 0.5, sunTint: [0.7, 0.78, 1], shadowSoftness: 10, shadowStrength: 0.2, fogDensity: 8, fogTint: [0.4, 0.44, 0.5], fogTintAmount: 0.9,
    fogGlow: 0, skyFog: 1.8, saturation: 0.6, contrast: 0.9, exposure: 0.8, rain: 2.2, wetness: 1, puddles: 1,
    ssr: 3, reflection: 0.4, reflectionSaturation: 0.35, overcast: 1, sound: 1.6, wind: 3.2, waves: 2.4,
});

/**
 * Adds a weather of the project's own, and returns the id it answers to.
 *
 * @details A preset names only what it changes; the rest is neutral. Registering a name again replaces it, so a
 *          project can retune a built-in one. A custom id is for code (`weatherTo`, a component's `preset` value) — the
 *          Inspector's dropdown lists the built-ins.
 *
 * @beta
 */
export function registerWeatherPreset(name: string, preset: WeatherPreset): number {
    const existing = byName.get(name);
    const id = existing ?? nextCustomId++;
    define(id, name, preset);
    return id;
}

/** The id a preset answers to, or undefined. @beta */
export function weatherPresetId(name: string): number | undefined {
    return byName.get(name);
}

/** Every preset, built-in first. @beta */
export function weatherPresetNames(): string[] {
    return [...registry.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.name);
}

const ease = (t: number): number => t * t * (3 - 2 * t);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The weather `progress` of the way from one preset to another, eased so a transition starts and ends gently.
 *
 * @beta
 */
export function blendWeather(from: number, to: number, progress: number): WeatherState {
    const a = (registry.get(from) ?? registry.get(WEATHER_CLEAR)!).state;
    if (to === WEATHER_NONE || progress <= 0) return { ...a, sunTint: [...a.sunTint], fogTint: [...a.fogTint] };
    const b = (registry.get(to) ?? registry.get(WEATHER_CLEAR)!).state;
    const t = ease(Math.min(Math.max(progress, 0), 1));
    const out = {} as WeatherState;
    for (const key of Object.keys(a) as (keyof WeatherState)[]) {
        const x = a[key];
        const y = b[key];
        (out as unknown as Record<string, unknown>)[key] = Array.isArray(x)
            ? x.map((v, i) => mix(v, (y as number[])[i], t))
            : mix(x as number, y as number, t);
    }
    return out;
}

// What a Weather component drives. A bit each, so a project can take the fog from the weather and keep its own light.
export const WeatherDrive = {
    Lights: 1,
    Fog: 2,
    Rain: 4,
    Grade: 8,
    Exposure: 16,
    Reflections: 32,
    Sound: 64,
    /** The plants' sway and the waves' height. */
    Wind: 128,
    All: 255,
} as const;

/** The state the frame is under, or null when no Weather component is. Set by the weather system, read by the volumes. */
let current: { state: WeatherState; drive: number } | null = null;

export function setCurrentWeather(state: WeatherState | null, drive: number = WeatherDrive.All): void {
    current = state ? { state, drive } : null;
}

/** @beta */
export function currentWeather(): WeatherState | null {
    return current ? current.state : null;
}

/** The bits of {@link WeatherDrive} the current weather has been asked to apply. */
export function currentWeatherDrive(): number {
    return current ? current.drive : 0;
}

/** What an effect's uniform is now: the scene's word if it said one, the effect's own default if it did not. */
function value(effect: BlendedEffect, type: string, name: string, fallback = 0): number {
    const set = effect.uniforms.get(name);
    if (set !== undefined) return set;
    return getEffectDef(type)?.uniforms.find((u) => u.name === name)?.defaultValue ?? fallback;
}

function entry(effects: Map<string, BlendedEffect>, type: string): BlendedEffect {
    let e = effects.get(type);
    if (!e) {
        e = { enabled: true, uniforms: new Map(), textures: new Map(), colors: new Map() };
        effects.set(type, e);
    }
    return e;
}

const towards = (c: Rgba, tint: [number, number, number], amount: number): Rgba => ({
    r: c.r * (1 - amount) + tint[0] * amount,
    g: c.g * (1 - amount) + tint[1] * amount,
    b: c.b * (1 - amount) + tint[2] * amount,
    a: c.a,
});

/**
 * Applies the weather to what the volumes blended: the effects the scene authored are scaled and tinted, and the
 * ones a weather brings with it (rain, and the grade a weather implies) are added when the scene has none.
 *
 * @details Multipliers act on whatever the scene resolved — the authored density, the authored saturation — so a scene
 *          that fogs itself thinly stays thinner than one that fogs itself thickly in the same rain.
 */
export function applyWeatherToEffects(effects: Map<string, BlendedEffect>, state: WeatherState, drive: number): void {
    if (drive & WeatherDrive.Fog) {
        const fog = effects.get('heightFog');
        if (fog && fog.enabled) {
            fog.uniforms.set('u_density', value(fog, 'heightFog', 'u_density') * state.fogDensity);
            fog.uniforms.set('u_inscatter', value(fog, 'heightFog', 'u_inscatter') * state.fogGlow);
            fog.uniforms.set('u_volumetric', value(fog, 'heightFog', 'u_volumetric') * state.fogGlow);
            fog.uniforms.set('u_skyFog', Math.min(value(fog, 'heightFog', 'u_skyFog') * state.skyFog, 1));
            const colour = fog.colors.get('u_fogColor')
                ?? getEffectDef('heightFog')?.colors?.find((c) => c.name === 'u_fogColor')?.defaultValue;
            if (colour && state.fogTintAmount > 0) fog.colors.set('u_fogColor', towards(colour, state.fogTint, state.fogTintAmount));
        }
    }
    if (drive & WeatherDrive.Fog) {
        // A 2D scene's mist is an opacity, not an exponent: the weather's multiplier is taken as a root so a rain thickens it
        // without clamping straight to opaque, and it spreads as it thickens (more of the ground under it, not only denser banks).
        const mist = effects.get('mist2d');
        if (mist && mist.enabled) {
            mist.uniforms.set('u_density', Math.min(value(mist, 'mist2d', 'u_density') * Math.sqrt(state.fogDensity), 1));
            mist.uniforms.set('u_coverage', Math.min(value(mist, 'mist2d', 'u_coverage') * (1 + 0.1 * (state.fogDensity - 1)), 1));
            mist.uniforms.set('u_glow', value(mist, 'mist2d', 'u_glow') * state.fogGlow);
            const colour = mist.colors.get('u_fogColor')
                ?? getEffectDef('mist2d')?.colors?.find((c) => c.name === 'u_fogColor')?.defaultValue;
            if (colour && state.fogTintAmount > 0) mist.colors.set('u_fogColor', towards(colour, state.fogTint, state.fogTintAmount));
        }
    }
    if (drive & WeatherDrive.Fog) {
        const sky = effects.get('skyAtmosphere');
        if (sky && sky.enabled) sky.uniforms.set('u_overcast', Math.max(value(sky, 'skyAtmosphere', 'u_overcast'), state.overcast));
    }
    if (drive & WeatherDrive.Rain) {
        if (state.rain > 0.001 || state.wetness > 0.001) {
            // A rain the scene authored is a floor the weather rises above; one the weather brings is exactly its own.
            const authored = effects.has('rain');
            const rain = entry(effects, 'rain');
            const pick = (name: string, level: number): number => authored ? Math.max(value(rain, 'rain', name), level) : level;
            rain.uniforms.set('u_intensity', pick('u_intensity', state.rain));
            rain.uniforms.set('u_wetness', pick('u_wetness', state.wetness));
            rain.uniforms.set('u_puddles', pick('u_puddles', state.puddles));
        }
        const ssr = effects.get('ssr');
        if (ssr && ssr.enabled) {
            ssr.uniforms.set('u_intensity', value(ssr, 'ssr', 'u_intensity') * state.ssr);
            ssr.uniforms.set('u_wetness', Math.max(value(ssr, 'ssr', 'u_wetness'), state.wetness));
            ssr.uniforms.set('u_puddles', Math.max(value(ssr, 'ssr', 'u_puddles'), state.puddles));
        }
    }
    if (drive & WeatherDrive.Grade) {
        const neutral = Math.abs(state.saturation - 1) < 1e-3 && Math.abs(state.contrast - 1) < 1e-3;
        const grade = effects.get('colorGrade');
        if (grade && grade.enabled) {
            grade.uniforms.set('u_saturation', value(grade, 'colorGrade', 'u_saturation', 1) * state.saturation);
            grade.uniforms.set('u_contrast', value(grade, 'colorGrade', 'u_contrast', 1) * state.contrast);
        } else if (!neutral) {
            const added = entry(effects, 'colorGrade');
            added.uniforms.set('u_saturation', state.saturation);
            added.uniforms.set('u_contrast', state.contrast);
        }
    }
    if (drive & WeatherDrive.Exposure) {
        const ae = effects.get('autoExposure');
        if (ae && ae.enabled) ae.uniforms.set('u_bias', value(ae, 'autoExposure', 'u_bias') + state.exposure);
        else if (Math.abs(state.exposure) > 1e-3) {
            const grade = effects.get('colorGrade');
            if (grade && grade.enabled) grade.uniforms.set('u_exposure', value(grade, 'colorGrade', 'u_exposure') + state.exposure);
        }
    }
}
