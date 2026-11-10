// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  skyEnvironment.ts
 * @brief The Sky Atmosphere as the scene's environment: the light the sky sends down, and what a surface sees of it.
 *
 * @details With Sky Atmosphere's **Light the Scene** on, the dome the effect draws is worked out here too, on the CPU, by the
 *          same expressions (single scattering through the air, the cloud slab marched against the same noise), as a small
 *          panorama of radiance. That panorama is made into an environment the way an imported `.hdr` is (nine irradiance
 *          coefficients and a prefiltered octahedral reflection, lightmap/environmentAtlas) and handed to the frame as its sky
 *          environment, which every Ambient light that names no environment of its own then lights with: its colour and
 *          intensity scale it, as they scale an imported one.
 *
 *          The sun's disc is left out: the directional light the sky follows is the sun's direct light, and counting the disc
 *          in the environment as well would light the scene twice from it. A night sky's moon and stars are left out for
 *          the same kind of reason (they are points, and the nine coefficients cannot hold them); its glow is kept.
 *
 *          A sky that changes (a sun that moves, a weather coming in, clouds drifting) is worked out again, at most once a
 *          second, and only when what it is made from has moved by more than can be seen in its light.
 */
import { getEffectDef } from './effects';
import type { BlendedEffect } from './volumeBlending';
import { projectIrradianceSH, prefilterOctahedral, type Panorama } from '../lightmap/environmentAtlas';
import { panoramaDirection } from '../lightmap/panorama';
import { createTextureFromPixels } from '../runtime/runtimeAssets';
import { getResourceManager } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import type { ESEngineModule } from '../wasm';
import { withScratch } from '../wasm/wasmScratch';
import { log } from '../util/logger';

/** What the sky is made from: the effect's resolved parameters and the direction toward the sun. */
export interface SkyEnvironmentInput {
    /** Toward the sun, unit. */
    sun: [number, number, number];
    params: (name: string) => number;
    /** Whether the frame lights in linear space (the effect's small constant colours are authored sRGB). */
    linear: boolean;
}

// The constants of the effect's own shader (sources/atmosphere.ts): kilometres, per kilometre.
const R_E = 6360;
const R_A = 6420;
const BETA_R = [0.0058, 0.0135, 0.0331] as const;
const BETA_M = 0.021;
const H_R = 8;
const H_M = 1.2;
const SUN_I = 22;

