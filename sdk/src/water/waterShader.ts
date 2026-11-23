// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  waterShader.ts
 * @brief The Water built-in shader: waves, refraction, reflection, caustics, foam.
 *
 * The shader source lives with the module that installs it, not in the core's list of built-in shaders: a package that does not install the module carries none of it.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';
import { CAUSTICS_GLSL, CAUSTIC_PARAMS, CAUSTIC_FIELD_PARAMS, WATER_ZONE_LAYER_GLSL, WATER_ZONE_LAYER_WGSL } from '../render/waterCaustics';
import { MOST_WATER_CAUSTIC_LAYERS, MOST_WATER_REFLECTION_STEPS } from '../render/qualitySettings/water';

const REFLECTION_GROWTH = 1.25;
const MOST_REFLECTION_GROWTH = 4;

export function waterReflectionGrowth(steps: number): number {
    const reach = (g: number, n: number): number => (g ** n - 1) / (g - 1);
    const want = reach(REFLECTION_GROWTH, MOST_WATER_REFLECTION_STEPS);
    if (steps >= MOST_WATER_REFLECTION_STEPS) return REFLECTION_GROWTH;
    if (steps <= 1 || reach(MOST_REFLECTION_GROWTH, steps) <= want) return MOST_REFLECTION_GROWTH;
    let lo = REFLECTION_GROWTH, hi = MOST_REFLECTION_GROWTH;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (reach(mid, steps) < want) lo = mid; else hi = mid;
    }
    return hi;
}
import { WAVE_SET, WAVE_SET_SIZE } from './waves';
import { PACK_NORMAL_GLSL } from '../render/shaderLib';

// Functions more than one of this file's shaders is written with, once each in both languages.
const WATER_ZONE_AT_GLSL = `vec4 waterZoneAt(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    ivec2 size = textureSize(u_zoneHeights, 0);
    vec2 f = clamp(uv, 0.0, 1.0) * vec2(size - 1);
    ivec2 i = min(ivec2(floor(f)), max(size - 2, ivec2(0)));
    vec2 t = f - vec2(i);
    vec4 a = texelFetch(u_zoneHeights, i, 0), b = texelFetch(u_zoneHeights, i + ivec2(1, 0), 0);
    vec4 c = texelFetch(u_zoneHeights, i + ivec2(0, 1), 0), d = texelFetch(u_zoneHeights, i + ivec2(1, 1), 0);
    vec4 ha = vec4(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    float h = mix(mix(ha.x, ha.y, t.x), mix(ha.z, ha.w, t.x), t.y);
    // The depth is stored as its square root, so the shallows (where it draws the shore) are fine: squared before blending.
    vec2 da = mix(mix(a.ba * vec2(a.b, 1.0), b.ba * vec2(b.b, 1.0), t.x), mix(c.ba * vec2(c.b, 1.0), d.ba * vec2(d.b, 1.0), t.x), t.y);
    // The weather (u_waveHeight) raises a body's waves only as far as the wind has room to: w is that share, and z is put so that
    // u_waveHeight times it is the waves' height there.
    float e = textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).r;
    vec4 zone = vec4(u_zoneHeight.x + h * u_zoneHeight.y, da.x * u_zoneRange.w, da.y * u_zoneRange.y * mix(1.0, u_waveHeight, e) / max(u_waveHeight, 1e-3), e);
    return !inside && u_oceanOn > 0.5 ? vec4(u_oceanLevel, 1e6, u_oceanWaves, 1.0) : zone;
}`;
const WATER_ZONE_AT_WGSL = `fn waterZoneAt(p : vec2f) -> vec4f {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    let size = vec2i(textureDimensions(u_zoneHeights, 0));
    let f = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(size - vec2i(1));
    let i = min(vec2i(floor(f)), max(size - vec2i(2), vec2i(0)));
    let t = f - vec2f(i);
    let a = textureLoad(u_zoneHeights, i, 0);
    let b = textureLoad(u_zoneHeights, i + vec2i(1, 0), 0);
    let c = textureLoad(u_zoneHeights, i + vec2i(0, 1), 0);
    let d = textureLoad(u_zoneHeights, i + vec2i(1, 1), 0);
    let ha = vec4f(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    let h = mix(mix(ha.x, ha.y, t.x), mix(ha.z, ha.w, t.x), t.y);
    // The depth is stored as its square root, so the shallows (where it draws the shore) are fine: squared before blending.
    let da = mix(mix(a.ba * vec2f(a.b, 1.0), b.ba * vec2f(b.b, 1.0), t.x), mix(c.ba * vec2f(c.b, 1.0), d.ba * vec2f(d.b, 1.0), t.x), t.y);
    let e = textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).r;
    if (!inside && mc.u_oceanOn > 0.5) { return vec4f(mc.u_oceanLevel, 1e6, mc.u_oceanWaves, 1.0); }
    return vec4f(mc.u_zoneHeight.x + h * mc.u_zoneHeight.y, da.x * mc.u_zoneRange.w,
                 da.y * mc.u_zoneRange.y * mix(1.0, mc.u_waveHeight, e) / max(mc.u_waveHeight, 1e-3), e);
}`;
const WATER_ZONE_FIELD_GLSL = `vec4 waterZoneField(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    vec4 f = waterZoneLayer(uv, 0.0);
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    if (!inside) return u_oceanOn > 0.5 ? vec4(1e6, 0.0, 0.0, 1.0) : vec4(-1.0, 0.0, 0.0, 0.0);
    float e = (f.r - 0.5) * 2.0;
    return vec4(e * abs(e) * u_zoneRange.x, (f.gb - 0.5) * 2.0 * u_zoneRange.z, f.a);
}`;
const WATER_ZONE_FIELD_WGSL = `fn waterZoneField(p : vec2f) -> vec4f {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let f = waterZoneLayer(uv, 0.0);
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    if (!inside) {
        if (mc.u_oceanOn > 0.5) { return vec4f(1e6, 0.0, 0.0, 1.0); }
        return vec4f(-1.0, 0.0, 0.0, 0.0);
    }
    let e = (f.r - 0.5) * 2.0;
    return vec4f(e * abs(e) * mc.u_zoneRange.x, (f.gb - vec2f(0.5)) * 2.0 * mc.u_zoneRange.z, f.a);
}`;
const WATER_ZONE_SURF_GLSL = `float waterZoneSurf(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    float e = (textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).g - 0.5) * 2.0;
    return inside ? e * abs(e) * u_zoneRange.x : u_oceanOn > 0.5 ? 1e6 : -1.0;
}`;
const WATER_ZONE_SURF_WGSL = `fn waterZoneSurf(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    let e = (textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).g - 0.5) * 2.0;
    if (inside) { return e * abs(e) * mc.u_zoneRange.x; }
    if (mc.u_oceanOn > 0.5) { return 1e6; }
    return -1.0;
}`;
const WATER_ZONE_STILL_GLSL = `float waterZoneStill(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    return textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).b;
}`;
const WATER_ZONE_STILL_WGSL = `fn waterZoneStill(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    return textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).b;
}`;
const WATER_ZONE_STEEP_GLSL = `float waterZoneSteep(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    return textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).a;
}`;
const WATER_ZONE_STEEP_WGSL = `fn waterZoneSteep(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    return textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).a;
}`;
const WATER_SURF_GLSL = `vec2 waterSurf(float phase, float shore, float height, float time) {
    if (height <= 0.0 || u_surfLength <= 0.0) return vec2(0.0);
    float reach = u_surfLength * 4.0;
    if (shore > reach || shore < -reach * 0.05) return vec2(0.0);
    float celerity = sqrt(u_waveGravity * u_surfLength / 6.2831853) * u_surfSpeed;
    float u = fract(phase / u_surfLength + celerity * time / u_surfLength);
    float g = u > 0.8 ? smoothstep(0.0, 1.0, (u - 0.8) / 0.2) : 1.0 - smoothstep(0.0, 1.0, u / 0.8);
    float shoal = 1.0 - smoothstep(0.0, 1.0, (shore - reach * 0.25) / (reach * 0.75));
    float runUp = shore >= 0.0 ? 1.0 : 1.0 - smoothstep(0.0, 1.0, -shore / (reach * 0.05));
    float env = shoal * runUp;
    // It breaks in the inner third: the crest whitens, and the water behind it stays white a while.
    float breaking = 1.0 - smoothstep(reach * 0.15, reach * 0.4, shore);
    // A wave breaks only when it is steep for its length: a lake's small surf laps, the sea's breaks white.
    float steep = smoothstep(0.012, 0.045, height / u_surfLength);
    float white = breaking * steep * max(smoothstep(0.75, 1.0, g), (1.0 - smoothstep(0.0, 0.35, u)) * 0.8) * env;
    float swash = (1.0 - smoothstep(0.0, 0.18 * u_surfLength, shore)) * (1.0 - smoothstep(0.22, 0.65, u));
    return vec2(height * g * g * env, max(white, swash * steep * env * 0.74));
}`;
const WATER_SURF_WGSL = `fn waterSurf(phase : f32, shore : f32, height : f32, time : f32) -> vec2f {
    if (height <= 0.0 || mc.u_surfLength <= 0.0) { return vec2f(0.0); }
    let reach = mc.u_surfLength * 4.0;
    if (shore > reach || shore < -reach * 0.05) { return vec2f(0.0); }
    let celerity = sqrt(mc.u_waveGravity * mc.u_surfLength / 6.2831853) * mc.u_surfSpeed;
    let u = fract(phase / mc.u_surfLength + celerity * time / mc.u_surfLength);
    var g = 1.0 - smoothstep(0.0, 1.0, u / 0.8);
    if (u > 0.8) { g = smoothstep(0.0, 1.0, (u - 0.8) / 0.2); }
    let shoal = 1.0 - smoothstep(0.0, 1.0, (shore - reach * 0.25) / (reach * 0.75));
    var runUp = 1.0;
    if (shore < 0.0) { runUp = 1.0 - smoothstep(0.0, 1.0, -shore / (reach * 0.05)); }
    let env = shoal * runUp;
    let breaking = 1.0 - smoothstep(reach * 0.15, reach * 0.4, shore);
    let steep = smoothstep(0.012, 0.045, height / mc.u_surfLength);
    let white = breaking * steep * max(smoothstep(0.75, 1.0, g), (1.0 - smoothstep(0.0, 0.35, u)) * 0.8) * env;
    let swash = (1.0 - smoothstep(0.0, 0.18 * mc.u_surfLength, shore)) * (1.0 - smoothstep(0.22, 0.65, u));
    return vec2f(height * g * g * env, max(white, swash * steep * env * 0.74));
}`;
const WATER_BEND_GLSL = `vec4 waterBend(vec2 p, float span) {
    vec2 q = p / span;
    return vec4(p.x + span * 0.45 * sin(q.y * 0.73 + 1.3), p.y + span * 0.45 * sin(q.x * 0.61 + 2.7),
                0.3285 * cos(q.y * 0.73 + 1.3), 0.2745 * cos(q.x * 0.61 + 2.7));
}`;
const WATER_BEND_WGSL = `fn waterBend(p : vec2f, span : f32) -> vec4f {
    let q = p / span;
    return vec4f(p.x + span * 0.45 * sin(q.y * 0.73 + 1.3), p.y + span * 0.45 * sin(q.x * 0.61 + 2.7),
                 0.3285 * cos(q.y * 0.73 + 1.3), 0.2745 * cos(q.x * 0.61 + 2.7));
}`;

