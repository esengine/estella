// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    shaderLib.ts
 * @brief   Shader helpers more than one built-in shader is written with, each in GLSL and WGSL.
 *
 * One definition of each: a copy pasted into each shader drifts, and a fix that reaches one copy of an encoding (the normal a
 * pass writes, the noise a ray-marched effect is dithered with) leaves the shaders that read it disagreeing. A shader splices
 * the constant where the function used to be written. Plain strings, so an unused one is dropped from a bundle.
 */

/** Octahedral normal encoding: a unit vector in two [0, 1] channels, which is what an 8-bit target can hold. Every pass that writes the surface target (normal + roughness) encodes with this, and every effect that reads it decodes the inverse, so there is one copy. */
export const PACK_NORMAL_GLSL = `vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}`;
/** {@link PACK_NORMAL_GLSL} in WGSL. */
export const PACK_NORMAL_WGSL = `fn packNormal(n : vec3f) -> vec2f {
    let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
    let sgn = vec2f(select(-1.0, 1.0, a.x >= 0.0), select(-1.0, 1.0, a.y >= 0.0));
    var e = a.xy;
    if (a.z < 0.0) { e = (vec2f(1.0) - abs(a.yx)) * sgn; }
    return e * 0.5 + 0.5;
}`;
/** Interleaved gradient noise (Jimenez 2014): a per-pixel dither in [0, 1) from a pixel coordinate, the jitter behind every ray-marched effect. */
export const IGN_GLSL = `float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}`;
/** {@link IGN_GLSL} in WGSL. */
export const IGN_WGSL = `fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}`;
/** A hash from a 3D point to [0, 1) (Dave Hoskins, "hash without sine"): stable across GPUs, unlike the sin hashes. */
export const HASH13_GLSL = `float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}`;
/** {@link HASH13_GLSL} in WGSL. */
export const HASH13_WGSL = `fn hash13(p0 : vec3f) -> f32 {
    var p = fract(p0 * 0.1031);
    p = p + dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}`;
/** Smooth 3D value noise in [0, 1). Calls hash13, so include HASH13 before it. */
export const VALUE_NOISE3_GLSL = `float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x);
    float b = mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x);
    float c = mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x);
    float d = mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}`;
/** {@link VALUE_NOISE3_GLSL} in WGSL. */
export const VALUE_NOISE3_WGSL = `fn vnoise(p : vec3f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = mix(hash13(i), hash13(i + vec3f(1, 0, 0)), f.x);
    let b = mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), f.x);
    let c = mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), f.x);
    let d = mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}`;
/** Henyey-Greenstein phase with g = 0.55: how much light a particle scatters toward the viewer, strongly forward. */
export const PHASE_HG_GLSL = `float phaseHG(float cosine) {
    const float g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}`;
/** {@link PHASE_HG_GLSL} in WGSL. */
export const PHASE_HG_WGSL = `fn phaseHG(cosine : f32) -> f32 {
    let g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}`;
/** A sine hash from a number to [0, 1). */
export const HASH11_GLSL = `float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }`;
/** {@link HASH11_GLSL} in WGSL. */
export const HASH11_WGSL = `fn hash11(n : f32) -> f32 { return fract(sin(n * 127.1) * 43758.5453); }`;
/** A sine hash from a 2D point to [0, 1). */
export const HASH21_GLSL = `float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;
/** {@link HASH21_GLSL} in WGSL. */
export const HASH21_WGSL = `fn hash21(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }`;
/** Smooth 2D value noise in [0, 1) over a sine hash (hash2d), the dissolve material's and the material graph's Noise node. */
export const NOISE2D_GLSL = `float hash2d(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2(0.0, 1.0)), hash2d(i + vec2(1.0, 1.0)), f.x), f.y);
}`;
export const NOISE2D_WGSL = `fn hash2d(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn noise2d(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2f(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2f(0.0, 1.0)), hash2d(i + vec2f(1.0, 1.0)), f.x), f.y);
}`;