const fract = (x: number): number => x - Math.floor(x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
const smoothstep = (a: number, b: number, x: number): number => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hash13(x: number, y: number, z: number): number {
    let px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(z * 0.1031);
    const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
    px += d; py += d; pz += d;
    return fract((px + py) * pz);
}

function vnoise(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const a = mix(hash13(ix, iy, iz), hash13(ix + 1, iy, iz), fx);
    const b = mix(hash13(ix, iy + 1, iz), hash13(ix + 1, iy + 1, iz), fx);
    const c = mix(hash13(ix, iy, iz + 1), hash13(ix + 1, iy, iz + 1), fx);
    const d = mix(hash13(ix, iy + 1, iz + 1), hash13(ix + 1, iy + 1, iz + 1), fx);
    return mix(mix(a, b, fy), mix(c, d, fy), fz);
}

/** Where a ray from o along d leaves the sphere of radius r about the planet's centre; -1 for a miss. */
function sphereExit(oy: number, dy: number, r: number): number {
    // o = (0, oy, 0): b = oy * dy, |o|^2 = oy^2.
    const b = oy * dy;
    const disc = b * b - (oy * oy - r * r);
    return disc < 0 ? -1 : -b + Math.sqrt(disc);
}

/** The air between p and the top of the atmosphere along d as (Rayleigh, Mie) optical depth, or null where the planet is in the way. */
function lightDepth(px: number, py: number, pz: number, dx: number, dy: number, dz: number): [number, number] | null {
    const b = px * dx + py * dy + pz * dz;
    const pp = px * px + py * py + pz * pz;
    const discE = b * b - (pp - R_E * R_E);
    if (discE >= 0) {
        const s = Math.sqrt(discE);
        if (-b - s > 0 && -b + s > 0) return null;
    }
    const discA = b * b - (pp - R_A * R_A);
    const len = discA < 0 ? 0 : -b + Math.sqrt(discA);
    const ds = len / 4;
    let r = 0, m = 0;
    for (let j = 0; j < 4; j++) {
        const t = ds * (j + 0.5);
        const qx = px + dx * t, qy = py + dy * t, qz = pz + dz * t;
        const h = Math.hypot(qx, qy, qz) - R_E;
        r += Math.exp(-h / H_R) * ds;
        m += Math.exp(-h / H_M) * ds;
    }
    return [r, m];
}

/** The sky's radiance along dir by single scattering (the effect's `scatter`), and the sun's light where the eye is. */
function scatter(dir: readonly number[], sun: readonly number[], alt: number, haze: number,
                 out: Float64Array, sunTrans: Float64Array): void {
    const oy = R_E + alt;
    const len = sphereExit(oy, dir[1]!, R_A);
    const N = 16;
    const ds = len / N;
    const mu = dir[0]! * sun[0]! + dir[1]! * sun[1]! + dir[2]! * sun[2]!;
    const g = 0.76;
    const phaseR = 3 / (16 * Math.PI) * (1 + mu * mu);
    const phaseM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * (1 + g * g - 2 * g * mu) ** 1.5);
    let odR = 0, odM = 0;
    let rR = 0, rG = 0, rB = 0, mR = 0, mG = 0, mB = 0;
    const kM = BETA_M * haze * 1.1;
    for (let i = 0; i < N; i++) {
        const t = ds * (i + 0.5);
        const px = dir[0]! * t, py = oy + dir[1]! * t, pz = dir[2]! * t;
        const h = Math.hypot(px, py, pz) - R_E;
        const dR = Math.exp(-h / H_R) * ds, dM = Math.exp(-h / H_M) * ds;
        odR += dR; odM += dM;
        const ol = lightDepth(px, py, pz, sun[0]!, sun[1]!, sun[2]!);
        if (!ol) continue;
        const tr = odR + ol[0], tm = odM + ol[1];
        const ar = Math.exp(-(BETA_R[0] * tr + kM * tm));
        const ag = Math.exp(-(BETA_R[1] * tr + kM * tm));
        const ab = Math.exp(-(BETA_R[2] * tr + kM * tm));
        rR += ar * dR; rG += ag * dR; rB += ab * dR;
        mR += ar * dM; mG += ag * dM; mB += ab * dM;
    }
    const st = lightDepth(0, oy, 0, sun[0]!, sun[1]!, sun[2]!);
    for (let c = 0; c < 3; c++) {
        sunTrans[c] = st ? Math.exp(-(BETA_R[c]! * st[0] + kM * st[1])) : 0;
    }
    const kMs = BETA_M * haze * phaseM;
    out[0] = (rR * BETA_R[0] * phaseR + mR * kMs) * SUN_I;
    out[1] = (rG * BETA_R[1] * phaseR + mG * kMs) * SUN_I;
    out[2] = (rB * BETA_R[2] * phaseR + mB * kMs) * SUN_I;
}

interface CloudParams {
    coverage: number; base: number; thick: number; alt: number; scale: number; softness: number; evolve: number;
    silver: number; brightness: number; driftX: number; driftZ: number;
    c2: { coverage: number; base: number; thick: number; scale: number; driftX: number; driftZ: number };
}