// The waves, written into the shader from the one table the CPU sums (waves.ts).
const num = (v: number): string => v.toFixed(6);
const WAVE_ROWS = WAVE_SET.map(([heading, length, height, speed]) => `(${num(heading)}, ${num(length)}, ${num(height)}, ${num(speed)})`);
const WAVES_GLSL = `const vec4 SET[${WAVE_SET_SIZE}] = vec4[${WAVE_SET_SIZE}](${WAVE_ROWS.map((r) => `vec4${r}`).join(', ')});`;
const WAVES_WGSL = `var wave = array<vec4f, ${WAVE_SET_SIZE}>(${WAVE_ROWS.map((r) => `vec4f${r}`).join(', ')});`;
/** One wave's arguments to `peakedWave`: its turn off the wind, its frequency and its speed as multiples of the longest's, its share of the height. */
const waveArgs = ([heading, length, height, speed]: readonly [number, number, number, number]): string => {
    const a = heading * Math.PI / 180;
    return `${num(Math.cos(a))}, ${num(Math.sin(a))}, ${num(1 / length)}, ${num(speed / Math.sqrt(length))}, ${num(height)}`;
};
const SLOPES_GLSL = WAVE_SET.map((w, i) => i === 0
    ? `    vec3 sum = peakedWave(bend.xy, along, k, run, far, ${waveArgs(w)});\n    float weightSum = ${num(w[2])};`
    : `    if (u_waveCount > ${i}.5) { sum += peakedWave(bend.xy, along, k, run, far, ${waveArgs(w)}); weightSum += ${num(w[2])}; }`).join('\n');

const WAVE_HEIGHT = `float waterWaveHeight(vec2 p, float time, float cell) {
    vec2 at = waterBend(p, u_waveLength).xy;
    ${WAVES_GLSL}
    float height = 0.0;
    float base = radians(u_waveDirection);
    for (int i = 0; i < ${WAVE_SET_SIZE}; ++i) {
        if (float(i) >= u_waveCount) break;
        float length_ = u_waveLength * SET[i].y;
        float k = 6.2831853 / length_;
        float a = base + radians(SET[i].x);
        vec2 d = vec2(sin(a), cos(a));
        float omega = sqrt(u_waveGravity * k) * u_waveSpeed * SET[i].w;
        float fade = cell > 0.0 ? clamp((length_ / cell - 3.0) / 3.0, 0.0, 1.0) : 1.0;
        height += u_waveHeight * SET[i].z * exp(sin(k * dot(d, at) - omega * time) - 1.0) * fade;
    }
    return height;
}`;

const SURFACE_WAVES = `float waterHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float waterNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
               mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/// The slope of the ripples the wind raises at p: three reads of the ripple map (u_detailMap: the engine's own, default(ripples), unless a material
/// gives another) at sizes that share no multiple, each carried its own way downwind, so no one size's repeat shows; and gusts, slow patches where
/// the wind ruffles the water and slicks where it does not (u_rippleGusts). px is how far p moves a pixel right and up: the map's mips flatten what a pixel cannot hold.
vec2 rippleSlope(vec2 p, float time, vec4 px) {
    float base = radians(u_waveDirection);
    float turn = radians(u_rippleTurn);
    vec2 along = vec2(sin(base), cos(base));
    vec2 aside = vec2(sin(base + turn), cos(base + turn));
    float tile = u_rippleLength * u_rippleTile;
    float fine = tile * u_rippleFineSize;
    float wide = tile * u_rippleWideSize;
    // Each layer is carried at the speed deep water gives the waves it mostly holds, a quarter of its repeat long.
    vec3 run = sqrt(u_waveGravity * vec3(tile, fine, wide) / 25.1327412) * (u_waveSpeed * time);
    vec2 a = textureGrad(u_detailMap, (p - along * run.x) / tile, px.xy / tile, px.zw / tile).rg * 2.0 - 1.0;
    vec2 b = textureGrad(u_detailMap, (p.yx - aside.yx * run.y) / fine + 0.4, px.yx / fine, px.wz / fine).ba * 2.0 - 1.0;
    vec2 c = textureGrad(u_detailMap, (p + aside * run.z) / wide + 0.7, px.xy / wide, px.zw / wide).ba * 2.0 - 1.0;
    vec2 slope = a / sqrt(max(1.0 - dot(a, a), 0.0625)) * u_rippleWeight + (b / sqrt(max(1.0 - dot(b, b), 0.0625))).yx * u_rippleFineWeight
        + c / sqrt(max(1.0 - dot(c, c), 0.0625)) * u_rippleWideWeight;
    float paws = waterNoise(p / u_gustSize + along * (time * 0.11)) * 0.6 + waterNoise(p / (u_gustSize * 3.4) - aside * (time * 0.03)) * 0.4;
    float gust = mix(1.0, mix(u_gustCalm, u_gustRuffle, smoothstep(0.3, 0.7, paws)), u_rippleGusts);
    return slope * (u_rippleStrength * gust);
}

/// The slope rain adds at p: in every cell of two offset grids a third of u_rippleLength across, a drop lands at a place and a moment of
/// its own once a cycle, and a ring runs out from it and dies away. Harder rain wets more of the cells. No foam: a raindrop makes none.
vec2 rainRings(vec2 p, float time, float rain) {
    vec2 slope = vec2(0.0);
    if (rain <= 0.0) return slope;
    float cellSize = u_rippleLength * 0.35;
    const float K = 52.0;
    for (int layer = 0; layer < 2; layer++) {
        vec2 q = p / cellSize + float(layer) * vec2(0.37, 0.71);
        vec2 cell = floor(q) + float(layer) * 113.0;
        float h = waterHash(cell);
        float rate = 0.8 + 0.5 * h;
        float cycle = time * rate + h * 7.31;
        vec2 drop = cell + floor(cycle) * vec2(17.0, 31.0);
        if (waterHash(drop + 0.5) > clamp(rain * 0.4, 0.0, 0.9)) continue;
        float t = fract(cycle);
        vec2 centre = floor(q) + 0.25 + 0.5 * vec2(waterHash(drop + 3.1), waterHash(drop + 5.7));
        vec2 d = q - centre;
        float r = max(length(d), 1e-4);
        float x = r - t * 0.45;
        float env = (1.0 - t) * (1.0 - t) * exp(-x * x * 900.0);
        float dh = (cos(x * K) - x * 1800.0 / K * sin(x * K)) * env;
        slope += d / r * dh * 0.3;
    }
    return slope;
}

/// The slope of the water's surface at p (d height / d x, d height / d z) and how near the waves are to a crest, 0 to 1.
/// The set's waves, each a peaked sine (exp(sin - 1)) whose crests are narrower than its troughs.
// One of them: xy its slope, without its height; z its crest.
vec3 peakedWave(vec2 at, vec2 along, float k, float run, float far, float turnCos, float turnSin, float perLength, float perRun, float share) {
    vec2 d = vec2(along.x * turnCos + along.y * turnSin, along.y * turnCos - along.x * turnSin);
    float theta = k * perLength * dot(d, at) - run * perRun;
    float e = exp(sin(theta) - 1.0);
    // A wave much shorter than a pixel is noise, not a wave: it fades out with distance.
    return vec3(d * (share * e * cos(theta) * k * perLength * clamp(1.0 - far * perLength, 0.0, 1.0)), e * share);
}
vec2 waveSlope(vec2 p, float time, float dist, out float crest) {
    float base = radians(u_waveDirection);
    vec2 along = vec2(sin(base), cos(base));
    vec4 bend = waterBend(p, u_waveLength);
    float k = 6.2831853 / u_waveLength;
    float run = sqrt(u_waveGravity * k) * u_waveSpeed * time;
    float far = dist / (u_waveLength * 220.0);
${SLOPES_GLSL}
    vec2 slope = sum.xy * u_waveHeight;
    crest = sum.z / weightSum;
    return vec2(slope.x + slope.y * bend.w, slope.y + slope.x * bend.z);
}

/// The slope the two detail normal maps add at p: each read at its own tile and drift, its z made from its x and z, mips flattening
/// what a pixel is too far to see. Fragment only: a vertex cannot take the derivatives a map is read with.
vec2 detailSlope(vec2 p, float time) {
    vec2 slope = vec2(0.0);
    if (u_detailStrength0 > 0.0) {
        vec2 n = texture(u_detailMap, (p + u_detailFlow0 * time) / u_detailTile0).rg * 2.0 - 1.0;
        slope += n / sqrt(max(1.0 - dot(n, n), 0.0625)) * u_detailStrength0;
    }
    if (u_detailStrength1 > 0.0) {
        vec2 n = texture(u_detailMap, (p + u_detailFlow1 * time) / u_detailTile1).ba * 2.0 - 1.0;
        slope += n / sqrt(max(1.0 - dot(n, n), 0.0625)) * u_detailStrength1;
    }
    return slope;
}

/// The slope of the surface at p and how near it is to a crest: the waves, amp times as high as u_waveHeight says, and the ripples they carry,
/// calm of their strength, flattened with distance.
vec2 waterSurface(vec2 p, float time, float dist, vec4 px, float amp, float calm, out float crest) {
    vec2 slope = waveSlope(p, time, dist, crest) * amp;
    crest *= calm;
    return slope + rippleSlope(p, time, px) * calm;
}`;