function cloudDensity(x: number, y: number, z: number, p: CloudParams, octaves: number): number {
    const h = clamp01((y - p.base) / p.thick);
    const shape = smoothstep(0, 0.14, h) * smoothstep(1, 0.55, h);
    if (shape <= 0) return 0;
    const k = 0.32 * p.scale;
    const qx = x * k, qy = (y * 1.8 + p.evolve) * k, qz = z * k;
    let n = vnoise(qx, qy, qz) * 0.58 + vnoise(qx * 2.13, qy * 2.13, qz * 2.13) * 0.28;
    n += octaves > 2 ? vnoise(qx * 4.7, qy * 4.7, qz * 4.7) * 0.14 : 0.07;
    let d = smoothstep(1 - p.coverage, 1 - p.coverage + p.softness, n) * shape;
    if (octaves > 2 && d > 0 && d < 0.9) d = Math.max(d - (1 - d) * vnoise(qx * 11, qy * 11, qz * 11) * 0.55, 0);
    return d;
}

function cloud2Density(x: number, y: number, z: number, p: CloudParams): number {
    const c = p.c2;
    const h = clamp01((y - c.base) / c.thick);
    const shape = smoothstep(0, 0.3, h) * smoothstep(1, 0.5, h);
    if (shape <= 0) return 0;
    const k = 0.32 * c.scale;
    const qx = x * k, qy = (y * 3 + p.evolve * 1.7) * k, qz = z * k;
    const n = vnoise(qx, qy, qz) * 0.62 + vnoise(qx * 2.31, qy * 2.31, qz * 2.31) * 0.38;
    return smoothstep(1 - c.coverage, 1 - c.coverage + 0.3, n) * shape;
}

function cloudPhase(cosS: number, silver: number): number {
    const G = 0.86;
    return 0.42 + 0.018 * silver * (1 - G * G) / (1 + G * G - 2 * G * cosS) ** 1.5;
}

/** The cloud slab along dir as colour * T + L (the effect's `cloudLayer`), with the march's jitter at its middle. */
function cloudLayer(dir: readonly number[], sun: readonly number[], dome: Float64Array, sunTrans: Float64Array,
                    nightGlow: readonly number[], overcast: number, p: CloudParams, L: Float64Array): number {
    L[0] = 0; L[1] = 0; L[2] = 0;
    let T = 1;
    const fade = smoothstep(0.01, 0.14, dir[1]!);
    const cosS = dir[0]! * sun[0]! + dir[1]! * sun[1]! + dir[2]! * sun[2]!;
    const amb = [dome[0]! * 0.7 + nightGlow[0]!, dome[1]! * 0.7 + nightGlow[1]!, dome[2]! * 0.7 + nightGlow[2]!];
    const sunL = [sunTrans[0]! * 1.2 * p.brightness, sunTrans[1]! * 1.2 * p.brightness, sunTrans[2]! * 1.2 * p.brightness];
    if (p.coverage > 0.01 && dir[1]! > 0.01) {
        const tb = Math.max(p.base - p.alt, 0) / dir[1]!;
        const tt = Math.min((p.base + p.thick - p.alt) / dir[1]!, tb + p.thick * 6);
        const STEPS = 16;
        const ds = (tt - tb) / STEPS;
        const sigma = 1.3 * (1 + overcast * 1.5);
        const phase = cloudPhase(cosS, p.silver);
        let trans = 1, lr = 0, lg = 0, lb = 0;
        for (let i = 0; i < STEPS && trans >= 0.02; i++) {
            const t = tb + (i + 0.5) * ds;
            const x = dir[0]! * t + p.driftX, y = p.alt + dir[1]! * t, z = dir[2]! * t + p.driftZ;
            const d = cloudDensity(x, y, z, p, 3);
            if (d < 0.002) continue;
            let tau = 0;
            const reach = Math.max(p.thick, 0.5) * 0.14;
            for (let k = 1; k <= 3; k++) {
                const along = reach * k * k;
                tau += cloudDensity(x + sun[0]! * along, y + sun[1]! * along, z + sun[2]! * along, p, 2) * reach * (2 * k - 1) * sigma;
            }
            const energy = (Math.exp(-tau * 1.1) + 0.25 * Math.exp(-tau * 0.25)) * mix(1, 1 - Math.exp(-(d * sigma * ds + tau) * 3), 0.5);
            const tr = Math.exp(-d * sigma * ds);
            const w = trans * (1 - tr);
            lr += w * (sunL[0]! * energy * phase * 2 + amb[0]!);
            lg += w * (sunL[1]! * energy * phase * 2 + amb[1]!);
            lb += w * (sunL[2]! * energy * phase * 2 + amb[2]!);
            trans *= tr;
        }
        T = mix(1, trans, fade);
        L[0] = lr * fade; L[1] = lg * fade; L[2] = lb * fade;
    }
    const c2 = p.c2;
    if (c2.coverage > 0.01 && dir[1]! > 0.01) {
        const tb = Math.max(c2.base - p.alt, 0) / dir[1]!;
        const tt = Math.max(c2.base + c2.thick - p.alt, 0) / dir[1]!;
        const STEPS = 6;
        const ds = (tt - tb) / STEPS;
        const sigma = 1.3 * (1 + overcast);
        const phase = cloudPhase(cosS, p.silver);
        let trans = 1, lr = 0, lg = 0, lb = 0;
        for (let i = 0; i < STEPS; i++) {
            const t = tb + (i + 0.5) * ds;
            const x = dir[0]! * t + p.driftX + c2.driftX, y = p.alt + dir[1]! * t, z = dir[2]! * t + p.driftZ + c2.driftZ;
            const d = cloud2Density(x, y, z, p);
            if (d < 0.002) continue;
            const half = c2.thick * 0.5;
            const tau = cloud2Density(x + sun[0]! * half, y + sun[1]! * half, z + sun[2]! * half, p) * half * sigma;
            const e = Math.exp(-tau) * phase * 2;
            const tr = Math.exp(-d * sigma * ds);
            const w = trans * (1 - tr);
            lr += w * (sunL[0]! * e + amb[0]!); lg += w * (sunL[1]! * e + amb[1]!); lb += w * (sunL[2]! * e + amb[2]!);
            trans *= tr;
        }
        trans = mix(1, trans, fade);
        lr *= fade; lg *= fade; lb *= fade;
        if (c2.base >= p.base) { L[0] += T * lr; L[1] += T * lg; L[2] += T * lb; }
        else { L[0] = lr + trans * L[0]!; L[1] = lg + trans * L[1]!; L[2] = lb + trans * L[2]!; }
        T *= trans;
    }
    return T;
}