const ZONE_SAMPLE = `    vec2 zoneUv = (wp - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    bool zoneIn = all(greaterThanEqual(zoneUv, vec2(0.0))) && all(lessThanEqual(zoneUv, vec2(1.0)));
    bool zoneOn = u_zoneOn > 0.5 && u_waveSpace > 0.5;
    bool zoneRead = zoneOn && (zoneIn || u_oceanOn < 0.5);
    vec4 zoneTex = vec4(0.5, 0.5, 0.5, 1.0);
    vec4 zone = vec4(u_oceanLevel, 1e6, u_oceanWaves, 1.0);
    if (zoneRead) {
        zoneTex = waterZoneLayer(zoneUv, 0.0);
        zone = waterZoneAt(wp);
    }
    float shoreE = (zoneTex.r - 0.5) * 2.0;
    float shoreDist = !zoneOn ? 1e6 : zoneIn ? shoreE * abs(shoreE) * u_zoneRange.x : u_oceanOn > 0.5 ? 1e6 : -1.0;
    float shoreDepth = zoneOn ? zone.y : 1e6;
    // How high the waves stand (a multiple of u_waveHeight), and the share of them kept toward the shore, which calms the small ripples and the crests too.
    float calm = !zoneOn ? 1.0 : zoneIn ? zoneTex.a : 1.0;
    float damp = zoneOn ? zone.z * calm : 1.0;
    vec2 flow = zoneOn && zoneIn ? (zoneTex.gb - 0.5) * 2.0 * u_zoneRange.z : vec2(0.0);`;

const SURFACE_SLOPE = `vec2 surfaceSlope(vec2 wp, float time, float waterDist, vec4 px, vec4 zone, bool zoneOn, bool zoneRead, float shoreDist, vec2 flow,
                  float damp, float calm, float surfStep, out float crest, out float ripFoam, out vec2 surf, out vec2 toSea) {
    // The surf: its height across the shore distance gives its slope along the way to the shore, and where it breaks it is white.
    float still = zoneRead ? waterZoneStill(wp) : 1.0;
    float surfH = zoneOn ? u_surfHeight * u_waveHeight * zone.z * zone.w * still : 0.0;
    toSea = vec2(0.0);
    surf = vec2(0.0);
    float surfRise = 0.0;
    // The surf's reach (waterSurf), a step wider for the two reads of its rise: further from the shore it is nothing, and takes no reads to say so.
    float surfReach = u_surfLength * 4.0;
    if (zoneRead && surfH > 0.0 && u_surfLength > 0.0 && shoreDist <= surfReach + surfStep && shoreDist >= -surfReach * 0.05 - surfStep) {
        float surfDist = waterZoneSurf(wp);
        toSea = vec2(waterZoneSurf(wp + vec2(surfStep, 0.0)) - waterZoneSurf(wp - vec2(surfStep, 0.0)),
                     waterZoneSurf(wp + vec2(0.0, surfStep)) - waterZoneSurf(wp - vec2(0.0, surfStep))) / (2.0 * surfStep);
        // A distance to the shore climbs one unit a unit everywhere but on the ridge between two shores, where it turns back: there the way to
        // the shore is no one way, and the surf's slope fades out rather than flipping on a line.
        toSea *= smoothstep(0.55, 0.9, length(toSea));
        surf = waterSurf(surfDist, shoreDist, surfH, time);
        surfRise = (waterSurf(surfDist + surfStep * 0.5, shoreDist + surfStep * 0.5, surfH, time).x
                  - waterSurf(surfDist - surfStep * 0.5, shoreDist - surfStep * 0.5, surfH, time).x) / surfStep;
    }
    // The ripples at this pixel: their height on four sides gives the slope they add, and the foam is what they left.
    vec2 ripUv = (wp - u_rippleOrigin) / max(u_rippleSize, 1e-4);
    bool ripIn = u_rippleOn > 0.5 && u_waveSpace > 0.5 && all(greaterThanEqual(ripUv, vec2(0.0))) && all(lessThanEqual(ripUv, vec2(1.0)));
    vec2 ripSlope = vec2(0.0);
    ripFoam = 0.0;
    if (ripIn) {
        float ripCell = max(u_rippleSize * u_rippleTexel, 1e-5);
        float ripL = textureLod(u_rippleMap, ripUv - vec2(u_rippleTexel, 0.0), 0.0).r, ripR = textureLod(u_rippleMap, ripUv + vec2(u_rippleTexel, 0.0), 0.0).r;
        float ripD = textureLod(u_rippleMap, ripUv - vec2(0.0, u_rippleTexel), 0.0).r, ripU = textureLod(u_rippleMap, ripUv + vec2(0.0, u_rippleTexel), 0.0).r;
        // The window follows the camera: its edge fades out, so where it ends the ripples thin away instead of stopping on a line.
        vec2 ripEdge = min(ripUv, 1.0 - ripUv);
        float ripFade = smoothstep(0.0, 0.15, min(ripEdge.x, ripEdge.y));
        ripSlope = vec2(ripR - ripL, ripU - ripD) * u_rippleRange / ripCell * ripFade;
        ripFoam = textureLod(u_rippleMap, ripUv, 0.0).g * ripFade;
    }
    vec2 slope;
    if (dot(flow, flow) > 1e-6) {
        // A current: the surface rides it. Two copies of it are carried downstream a cycle at a time, each fading in as the other fades
        // out, so the moment one is put back at its start is hidden by the other.
        float cycle = max(u_flowCycle, 0.1);
        float ph0 = fract(time / cycle);
        float ph1 = fract(time / cycle + 0.5);
        float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
        float crest0, crest1;
        // Named copy0/copy1 because a t or s followed by a number is a texture unit's name (ShaderParser::materialOverflowUnits).
        vec2 copy0 = waterSurface(wp - flow * (ph0 * cycle), time, waterDist, px, damp, calm, crest0);
        vec2 copy1 = waterSurface(wp - flow * (ph1 * cycle), time, waterDist, px, damp, calm, crest1);
        slope = mix(copy1, copy0, w0);
        crest = mix(crest1, crest0, w0);
    } else {
        slope = waterSurface(wp, time, waterDist, px, damp, calm, crest);
    }
    // Rain rings are fine: where a pixel grows past a ring's crests they would shimmer, so they fade out before it.
    float rainFade = 1.0 - smoothstep(u_rippleLength * 8.0, u_rippleLength * 20.0, waterDist);
    slope += ripSlope + toSea * (surfRise * u_geoWaves) + rainRings(wp, time, u_rain) * rainFade + detailSlope(wp, time) * calm;
    return slope;
}`;

// A horizontal body of water: waves that travel, the scene seen through it bent and tinted by how much water lies in front of it, the sky
// and the lights reflected off it, and foam where it meets what it lies on and on the crests. It reads the picture of the opaque scene
// behind it and how far each pixel of that is from the eye, which the frame takes before it draws a material that declares them, so
// the depth of the water at a pixel is what is measured, not a number the author guessed. Where the device cannot hold the distances
// (no float target) it falls back to `u_fallbackDepth` as the depth everywhere.
/** How much of the light a world unit of water takes out (times each colour's absorption), at the engine's reference of 100 units a
 *  metre: 0.12 a metre, clear sea water. What the Water shader's `u_density` defaults to, and what a reader of it falls back to. */
export const WATER_DENSITY = 0.0012;