/**
 * The sky the effect draws along `dir`, without the sun's disc, the moon or the stars: the dome, the glow a night keeps, the
 * clouds over it and the grey an overcast lends it. In the frame's units, before exposure.
 */
export function skyRadianceAt(dir: readonly number[], input: SkyEnvironmentInput, out: Float64Array): void {
    skyRadianceAndClouds(dir, input, out);
}

/** {@link skyRadianceAt}, answering also how much of the light behind the clouds along dir comes through them (1 = clear). */
function skyRadianceAndClouds(dir: readonly number[], input: SkyEnvironmentInput, out: Float64Array): number {
    let through = 1;
    const P = input.params;
    const sun = input.sun;
    const overcast = clamp01(P('u_overcast'));
    const haze = P('u_haze') * (1 + overcast * 2);
    const lin = (c: number): number => (input.linear ? toLinear(c) : c);

    const dy = Math.max(dir[1]!, 0.015);
    const n = Math.hypot(dir[0]!, dy, dir[2]!);
    const sdir = [dir[0]! / n, dy / n, dir[2]! / n];
    const dome = new Float64Array(3);
    const sunTrans = new Float64Array(3);
    scatter(sdir, sun, P('u_altitude'), haze, dome, sunTrans);
    const below = 1 - 0.75 * smoothstep(0, -0.3, dir[1]!);
    const k = 0.55 * P('u_intensity') * below;
    dome[0]! *= k; dome[1]! *= k; dome[2]! *= k;

    const night = 1 - smoothstep(-0.1, 0.12, sun[1]!);
    const up = (1 - Math.max(dir[1]!, 0)) ** 3;
    const glow = [mix(lin(0.003), lin(0.016), up) * night, mix(lin(0.006), lin(0.024), up) * night, mix(lin(0.02), lin(0.06), up) * night];
    for (let c = 0; c < 3; c++) dome[c]! += glow[c]!;
    out[0] = dome[0]!; out[1] = dome[1]!; out[2] = dome[2]!;

    const coverage = Math.max(P('u_clouds'), overcast * 0.95);
    if ((coverage > 0.01 || P('u_cloud2Coverage') > 0.01) && dir[1]! > 0.01) {
        const cloudNight = [lin(0.55) * 0.015 * night, lin(0.65) * 0.015 * night, lin(0.9) * 0.015 * night];
        const L = new Float64Array(3);
        const T = cloudLayer(dir, sun, dome, sunTrans, cloudNight, overcast, {
            coverage, base: P('u_cloudBase'), thick: P('u_cloudThickness'), alt: P('u_altitude'), scale: P('u_cloudScale'),
            softness: P('u_cloudSoftness'), evolve: P('u_cloudEvolve'), silver: P('u_cloudSilver'), brightness: P('u_cloudBrightness'),
            driftX: P('u_cloudDriftX'), driftZ: P('u_cloudDriftZ'),
            c2: { coverage: P('u_cloud2Coverage'), base: P('u_cloud2Base'), thick: P('u_cloud2Thickness'), scale: P('u_cloud2Scale'),
                  driftX: P('u_cloud2DriftX') - P('u_cloudDriftX'), driftZ: P('u_cloud2DriftZ') - P('u_cloudDriftZ') },
        }, L);
        for (let c = 0; c < 3; c++) out[c] = out[c]! * T + L[c]!;
        through = T;
    }
    const luma = 0.2126 * out[0]! + 0.7152 * out[1]! + 0.0722 * out[2]!;
    for (let c = 0; c < 3; c++) out[c] = mix(out[c]!, luma, overcast * 0.5);
    return through;
}

/**
 * What lights the ground under this sky, as irradiance over pi (the unit an environment's coefficients and a light's colour
 * times intensity are in): the sky's own sun — the brightness its scattering is computed from, through the air at its
 * elevation and through the clouds as much as they let through on average — and the dome above, `skyAbove`.
 */
function groundIrradiance(input: SkyEnvironmentInput, skyAbove: readonly number[], cloudsThrough: number, out: Float64Array): void {
    const P = input.params;
    const sun = input.sun;
    const dome = new Float64Array(3);
    const sunTrans = new Float64Array(3);
    scatter([0, 1, 0], sun, P('u_altitude'), P('u_haze') * (1 + clamp01(P('u_overcast')) * 2), dome, sunTrans);
    // The sun the dome was scattered from, scaled as the dome is (0.55 x Brightness), over pi, onto level ground.
    const sunOverPi = SUN_I * 0.55 * P('u_intensity') / Math.PI * Math.max(sun[1]!, 0) * cloudsThrough;
    for (let c = 0; c < 3; c++) out[c] = sunOverPi * sunTrans[c]! + skyAbove[c]!;
}

/** The sky as an equirectangular panorama of radiance, `width` by `width / 2` (panoramaDirection's mapping). */
export function skyPanorama(input: SkyEnvironmentInput, width = SKY_PANORAMA_WIDTH): Panorama {
    const height = Math.max(2, width >> 1);
    const rgb = new Float32Array(width * height * 3);
    const c = new Float64Array(3);
    // Above the horizon: the sky, and as it goes, what it gives level ground (cosine-weighted, over pi) and how much the
    // clouds let through on average (by solid angle, away from the horizon where the slab is thinnest).
    const skyAbove = [0, 0, 0];
    let through = 0, throughWeight = 0;
    const cellAngle = (2 * Math.PI / width) * (Math.PI / height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dir = panoramaDirection((x + 0.5) / width, (y + 0.5) / height);
            if (dir[1]! < 0) continue;
            const t = skyRadianceAndClouds(dir, input, c);
            const o = (y * width + x) * 3;
            rgb[o] = c[0]!; rgb[o + 1] = c[1]!; rgb[o + 2] = c[2]!;
            const solid = cellAngle * Math.sqrt(Math.max(1 - dir[1]! * dir[1]!, 0));
            for (let k = 0; k < 3; k++) skyAbove[k]! += c[k]! * dir[1]! * solid / Math.PI;
            if (dir[1]! > 0.1) { through += t * solid; throughWeight += solid; }
        }
    }
    // Below it: the ground, lit by that sun and that sky (Ground Albedo of it given back, as a matte surface does), fading
    // into the horizon's own colour toward the horizon, as distant ground does through the haze between.
    const ground = new Float64Array(3);
    groundIrradiance(input, skyAbove, throughWeight > 0 ? through / throughWeight : 1, ground);
    const albedo = clamp01(input.params('u_groundAlbedo'));
    const horizon = new Float64Array(3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dir = panoramaDirection((x + 0.5) / width, (y + 0.5) / height);
            if (dir[1]! >= 0) continue;
            const flat = Math.hypot(dir[0]!, dir[2]!) || 1;
            skyRadianceAt([dir[0]! / flat, 0, dir[2]! / flat], input, horizon);
            const t = smoothstep(0, -0.2, dir[1]!);
            const o = (y * width + x) * 3;
            for (let k = 0; k < 3; k++) rgb[o + k] = mix(horizon[k]!, albedo * ground[k]!, t);
        }
    }
    return { width, height, rgb };
}