const WATER = `#pragma shader "Water"
#pragma version 300 es
#pragma domain Lit
#pragma lighting direct
// The colour the water scatters back: lighter where it is shallow, darker where it is deep.
#pragma param u_shallowColor color default(0.10,0.42,0.46,1)
#pragma param u_deepColor color default(0.01,0.08,0.15,1)
// How fast each colour is absorbed along the way through the water (red goes first), and how thick the water is, per world unit.
#pragma param u_absorption color default(0.45,0.09,0.05,1)
#pragma param u_density float default(${WATER_DENSITY}) range(0,0.04) ui(slider) unit(perLength)
// How soon the water's own colour turns from the shallow one to the deep one, as a share of the density: lower keeps a lagoon its shallow colour over deeper water.
#pragma param u_deepening float default(0.5) range(0,4) ui(slider)
// How much the bed is dimmed by the water its light came down through, as well as by the water it is seen through: 1 is what water does
// (a bed ten metres down is lit by what ten metres let through), 0 lights it as if it were dry.
#pragma param u_bedShade float default(1) range(0,1) ui(slider)
// The waves: height, length of the longest, how sharp their crests are drawn, how fast they travel and which way (degrees).
#pragma param u_waveHeight float default(30) range(0,800) ui(slider) unit(length)
#pragma param u_waveLength float default(1400) range(50,30000) ui(slider) unit(length)
#pragma param u_waveGravity float default(980) unit(length)
#pragma param u_waveSpeed float default(1) range(0,4) ui(slider)
#pragma param u_waveDirection float default(30) range(0,360) ui(slider)
// The small ripples the long waves carry: how steep and how long each is.
#pragma param u_rippleStrength float default(0.3) range(0,1) ui(slider)
#pragma param u_rippleLength float default(250) range(10,4000) ui(slider) unit(length)
// The ripples' three layers: the map's repeat in ripple lengths, the fine and the wide layer's size as shares of it, each layer's weight, and how far
// off the wind (degrees) the fine and the wide one run. Then the gusts: how much of them, what a slick and a ruffled patch multiply the ripples by, a patch's size.
#pragma param u_rippleTile float default(9) range(1,64) ui(slider)
#pragma param u_rippleFineSize float default(0.317) range(0.05,1) ui(slider)
#pragma param u_rippleWideSize float default(2.65) range(1,16) ui(slider)
#pragma param u_rippleWeight float default(1.26) range(0,4) ui(slider)
#pragma param u_rippleFineWeight float default(0.84) range(0,4) ui(slider)
#pragma param u_rippleWideWeight float default(0.98) range(0,4) ui(slider)
#pragma param u_rippleTurn float default(25) range(0,90) ui(slider)
#pragma param u_rippleGusts float default(0.6) range(0,1) ui(slider)
#pragma param u_gustCalm float default(0.35) range(0,1) ui(slider)
#pragma param u_gustRuffle float default(1.45) range(1,3) ui(slider)
#pragma param u_gustSize float default(2200) range(100,100000) ui(slider) unit(length)
// How much the ripples shade the water's own colour (1: wholly, as a painted surface; 0: not at all, as light from under one), and what the surface
// mirrors seen straight on (water's 0.0204).
#pragma param u_bodyShading float default(0.25) range(0,1) ui(slider)
#pragma param u_reflectance float default(0.0204) range(0,0.2) ui(slider)
// How hard it rains on the water (the weather writes it): drops ring out on the surface, a few to every u_rippleLength.
#pragma param u_rain float default(0) range(0,4) ui(slider)
#pragma param u_roughness float default(0.04) range(0,1) ui(slider)
// How far what is seen through the water is shifted by its waves, and the depth of water at which that stops growing.
#pragma param u_refractionStrength float default(1) range(0,4) ui(slider)
#pragma param u_distortionRange float default(1200) range(10,20000) ui(slider) unit(length)
// Foam: its colour, how deep the water is where it begins at the shore (world units), and how much of the wave crests carry it.
// Sunlight through the thin top of a wave toward an eye looking into the sun: the crest glows in the shallow colour. 0 draws none.
#pragma param u_crestScatter float default(1) range(0,4) ui(slider)
#pragma param u_foamColor color default(0.95,0.97,1,1)
#pragma param u_foamWidth float default(120) range(0,2000) ui(slider) unit(length)
#pragma param u_foamCrest float default(0.5) range(0,1) ui(slider)
// How deep, in world units, the water is where it has thinned to nothing at its edge: over that last depth the ground behind shows through
// more and more, so the water meets it along a soft line. 0 keeps a hard edge.
#pragma param u_edgeSoftness float default(30) range(0,100000) ui(slider) unit(length)
// The depth taken where the device could not measure one.
#pragma param u_fallbackDepth float default(400) range(0,20000) ui(slider) unit(length)
// Where the waves are measured. 0 is the world's xz plane, which is what a plain mesh of water wants. 1 is the surface a WaterZone draws: the mesh's uv
// is its x and z (plus u_origin, which the zone moves as the mesh follows the camera, so the waves stay put in the world), and the vertices are lifted
// to the zone's water and its waves.
#pragma param u_waveSpace float default(0) range(0,1) ui(slider)
#pragma param u_origin vec2 default(0,0)
// The cell size of the mesh's finest ring: a vertex in a coarser ring (its colour's red says which) fades the waves it cannot draw, those shorter
// than six of its cells. 0 draws every wave at every vertex.
#pragma param u_cellSize float default(0) range(0,100) ui(slider)
// A WaterZone's baked water (zone.ts encode): heights texel by texel (rg height over u_zoneHeight, b depth, a waves' height), field filtered
// (r shore distance, 0.5 at it, as a signed square root so it is fine near the shore; gb current; a calm share), over u_zoneRange (shore, waves, current, depth). Below the shore there is no
// water; past the region there is the ocean where u_oceanOn says so.
#pragma param u_zoneOn float default(0) range(0,1) ui(slider)
#pragma param u_zoneHeights texture default(white) texel(data)
#pragma param u_zoneSurfaceData texture default(white) texel(data)
// How open each place's water is to the wind (its fetch), 0 to 1: the weather raises the waves that much of the way. The sea is open.
#pragma param u_zoneExposure texture default(white) texel(data)
#pragma param u_zoneOrigin vec2 default(0,0)
#pragma param u_zoneSize vec2 default(1,1)
#pragma param u_zoneHeight vec2 default(0,1)
#pragma param u_zoneRange vec4 default(16,1,1,16)
#pragma param u_oceanOn float default(0) range(0,1) ui(slider)
#pragma param u_oceanLevel float default(0) range(-100000,100000) ui(slider)
#pragma param u_oceanWaves float default(1) range(0,100) ui(slider)
// Each body's own colour where it has one (rgb times its share, alpha one less the share), filtered, so bodies blend where they meet;
// past the region the ocean's own (rgb, a its share: 0 for none).
#pragma param u_oceanLook vec4 default(0,0,0,0)
// The surf (the WaterZone writes these): how high a breaker stands against its body's waves (with the weather in), how long the surf's waves
// are, and a multiplier on their speed. 0 draws none.
#pragma param u_surfHeight float default(0) range(0,4) ui(slider)
#pragma param u_surfLength float default(1000) range(10,10000000) ui(slider) unit(length)
#pragma param u_surfSpeed float default(1) range(0,4) ui(slider)
// How long, in seconds, each of the two copies of the surface the shader carries down a current lives before the other takes over.
#pragma param u_flowCycle float default(2) range(0.2,20) ui(slider)
// How much of the waves lifts the geometry: 0 draws the surface flat and moves it only in the shading (the lite water).
#pragma param u_tileMorph vec4 default(0,1,0,0)
#pragma param u_tileEye vec2 default(0,0)
#pragma param u_waterMeshView float default(0)
#pragma param u_farSurface float default(0)
#pragma param u_geoWaves float default(1) range(0,1) ui(slider)
// The net of light the waves throw on what is under the water: how strong it is, how large one cell of it is (world units), and how fast it swims. The Underwater
// effect draws the same one from below, with these numbers, so the two halves of the picture agree.
${CAUSTIC_PARAMS}
// What the quality level allows (the WaterZone writes these): how many of the four waves are summed, whether the surface seen from below mirrors the world under it,
// and whether the sun's web of light is drawn on what lies under the water.
#pragma param u_waveCount float default(${WAVE_SET_SIZE}) range(1,${WAVE_SET_SIZE}) ui(slider)
#pragma param u_mirror float default(1) range(0,1) ui(slider)
#pragma param u_causticOn float default(1) range(0,1) ui(slider)
#pragma param u_reflectSteps float default(${MOST_WATER_REFLECTION_STEPS}) range(1,${MOST_WATER_REFLECTION_STEPS}) ui(slider)
#pragma param u_reflectGrowth float default(${REFLECTION_GROWTH}) range(1,${MOST_REFLECTION_GROWTH}) ui(slider)
#pragma param u_causticLayers float default(${MOST_WATER_CAUSTIC_LAYERS}) range(1,${MOST_WATER_CAUSTIC_LAYERS}) ui(slider)
// The disturbance the water keeps (WaterZone ripples): a window of the xz plane, red the height of the ripples (0.5 at rest, u_rippleRange above or below at 1 and 0)
// and green the foam they left, as the CPU stepped them. u_rippleSize is the window's side, u_rippleTexel one texel of it.
#pragma param u_rippleOn float default(0) range(0,1) ui(slider)
// Two tiled normal maps that scroll over the surface, for the sparkle the sun makes of a water's small slopes, in the one texture a material has room
// for: red and green the first's slope (x and z, 0.5 flat), blue and alpha the second's, read as data. Each is u_detailTile world units to a repeat,
// u_detailStrength times as steep as drawn (0 leaves it out), and slides u_detailFlow world units a second.
#pragma param u_detailMap texture default(ripples) texel(data)
#pragma param u_detailTile0 float default(2) range(0.01,100000) ui(slider)
#pragma param u_detailTile1 float default(4.3) range(0.01,100000) ui(slider)
#pragma param u_detailStrength0 float default(0) range(0,8) ui(slider)
#pragma param u_detailStrength1 float default(0) range(0,8) ui(slider)
#pragma param u_detailFlow0 vec2 default(0.05,0.02)
#pragma param u_detailFlow1 vec2 default(-0.03,0.04)
#pragma param u_rippleMap texture default(white) texel(data)
#pragma param u_rippleOrigin vec2 default(0,0)
#pragma param u_rippleSize float default(64) range(0.01,100000) ui(slider)
#pragma param u_rippleTexel float default(0.0156) range(0,1) ui(slider)
#pragma param u_rippleRange float default(1) range(0.0001,1000) ui(slider)
#pragma param u_sceneColor texture default(white)
#pragma param u_sceneDepthMap texture default(white) texel(data)
// What the foam is made of: a tiled texture whose red says how much foam a texel holds where foam is wanted (bubbles, threads, a web),
// u_foamTile world units to a repeat, sliding u_foamFlow world units a second. Read as coverage, so the foam the shore, crests and ripples
// ask for thins out through the texture's own pattern instead of dimming evenly; the default white keeps the foam exactly as computed.
// Declared after every other texture, on purpose: the material units above it were full, and this one takes a unit the water never reads.
#pragma param u_foamMap texture default(white) texel(data)
#pragma param u_foamTile float default(3) range(0.01,100000) ui(slider)
#pragma param u_foamFlow vec2 default(0.04,0.03)

${CAUSTIC_FIELD_PARAMS}

#pragma vertexbounds 16
#pragma vertexoffset
// Where the waves are read for the true place p, bent by the given span (waves.ts: waveBend): crests of straight sines a few directions apart
// add up to long parallel lines, a sea scored with strokes that turn with the wind. xy to read at; zw dx/dz and dz/dx, for a slope. One
// sine an axis: this runs for every pixel of the water, and with a term more a phone paid 11 ms a frame for it.
${WATER_ZONE_LAYER_GLSL}
${WATER_BEND_GLSL}
${WAVE_HEIGHT}
// The zone's water at p: its surface's height, its depth and how high its waves stand, each texel decoded before the four about p are blended
// (bytes blended are no number). Past the region: the ocean's, where there is one.
${WATER_ZONE_AT_GLSL}
// The zone's field at p, decoded: the shore distance, the current, and the share of its waves a place keeps. Past the region: the ocean's.
${WATER_ZONE_FIELD_GLSL}
// The distance the surf runs in by at p: the shore's with a river's water taken for land and smoothed over the surf's length, so the crests
// come in as lines that turn to the shore as they near it and run straight across a river's mouth. Past the region: the ocean's.
${WATER_ZONE_SURF_GLSL}
// How much of the surf a current leaves at p: none in a river, and more and more of it away from where the river runs out into open water.
${WATER_ZONE_STILL_GLSL}
// How steep the shore is at p: 0 a gentle beach (waves wash up it), 1 rock or a cliff (they burst white on it).
${WATER_ZONE_STEEP_GLSL}
// The surf (waves.ts surfHeight): its crests are lines of phase (the distance the surf runs in by), and it rises, breaks and runs up by
// shore, the real distance to the shore. x its height, y how broken it is (white water on and behind a breaking crest).
${WATER_SURF_GLSL}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    if (u_waveSpace < 0.5) return;
    if (u_farSurface > 0.5) { local.y += u_oceanLevel; return; }
    vec2 p = uv + u_origin;
    float cell = u_cellSize > 0.0 ? u_cellSize * exp2(es_vertexColor.r * 7.0) : 0.0;
    if (u_tileMorph.x > 0.0) {
        cell = u_cellSize * exp2(floor(es_vertexColor.r * 15.0 + 0.5));
        float boundary = cell*u_tileMorph.x*u_tileMorph.y;
        float morph = smoothstep(1.4*boundary,2.0*boundary,length(vec3(uv-u_tileEye,u_tileMorph.z)));
        vec2 parent = floor(uv/(2.0*cell)+0.001)*(2.0*cell);
        vec2 shift = es_vertexColor.g > 0.5 ? (parent-uv)*morph : vec2(0);
        local.xz += shift;
        p += shift;
        cell *= 1.0+morph;
    }
    // The water's rest height there, how high its body's waves stand (a multiple of u_waveHeight, the weather's) and the share kept toward
    // the shore; and the surf running in on it, which a current carries none of.
    vec4 zone = u_zoneOn > 0.5 ? waterZoneAt(p) : vec4(0.0, 0.0, 1.0, 1.0);
    vec4 field = u_zoneOn > 0.5 ? waterZoneField(p) : vec4(1e6, 0.0, 0.0, 1.0);
    float still = u_zoneOn > 0.5 ? waterZoneStill(p) : 1.0;
    float surf = waterSurf(u_zoneOn > 0.5 ? waterZoneSurf(p) : 1e6, field.x, u_surfHeight * u_waveHeight * zone.z * zone.w * still, u_time.x).x;
    // The apron past the rings (green 0, see waterMesh.ts) is the open sea out to the horizon: an edge vertex that stands over a river on a
    // cliff, or on the land beside one, would lift a strip of sea eighty kilometres long to the river's height.
    float rest = es_vertexColor.g < 0.5 && u_oceanOn > 0.5 ? u_oceanLevel : zone.x;
    local.y += rest + (waterWaveHeight(p, u_time.x, cell) * zone.z * field.w + surf) * u_geoWaves * (es_vertexColor.g < 0.5 || u_waterMeshView > 1.5 ? 0.0 : 1.0);
}
#pragma end

#pragma vertexoffset wgsl
${WATER_ZONE_LAYER_WGSL}
${WATER_BEND_WGSL}
fn waterWaveHeight(p : vec2f, time : f32, cell : f32) -> f32 {
    let at = waterBend(p, mc.u_waveLength).xy;
    ${WAVES_WGSL}
    var height = 0.0;
    let base = radians(mc.u_waveDirection);
    for (var i : i32 = 0; i < ${WAVE_SET_SIZE}; i = i + 1) {
        if (f32(i) >= mc.u_waveCount) { break; }
        let spec = wave[i];
        let span = mc.u_waveLength * spec.y;
        let k = 6.2831853 / span;
        let a = base + radians(spec.x);
        let d = vec2f(sin(a), cos(a));
        let omega = sqrt(mc.u_waveGravity * k) * mc.u_waveSpeed * spec.w;
        var fade = 1.0;
        if (cell > 0.0) { fade = clamp((span / cell - 3.0) / 3.0, 0.0, 1.0); }
        height = height + mc.u_waveHeight * spec.z * exp(sin(k * dot(d, at) - omega * time) - 1.0) * fade;
    }
    return height;
}
${WATER_ZONE_AT_WGSL}
${WATER_ZONE_FIELD_WGSL}
// The distance the surf runs in by at p: the shore's with a river's water taken for land and smoothed over the surf's length, so the crests
// come in as lines that turn to the shore as they near it and run straight across a river's mouth. Past the region: the ocean's.
${WATER_ZONE_SURF_WGSL}
// How much of the surf a current leaves at p: none in a river, and more and more of it away from where the river runs out into open water.
${WATER_ZONE_STILL_WGSL}
// How steep the shore is at p: 0 a gentle beach (waves wash up it), 1 rock or a cliff (they burst white on it).
${WATER_ZONE_STEEP_WGSL}
${WATER_SURF_WGSL}
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    if (mc.u_waveSpace < 0.5) { return; }
    if (mc.u_farSurface > 0.5) { (*local).y += mc.u_oceanLevel; return; }
    var p = uv + mc.u_origin;
    var cell = 0.0;
    if (mc.u_cellSize > 0.0) { cell = mc.u_cellSize * exp2(es_vertexColor.r * 7.0); }
    if (mc.u_tileMorph.x > 0.0) {
        cell = mc.u_cellSize * exp2(floor(es_vertexColor.r * 15.0 + 0.5));
        let bound = cell*mc.u_tileMorph.x*mc.u_tileMorph.y;
        let morph = smoothstep(1.4*bound,2.0*bound,length(vec3f(uv-mc.u_tileEye,mc.u_tileMorph.z)));
        let parent = floor(uv/(2.0*cell)+0.001)*(2.0*cell);
        let shift = select(vec2f(0), (parent-uv)*morph, es_vertexColor.g>0.5);
        (*local).x += shift.x; (*local).z += shift.y;
        p += shift; cell *= 1.0+morph;
    }
    var zone = vec4f(0.0, 0.0, 1.0, 1.0);
    var field = vec4f(1e6, 0.0, 0.0, 1.0);
    if (mc.u_zoneOn > 0.5) { zone = waterZoneAt(p); field = waterZoneField(p); }
    var still = 1.0;
    if (mc.u_zoneOn > 0.5) { still = waterZoneStill(p); }
    var surfAt = 1e6;
    if (mc.u_zoneOn > 0.5) { surfAt = waterZoneSurf(p); }
    let surf = waterSurf(surfAt, field.x, mc.u_surfHeight * mc.u_waveHeight * zone.z * zone.w * still, tc.u_time.x).x;
    var rest = zone.x;
    if (es_vertexColor.g < 0.5 && mc.u_oceanOn > 0.5) { rest = mc.u_oceanLevel; }
    (*local).y = (*local).y + rest + (waterWaveHeight(p, tc.u_time.x, cell) * zone.z * field.w + surf) * mc.u_geoWaves * select(1.0,0.0,es_vertexColor.g < 0.5 || mc.u_waterMeshView > 1.5);
}
#pragma end

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

#ifdef ES_GBUFFER
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

${PACK_NORMAL_GLSL}
#else
out vec4 fragColor;
#endif

// Where the waves are read for the true place p, bent by the given span (waves.ts: waveBend): crests of straight sines a few directions apart
// add up to long parallel lines, a sea scored with strokes that turn with the wind. xy to read at; zw dx/dz and dz/dx, for a slope. One
// sine an axis: this runs for every pixel of the water, and with a term more a phone paid 11 ms a frame for it.
${WATER_ZONE_LAYER_GLSL}
${WATER_BEND_GLSL}
/// How far the opaque scene is at a texel of the frame's copy of it: r while a 16-bit float holds the distance, b (the same in units of 1024) past that.
float sceneFar(vec4 t) { return t.r < 65000.0 ? t.r : t.b * 1024.0; }
// The copy of the scene's distances, read texel by texel: filtered, a texel on the edge of something against the sky blends a distance
// and a sky flag that are neither (a 'far' bed that never was), and the water there turns deep in single pixels.
vec4 sceneDepthAt(vec2 uv) {
    ivec2 size = textureSize(u_sceneDepthMap, 0);
    return texelFetch(u_sceneDepthMap, clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1)), 0);
}
vec3 waterReceiverAt(vec2 uv, float distance_) {
    vec3 point = worldFromDepth(uv, 0.5);
    return point - viewDirection(point) * (distance_ - distanceToEye(point));
}

${SURFACE_WAVES}
${CAUSTICS_GLSL}
// The zone's water at p: its surface's height, its depth and how high its waves stand, each texel decoded before the four about p are blended
// (bytes blended are no number). Past the region: the ocean's, where there is one.
${WATER_ZONE_AT_GLSL}
// The zone's field at p, decoded: the shore distance, the current, and the share of its waves a place keeps. Past the region: the ocean's.
${WATER_ZONE_FIELD_GLSL}
// The distance the surf runs in by at p: the shore's with a river's water taken for land and smoothed over the surf's length, so the crests
// come in as lines that turn to the shore as they near it and run straight across a river's mouth. Past the region: the ocean's.
${WATER_ZONE_SURF_GLSL}
// How much of the surf a current leaves at p: none in a river, and more and more of it away from where the river runs out into open water.
${WATER_ZONE_STILL_GLSL}
// How steep the shore is at p: 0 a gentle beach (waves wash up it), 1 rock or a cliff (they burst white on it).
${WATER_ZONE_STEEP_GLSL}
// The surf (waves.ts surfHeight): its crests are lines of phase (the distance the surf runs in by), and it rises, breaks and runs up by
// shore, the real distance to the shore. x its height, y how broken it is (white water on and behind a breaking crest).
${WATER_SURF_GLSL}
${SURFACE_SLOPE}
/// The first directional light that shines: xyz is where it stands in the sky, w 1 if there is one, color its colour and strength, tiles its place in the shadow atlas.
void waterSun(out vec4 dir, out vec4 color, out ivec2 tiles) {
    dir = vec4(0.0);
    color = vec4(0.0);
    tiles = ivec2(0);
    for (int i = 0; i < 16; ++i) {
        Light l = u_lights[i];
        if (l.posDir.z > 0.5 && l.posDir.z < 1.5 && l.color.a > 0.0) {
            dir = vec4(-normalize(vec3(l.posDir.x, l.posDir.y, l.posDir.w)), 1.0);
            color = l.color;
            tiles = ivec2(int(l.shadowMap.x), int(mod(l.shadowMap.y, 8.0)));
            return;
        }
    }
}

/// Whether the sun reaches a point: one tap of the shadow map, 1 where there is none.
float waterSunVisibility(vec3 worldPos, int first, int count) {
#ifdef ES_RECEIVE_SHADOW
    if (u_shadowParams.x < 0.5 || count <= 0) return 1.0;
    for (int k = 0; k < 16; ++k) {
        if (k >= count) break;
        int t = first + k;
        vec4 c = u_shadowMatrix[t] * vec4(worldPos, 1.0);
        if (c.w <= 0.0) continue;
        vec3 proj = c.xyz / c.w;
        vec2 uv = proj.xy * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) continue;
        vec4 rect = u_shadowTile[t];
        vec2 at = rect.xy + uv * rect.z;
        vec2 lo = rect.xy + u_shadowParams.y * 0.5;
        vec2 hi = rect.xy + rect.z - u_shadowParams.y * 0.5;
        float d = unpackDepth(textureLod(u_shadowMap, clamp(at, lo, hi), 0.0).rgb);
        return d < clamp(proj.z * 0.5 + 0.5, 0.0, 1.0) - 0.0025 ? 0.0 : 1.0;
    }
#endif
    return 1.0;
}

/// What a ray from p along r meets in the picture of the scene the frame copied, as a colour with alpha 1, or alpha 0 where it meets nothing on screen.
vec4 waterReflect(vec3 p, vec3 r, float eyeDist) {
    // Every length here is a share of how far off the water is: a step, and how thick what the ray meets is taken to be. None is a number of units.
    float stride = max(eyeDist * 0.03, 1e-4);
    float travelled = stride;
    for (int i = 0; i < ${MOST_WATER_REFLECTION_STEPS}; ++i) {
        if (float(i) >= u_reflectSteps) break;
        vec3 q = p + r * travelled;
        vec4 clip = u_projection * vec4(q, 1.0);
        if (clip.w <= 1e-4) break;
        vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float qDist = u_camera.w > 0.5 ? length(q - u_camera.xyz) : -dot(q, u_camera.xyz);
        // r how far the picture is, g whether it holds nothing there (the sky, painted after this copy was taken): nothing to meet, and the sky the lighting gave stays.
        vec4 scene = sceneDepthAt(uv);
        float sceneDist = sceneFar(scene);
        // The ray has gone behind something the picture holds: that is what it met, if it did not skip clean through a thin one.
        // Fading toward the picture's edge: a reflection that runs off screen thins away instead of stopping on a line.
        vec2 edge = min(uv, 1.0 - uv);
        if (scene.g < 0.5 && sceneDist < qDist && qDist - sceneDist < stride * 2.0 + qDist * 0.002) return vec4(textureLod(u_sceneColor, uv, 0.0).rgb, smoothstep(0.0, 0.08, min(edge.x, edge.y)));
        stride *= u_reflectGrowth;
        travelled += stride;
    }
    return vec4(0.0);
}

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
#endif
    float time = u_time.x;
    vec3 viewDir = viewDirection(P);
    float waterDist = u_camera.w > 0.5 ? length(P - u_camera.xyz) : -dot(P, u_camera.xyz);

    // Distant ocean only needs the deep water and its reflected sky. Keep the shore
    // field, screen-space refraction, and the optical atlas out of this draw.
    if (u_farSurface > 0.5 && u_waterMeshView < 0.5) {
        vec3 up = vec3(0,1,0);
        vec2 oceanPoint = P.xz + u_renderOrigin.xz;
        float crest;
        vec2 oceanSlope = waveSlope(oceanPoint, time, waterDist, crest) * u_oceanWaves;
        float footprint = max(length(dFdx(oceanPoint)), length(dFdy(oceanPoint)));
        oceanSlope *= 1.0 - smoothstep(0.12 * u_waveLength, 0.35 * u_waveLength, footprint);
        vec3 oceanNormal = normalize(vec3(-oceanSlope.x, 1.0, -oceanSlope.y));
        SurfaceExt distant = surfaceExtNone(oceanNormal);
        distant.misc.x = 0.0;
        distant.coat = vec4(1.0,u_roughness,max(u_reflectance,1e-4),0.0);
        vec3 deep = mix(u_deepColor.rgb,u_oceanLook.rgb*u_deepColor.rgb/max(u_shallowColor.rgb,vec3(1e-3)),u_oceanLook.a);
        fragColor = vec4(applyLightingSurface(deep,up,P,viewDir,0.0,1.0,0.0,1.0,distant),1.0);
#ifdef ES_GBUFFER
        fragSurface = vec4(packNormal(up),u_roughness,0.72);
        fragAlbedo = vec4(0.0);
#endif
        return;
    }
    // The surface: the long waves, then the ripples they carry, flattened with distance so the far water is calm rather than aliased.
    vec2 wp = u_waveSpace > 0.5 && u_tileMorph.x <= 0.0 ? v_texCoord + u_origin : P.xz + u_renderOrigin.xz;
    // The zone's water at this pixel: how far in from the shore, how deep, how high the waves, the current. The open sea past the region has it all in
    // uniforms, and every read below is one a pixel there does not pay for (these maps have no mips, so a read at level 0 may sit in a branch).
    ${ZONE_SAMPLE}
    // The water's colour: the body's own where it has one (a river browner than the lake it runs into), blended by its share where bodies
    // meet; the material's elsewhere. Deep water darkens the body's colour as the material's deep colour darkens its shallow one.
    vec4 lookTex = zoneOn && zoneIn ? waterZoneLayer(zoneUv, 1.0) : vec4(u_oceanLook.rgb * u_oceanLook.a, 1.0 - u_oceanLook.a);
    float lookOwn = clamp(1.0 - lookTex.a, 0.0, 1.0);
    vec3 lookColor = lookOwn > 1e-3 ? lookTex.rgb / lookOwn : u_shallowColor.rgb;
    vec3 shallowColor = mix(u_shallowColor.rgb, lookColor, lookOwn);
    vec3 deepColor = mix(u_deepColor.rgb, lookColor * u_deepColor.rgb / max(u_shallowColor.rgb, vec3(1e-3)), lookOwn);
    // Where the foam texture is read, and how fast that moves across the screen: taken here because the read itself waits until there is foam.
    vec4 px = vec4(dFdx(wp), dFdy(wp));
    float surfStep = max(u_zoneSize.x / float(textureSize(u_zoneSurfaceData, 0).x), 1e-3);
    float crest, ripFoam;
    vec2 surf, toSea;
    vec2 slope = surfaceSlope(wp, time, waterDist, px, zone, zoneOn, zoneRead, shoreDist, flow, damp, calm, surfStep, crest, ripFoam, surf, toSea);
    // The foam on a moving water sheet travels landward on the rise and back with the drawdown.
    float swashTravel = min(0.2 * u_surfLength, 1.25 * surf.x) * (1.0 - smoothstep(0.0, max(0.65 * u_surfLength, 1e-4), shoreDist));
    vec2 foamUv = (wp + toSea * swashTravel + u_foamFlow * time) / max(u_foamTile, 1e-4);
    vec2 foamDx = dFdx(foamUv), foamDy = dFdy(foamUv);
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 Ngeo = vec3(0.0, 1.0, 0.0);
#ifdef MESH_NORMALS
    if (u_waveSpace > 0.5) {
        // The zone's surface: the mesh's normal is up (the hook lifts the vertices and leaves it alone), and the slope leans along its uv
        // axes, which are x and z.
        Ngeo = normalize(v_worldNormal);
        N = perturbNormal(Ngeo, P, v_texCoord, normalize(vec3(-slope.x, -slope.y, 1.0)));
    }
#endif
    // Seen from below, the surface turns over, and light goes the other way through it: out of the water, into the air.
    // A near crest can face an eye below its rest tangent. The displaced triangle determines which medium the view ray leaves.
    bool below = u_waveSpace > 0.5 ? !gl_FrontFacing : dot(viewDir, Ngeo) < 0.0;
    if (below) { N = -N; Ngeo = -Ngeo; }

    // What is behind the water: the picture and the distance, where the frame took them.
    bool haveColor = texture(u_sceneColor, vec2(0.5)).a < 0.75;
    bool haveDepth = haveColor && texture(u_sceneDepthMap, vec2(0.5)).a < 0.75;
    vec4 clip0 = u_projection * vec4(P, 1.0);
    vec2 uv0 = clip0.xy / max(clip0.w, 1e-4) * 0.5 + 0.5;
    float behindDist = haveDepth ? sceneFar(sceneDepthAt(clamp(uv0, vec2(0.001), vec2(0.999)))) : waterDist + u_fallbackDepth;
    float column0 = max(behindDist - waterDist, 0.0);
    // Past the shore only the surf's film is water: over ground no lower than the water, within its height of the rest level (further off
    // it is the mesh stretched between two waters' heights); the depth test cuts it where the ground rises above it. Asked here, before the
    // waves and the light are worked out for it: a shader that may discard late is not let test depth early, and what leaves here does not pay for them.
    bool film = abs(P.y + u_renderOrigin.y - zone.x) <= surf.x + u_waveHeight * zone.z + 1e-3;
    // Ground lower than the water there (a dry basin) takes no film. The picture's depth says it of this very pixel; the baked depth only
    // of whole texels (dry is 0 and any wet one beside it raises the blend), which would cut the film in the texels' steps.
    float under = haveDepth ? column0 * abs(viewDir.y) - 2.0 * (surf.x + u_waveHeight * zone.z) - 1.0 : shoreDepth - 1e-3;
    if (shoreDist < 0.0) {
        if (surf.x <= 0.0 || !film) discard;
        // On a surveyed beach an oblique eye ray may see past an entire breaker. Use the ground
        // under this water column; the distant receiver on that ray cannot decide if the beach is wet.
        vec2 ground = zoneRead ? waterZoneLayer(zoneUv, 2.0).ba : vec2(0.0);
        if ((ground.y > 0.5 && ground.x < 0.05) || (ground.y <= 0.5 && under > 0.0)) discard;
    }

    if (u_waterMeshView > 0.5) {
        vec3 bary = vec3(v_color.ba, 1.0-v_color.b-v_color.a);
        vec3 edge = smoothstep(vec3(0.0), max(fwidth(bary),vec3(1e-6))*1.05, bary);
        float line = 1.0-min(edge.x,min(edge.y,edge.z));
        fragColor = vec4(mix(vec3(0.001,0.004,0.006),vec3(0.045,0.57,0.61),line),1.0);
#ifdef ES_GBUFFER
        fragSurface = vec4(0.0);
        fragAlbedo = vec4(0.0);
#endif
        return;
    }
    // Bent by the waves: the ray through the tilted surface against the ray through a flat one, over as much water as there is.
    float RATIO = below ? WATER_IOR : 1.0 / WATER_IOR;
    vec3 bentWave = refract(-viewDir, N, RATIO);
    vec3 bentFlat = refract(-viewDir, Ngeo, RATIO);
    // Past the critical angle (about 49 degrees) nothing gets out of the water: refract gives nothing, and the surface is a mirror.
    if (below && (dot(bentWave, bentWave) < 0.5 || dot(bentFlat, bentFlat) < 0.5)) { bentWave = bentFlat = vec3(0.0); }
    // How far the bent ray runs in the water before it meets what is behind: the depth over the refracted ray's slope, which is never more than
    // 49 degrees off straight down, not the eye's own line to the bed. Seen low across shallow water that line is many times the depth, and an
    // offset that long threw single pixels of the shallows off the far edge of what they lie on (specks of deep water over the sand).
    float slantIn = sqrt(max(1.0 - viewDir.y * viewDir.y, 0.0)) / WATER_IOR;
    float path = below ? column0 : column0 * abs(viewDir.y) / sqrt(max(1.0 - slantIn * slantIn, 1e-4));
    float reach = min(path, u_distortionRange) * u_refractionStrength;
    // The lateral offset arrives at the opaque receiver. Projecting that offset at the
    // interface instead magnifies it without bound as the camera approaches the water.
    vec2 straightUv = clamp(uv0, vec2(0.001), vec2(0.999));
    vec3 farPoint = waterReceiverAt(straightUv, behindDist);
    vec4 clip1 = u_projection * vec4(farPoint + (bentWave - bentFlat) * reach, 1.0);
    vec2 uv1 = clip1.xy / max(clip1.w, 1e-4) * 0.5 + 0.5;
    if (clip1.w <= 0.0 || any(lessThan(uv1,vec2(0.001))) || any(greaterThan(uv1,vec2(0.999)))) uv1 = straightUv;
    vec3 behind = vec3(0.0);
    float column = column0;
    if (haveColor) {
        uv1 = clamp(uv1, vec2(0.001), vec2(0.999));
        vec4 depthSample = sceneDepthAt(uv1);
        float dist1 = haveDepth ? sceneFar(depthSample) : behindDist;
        // Something standing in front of the water cannot be what is seen through it: keep the straight-through lookup.
        if (dist1 < waterDist || (haveDepth && depthSample.g > 0.5 && sceneDepthAt(straightUv).g < 0.5)) { uv1 = straightUv; dist1 = behindDist; depthSample = sceneDepthAt(uv1); }
        behind = texture(u_sceneColor, uv1).rgb;
        // From below, what is seen through the window is the air above, and where that is open sky the picture does not hold it yet (the sky
        // is drawn after the water): it is the sky's own light, along the ray as it left the water.
        if (below && haveDepth && depthSample.g > 0.5 && dot(bentWave, bentWave) > 0.5) behind = envRadiance(normalize(bentWave), 0.0, reflectionColumn(), P);
        column = max(dist1 - waterDist, 0.0);
        // The material refracts a scene-colour texel. Its depth belongs to its own view ray:
        // the same point that the underwater pass reconstructs when the lens crosses the surface.
        if (!below && haveDepth && u_causticOn > 0.5 && u_causticRect.z == 0.0) {
            vec3 receiver = waterReceiverAt(uv1, dist1);
            vec3 face = cross(dFdx(receiver), dFdy(receiver));
            if (dot(face, viewDirection(receiver)) < 0.0) face = -face;
            vec3 receiverN = dot(face, face) > 1e-12 ? normalize(face) : Ngeo;
            vec4 sun, sunColor;
            ivec2 tiles;
            waterSun(sun, sunColor, tiles);
            if (sun.w > 0.5 && depthSample.g < 0.5) {
                vec3 absolute = receiver + u_renderOrigin.xyz;
                float depth = zoneOn ? waterZoneAt(absolute.xz).x - absolute.y : dot(P - receiver, Ngeo);
                vec3 extinction = u_absorption.rgb * u_density;
                vec3 light = waterReceiverLight(absolute, receiverN, zoneOn ? vec3(0,1,0) : Ngeo, depth, sun.xyz, sunColor, extinction, u_causticStrength, time);
                if (any(greaterThan(light, vec3(0.0)))) behind *= 1.0 + light * waterSunVisibility(receiver, tiles.x, tiles.y);
            }
        }
    }

    // The water in between takes the light out of it, red first, and gives back its own colour: more of it the deeper it goes.
    // Light bends down as it enters water and is never more than 49 degrees off straight down in it: what it crosses is the depth over that
    // slope, not the eye's own line to the bed, which seen low across the water is many times as long and would turn any sea deep.
    float across = sqrt(max(1.0 - viewDir.y * viewDir.y, 0.0)) / 1.333;
    float water = below ? column : column * abs(viewDir.y) / sqrt(1.0 - across * across);
    vec3 transmit = exp(-u_absorption.rgb * (u_density * water));
    // From below the water between the eye and the surface is the camera's own medium (the underwater effect fogs it), not a column behind the surface.
    if (below) transmit = vec3(1.0);
    float murk = 1.0 - dot(transmit, vec3(1.0 / 3.0));
    vec3 scatterColor = mix(shallowColor, deepColor, 1.0 - exp(-water * u_density * u_deepening));

    // Foam: along the shore, where the water is shallow, broken by noise that moves; and on the crests of the waves.
    float vertical = column * max(abs(viewDir.y), 0.15);
    float baked = haveDepth ? shoreDist : min(shoreDist, shoreDepth);
    // Most of a sea has none of the foam below, and the noise that breaks it up need not be worked out to find that: the shore's asks for less water than
    // its width (pulse is 1 at most), a crest's for a crest past the line.
    float surfFoam = 0.0;
    float foam = 0.0;
    float crestLine = 1.0 - 0.3 * u_foamCrest;
    if ((u_foamWidth > 0.0 && ((haveDepth && vertical < u_foamWidth) || (zoneOn && baked < u_foamWidth))) || (u_foamCrest > 0.0 && crest > crestLine) || ripFoam > 0.0 || surf.y > 0.0) {
        float foamScale = 1.0 / (u_rippleLength * 1.2);
        float breakup = waterNoise(wp * foamScale + vec2(time * 0.07, time * 0.05)) * 0.6 + waterNoise(wp * foamScale * 3.0 - vec2(time * 0.13, 0.0)) * 0.4;
        float pulse = 0.65 + 0.35 * sin(time * 0.9 + breakup * 6.0);
        float shore = haveDepth && u_foamWidth > 0.0 ? clamp((1.0 - vertical / (u_foamWidth * pulse)) * 1.25 - breakup * 1.15, 0.0, 1.0) : 0.0;
        // The baked shore foams too, where the depth buffer cannot say (no chain, no float targets) and along the outline the zone traced.
        if (zoneOn && u_foamWidth > 0.0) {
            // With the picture's depth the shallows foam by it, pixel by pixel; the baked depth then adds only the traced outline, not its texels.
            shore = max(shore, clamp((1.0 - baked / (u_foamWidth * pulse)) * 1.25 - breakup * 1.15, 0.0, 1.0));
            if (shore > 0.0) {
                // How the shore takes its waves: against rock or a cliff they burst white; up a gentle beach they wash in a thin line only; and the
                // less room the wind has to raise them (a sheltered lake), the less of either.
                float pound = waterZoneSteep(wp);
                float swash = 1.0 - smoothstep(0.0, surfStep * 1.5, shoreDist);
                shore *= mix(swash * 0.6, 1.0, pound) * mix(0.3, 1.0, zone.w);
            }
        }
        float onCrest = u_foamCrest > 0.0 ? smoothstep(crestLine, 1.0, crest) * smoothstep(0.35, 0.75, breakup) : 0.0;
        // A breaker whitens as much on a beach as the waves are big, but bursts whitest on rock.
        if (surf.y > 0.0) {
            float pitch = smoothstep(0.045, 0.17, surf.x / max(u_surfLength, 1e-4));
            float aeration = max(pitch, zoneOn ? waterZoneSteep(wp) : 1.0);
            surfFoam = surf.y * smoothstep(0.15, 0.6, breakup + surf.y * 0.4) * mix(0.2, 1.0, aeration);
            // On the beach the moving front is where a real layer of water meets the ground.
            if (haveDepth && shoreDist < 0.0 && u_foamWidth > 0.0) {
                float edge = 1.0 - smoothstep(0.0, u_foamWidth, vertical);
                surfFoam = max(surfFoam, edge * smoothstep(0.05, 0.65, breakup + surf.y * 0.5)
                    * smoothstep(0.0, 0.04 * u_surfLength, surf.x));
            }
        }
        foam = clamp(max(max(max(shore, onCrest * u_foamCrest), ripFoam * (0.55 + 0.45 * breakup)), surfFoam), 0.0, 1.0);
    }
    // The texture as coverage: a texel holding c of foam shows where the foam asked for is more than 1 - c, rising to full over the rest,
    // so thin foam keeps only the texture's densest marks and thick foam fills it. c = 1 leaves the foam as it was, and no foam stays none whatever c is.
    if (foam > 0.0) {
        float foamCover = textureGrad(u_foamMap, foamUv, foamDx, foamDy).r;
        foam = clamp((foam - (1.0 - foamCover)) / max(foamCover, 1e-3), 0.0, 1.0);
    }
    // Foam floats on top: from under the water it is a thin shadow on the light, not a white sheet.
    if (below) foam *= 0.2;

    // Two layers, as water is: the body, lit as what is under the surface (its light does not turn with every ripple, so the ripples do not
    // shade it in dark spots), and the surface over it, a coat of water's own reflectance that mirrors by the ripples' normal.
    vec3 Nbody = normalize(mix(Ngeo, N, u_bodyShading));
    SurfaceExt ext = surfaceExtNone(N);
    ext.misc.x = 0.0;
    vec3 albedo = mix(scatterColor * murk, u_foamColor.rgb, foam);
    // Rain stipples the surface finer than any ring: it reflects a little less sharply.
    float roughness = mix(u_roughness + 0.05 * clamp(u_rain, 0.0, 1.0), 0.7, foam);
    // The sea is seldom in shadow and its edge is lost in the waves: the sun's shadow is read as one hard edge here, not as a penumbra.
    g_shadowHard = 1.0;
    ext.coat = vec4(1.0, roughness, max(u_reflectance, 1e-4), 0.0);
    vec3 lit = applyLightingSurface(albedo, Nbody, P, viewDir, 0.0, 1.0, 0.0, 1.0, ext);
    float cosV = clamp(dot(N, viewDir), 0.0, 1.0);
    float fresnel = u_reflectance + (1.0 - u_reflectance) * pow(1.0 - cosV, 5.0);
    if (below) {
        // Out of the water the glancing rays are reflected whole: Snell's window, a cone of sky overhead in a mirror of the water below it.
        float sinT = 1.333 * sqrt(max(1.0 - cosV * cosV, 0.0));
        float cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
        fresnel = sinT >= 1.0 ? 1.0 : u_reflectance + (1.0 - u_reflectance) * pow(1.0 - cosT, 5.0);
    }
    vec3 down = below ? vec3(1.0) : exp(-u_absorption.rgb * (u_density * column * abs(viewDir.y) * u_bedShade));
    vec3 seen = behind * transmit * down * (1.0 - fresnel) * (1.0 - foam);
    // From below the water is a mirror past the critical angle, and what it mirrors is the world under it: the picture, followed along the reflected ray.
    vec3 mirror = vec3(0.0);
    if (below && fresnel > 0.02 && haveColor && haveDepth && u_mirror > 0.5) {
        vec4 met = waterReflect(P, reflect(-viewDir, N), waterDist);
        // Where the mirrored ray leaves the picture it meets only more water: the light the water itself scatters, as the underwater
        // effect fogs with (the sky's light and the sun's, given back in the water's colour), not a dark stand-in that turns the
        // underside black wherever the trace misses.
        vec4 sunDir, sunCol;
        ivec2 sunTiles;
        waterSun(sunDir, sunCol, sunTiles);
        vec3 skyIn = max(u_ambient.rgb + 0.282095 * u_envIrradiance[0].rgb * u_envTint.rgb, vec3(0.0));
        vec3 sunIn = sunDir.w > 0.5 ? sunCol.rgb * sunCol.a * max(sunDir.y, 0.0) : vec3(0.0);
        vec3 medium = mix(shallowColor, deepColor, 0.5) * (skyIn + sunIn);
        mirror = mix(medium, met.rgb, met.a);
    }
    seen += mirror * fresnel * (1.0 - foam);
    vec3 color = lit + seen;
    // Light through the crests: a wave's top is thin, and seen against a low sun the light that came through it is the water's own colour,
    // brightest where the eye looks into the sun and across the water (a crest seen from above is all depth), out of the sun's shadow.
    if (!below && u_crestScatter > 0.0 && crest > 0.25) {
        vec4 sunAt, sunLight;
        ivec2 sunTiles;
        waterSun(sunAt, sunLight, sunTiles);
        float toward = max(dot(-viewDir, sunAt.xyz), 0.0);
        if (sunAt.w > 0.5 && toward > 0.0) {
            float glow = toward * toward * toward * toward * smoothstep(0.25, 0.9, crest) * (1.0 - abs(viewDir.y))
                       * (1.0 - fresnel) * (1.0 - foam);
            color += sunLight.rgb * sunLight.a * shallowColor * glow * u_crestScatter * waterSunVisibility(P, sunTiles.x, sunTiles.y);
        }
    }
    // From above, what the surface mirrors is the world as well as the sky: the reflected ray followed through the picture. Where it meets
    // something on screen that takes the reflected share's place; where it leaves the screen, the sky the lighting gave stays.
    if (!below && fresnel > 0.03 && haveColor && haveDepth && u_mirror > 0.5) {
        // A ripple tilted far enough sends the ray down into the sea, where the picture holds the bed and not the next wave the ray would
        // really meet (the bed, undimmed by its water, drawn as white flecks all over a shallow sea): it goes on up, as off that wave.
        vec3 away = reflect(-viewDir, N);
        away.y = abs(away.y);
        vec4 met = waterReflect(P, away, waterDist);
        color = mix(color, met.rgb, met.a * fresnel * (1.0 - foam) * 0.9);
    }
    // At its edge the water thins to nothing: over the last u_edgeSoftness of depth the ground behind shows through more and more, so the
    // water meets the shore along a soft line and not the zone's texel steps. The surf's white stays, riding up the sand.
    if (!below && haveColor && haveDepth && u_edgeSoftness > 0.0) {
        float thin = max(smoothstep(0.0, u_edgeSoftness, column0 * max(abs(viewDir.y), 0.15)), surfFoam);
        color = mix(textureLod(u_sceneColor, clamp(uv0, vec2(0.001), vec2(0.999)), 0.0).rgb, color, thin);
    }
    fragColor = vec4(color, haveColor ? 1.0 : 0.85);
#ifdef ES_GBUFFER
    // 0.72: a surface, and water (see readSurface): what lands on it is the water's, not a wet floor's.
    fragSurface = vec4(packNormal(normalize(N)), roughness, 0.72);
    fragAlbedo = vec4(0.0);
#endif
}
#pragma end

`;