/** Small: the light a sky sends is smooth, and its reflection on anything but a mirror is a blur of it. */
export const SKY_PANORAMA_WIDTH = 64;
export const SKY_FACE_SIZE = 32;
export const SKY_MIP_COUNT = 3;
export const SKY_MAX_RANGE = 8;

/** The parameters of a resolved Sky Atmosphere, its own default where the volume says nothing. */
export function skyParamsOf(effect: BlendedEffect): (name: string) => number {
    const def = getEffectDef('skyAtmosphere');
    return (name) => effect.uniforms.get(name) ?? def?.uniforms.find((u) => u.name === name)?.defaultValue ?? 0;
}

/** Toward the sun as the effect places it: the first directional light when it follows one, else its own azimuth and elevation. */
export function skySunOf(params: (name: string) => number, light: [number, number, number] | null): [number, number, number] {
    if (params('u_followSun') > 0.5 && light) return light;
    const az = params('u_sunAzimuth') * Math.PI / 180, el = params('u_sunElevation') * Math.PI / 180;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/**
 * What the sky is made from, rounded to what can be seen in its light: a key that changes only when the environment would.
 * The cloud drift is rounded coarsest — a drifting sky lights the ground the same from one second to the next.
 */
export function skyEnvironmentKey(input: SkyEnvironmentInput): string {
    const P = input.params;
    const r = (v: number, step: number): number => Math.round(v / step);
    const parts = [
        r(input.sun[0], 0.004), r(input.sun[1], 0.004), r(input.sun[2], 0.004),
        r(P('u_intensity'), 0.01), r(P('u_haze'), 0.02), r(P('u_overcast'), 0.01), r(P('u_altitude'), 0.05), r(P('u_groundAlbedo'), 0.01),
        r(P('u_clouds'), 0.01), r(P('u_cloudBase'), 0.02), r(P('u_cloudThickness'), 0.02), r(P('u_cloudBrightness'), 0.02),
        r(P('u_cloudScale'), 0.02), r(P('u_cloudSoftness'), 0.01), r(P('u_cloudSilver'), 0.05),
        r(P('u_cloud2Coverage'), 0.01), r(P('u_cloud2Base'), 0.05), r(P('u_cloud2Thickness'), 0.05), r(P('u_cloud2Scale'), 0.05),
        r(P('u_cloudDriftX'), 0.5), r(P('u_cloudDriftZ'), 0.5), r(P('u_cloudEvolve'), 0.25),
        input.linear ? 1 : 0,
    ];
    return parts.join(',');
}

/** A sky made into an environment: what the frame is handed, and the reflection atlas it holds. */
interface BakedSky {
    environment: number;
    texture: number;
}

interface SkyEnvironmentCore {
    HEAPF32: Float32Array;
    environment_create?(shPtr: number, specularHandle: number, faceSize: number, mipCount: number, maxRange: number, columns: number): number;
    environment_release?(environmentHandle: number): void;
    renderer_setSkyEnvironment?(environmentHandle: number): void;
}

/**
 * The sky environment the frame lights with: worked out again when the sky changes, at most once a `minInterval` seconds, and
 * let go (the frame told it has none) when no Sky Atmosphere asks to light the scene.
 */
export class SkyEnvironment {
    private baked_: BakedSky | null = null;
    private key_ = '';
    private lastBake_ = -Infinity;
    private warned_ = false;

    constructor(private readonly minInterval = 1) {}

    /** The environment handle the frame is lighting with, 0 when none. */
    get environment(): number { return this.baked_?.environment ?? 0; }

    update(module: ESEngineModule | null, input: SkyEnvironmentInput | null, now: number): void {
        const core = module as unknown as SkyEnvironmentCore | null;
        if (!core?.environment_create || !core.renderer_setSkyEnvironment) {
            if (input && !this.warned_) {
                this.warned_ = true;
                log.warn('postprocess', 'Sky Atmosphere cannot light the scene: this engine build has no sky environment');
            }
            return;
        }
        if (!input) {
            if (this.baked_) {
                core.renderer_setSkyEnvironment(0);
                this.drop(core);
                this.key_ = '';
            }
            return;
        }
        const key = skyEnvironmentKey(input);
        if (key === this.key_) return;
        // A first sky is made at once; a sky that keeps changing waits its turn.
        if (this.baked_ && now - this.lastBake_ < this.minInterval) return;
        const made = bakeSky(module, core, input);
        if (!made) return;
        core.renderer_setSkyEnvironment(made.environment);
        this.drop(core);
        this.baked_ = made;
        this.key_ = key;
        this.lastBake_ = now;
    }

    /** Lets the environment and its atlas go and tells the frame. */
    release(module: ESEngineModule | null): void {
        const core = module as unknown as SkyEnvironmentCore | null;
        if (!core) return;
        if (this.baked_) core.renderer_setSkyEnvironment?.(0);
        this.drop(core);
        this.key_ = '';
    }

    private drop(core: SkyEnvironmentCore): void {
        if (!this.baked_) return;
        core.environment_release?.(this.baked_.environment);
        getResourceManager()?.releaseTexture(this.baked_.texture);
        this.baked_ = null;
    }
}

function bakeSky(module: ESEngineModule | null, core: SkyEnvironmentCore, input: SkyEnvironmentInput): BakedSky | null {
    const panorama = skyPanorama(input);
    const irradiance = projectIrradianceSH(panorama);
    const atlas = prefilterOctahedral(panorama, SKY_FACE_SIZE, SKY_MIP_COUNT, SKY_MAX_RANGE);
    // flipY false: the atlas' rows are a layout (row 0 is mip 0), as the environment loader takes it.
    const texture = createTextureFromPixels(module, { width: atlas.width, height: atlas.height, pixels: atlas.rgba },
        TextureContent.Retained, false, { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
    if (!texture) return null;
    const environment = withScratch(core as never, (alloc: (bytes: number) => number) => {
        const shPtr = alloc(27 * 4);
        core.HEAPF32.set(irradiance, shPtr >> 2);
        return core.environment_create!(shPtr, texture, SKY_FACE_SIZE, SKY_MIP_COUNT, SKY_MAX_RANGE, 1);
    });
    if (!environment) {
        getResourceManager()?.releaseTexture(texture);
        return null;
    }
    return { environment, texture };
}