// A texel records the very surface the player sees at this world position. Two channels hold
// its upward normal, two its displaced elevation. The pass is drawn through the zone's own
// material, including its authored normal map, weather, surf, current and disturbances.
export const WATER_CAUSTIC_BAKE = `#pragma shader "Water Optical Surface"
#pragma version 300 es
#pragma domain PostProcess
${WATER.split('\n').filter(line => line.startsWith('#pragma param ') && /u_(wave|ripple|gust|detail|zone|ocean|surf|geoWaves|flowCycle|rain)/.test(line) && !/u_(zoneLook|oceanLook)/.test(line)).join('\n')}
#pragma param u_bakeA vec4 default(0,0,1,0)
#pragma param u_bakeB vec4 default(0,1,256,0)
#pragma fragment
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
${WATER_ZONE_LAYER_GLSL}
${WATER_BEND_GLSL}
${WAVE_HEIGHT}
${WATER_ZONE_AT_GLSL}
${WATER_ZONE_SURF_GLSL}
${WATER_ZONE_STILL_GLSL}
${WATER_SURF_GLSL}
${SURFACE_WAVES}
${SURFACE_SLOPE}
void main() {
    vec2 wp = u_bakeA.xy + v_texCoord * u_bakeA.z;
    float time = u_bakeA.w;
    float stepSize = u_bakeA.z * abs(dFdx(v_texCoord.x));
    ${ZONE_SAMPLE}
    if (shoreDist < 0.0) { fragColor = vec4(0.0); return; }
    float surfStep = max(u_zoneSize.x / float(textureSize(u_zoneSurfaceData, 0).x), 1e-3);
    float crest, foam;
    vec2 surf, toSea;
    vec2 slope = surfaceSlope(wp, time, 0.0, vec4(stepSize, 0.0, 0.0, stepSize), zone, zoneOn, zoneRead, shoreDist,
                              flow, damp, calm, surfStep, crest, foam, surf, toSea);
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
    float height = zone.x + (waterWaveHeight(wp, time, 0.0) * damp + surf.x) * u_geoWaves;
    float code = floor(clamp((height - u_bakeB.x) / u_bakeB.y, 0.0, 1.0) * 65535.0 + 0.5);
    fragColor = vec4((normal.xz * 127.0 + 128.0) / 255.0, floor(code / 256.0) / 255.0, mod(code, 256.0) / 255.0);
}
#pragma end
`;

export const WATER_SHADER_TEMPLATE = makeBuiltinShaderTemplate('water', 'Water',
    'Waves, refraction, reflection, depth absorption and foam for a horizontal body of water.', WATER);
