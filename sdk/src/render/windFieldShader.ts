// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  windFieldShader.ts
 * @brief The wind field's shader text and constants, apart from its system so a shader module can take them without the ECS.
 *
 * @details See windField.ts for what the field is. `esWindFieldXZ` reads it on the ground, `esWindFieldXY` in a 2D picture's plane; each
 *          pass and front carries how long ago it shoved, so a medium-precision 2D shader holds it at any hour of play.
 */

/** The most wake passes a material is told about at once. */
export const WIND_PASSES = 8;
/** The most bursts a material is told about at once. */
export const WIND_FRONTS = 4;
/** How long, in seconds, a shove is still felt: past it the spring has rung down to under 3% of its peak. */
export const WIND_RING = 2;

/** The uniforms, in the order the shaders take them. */
export const WIND_PASS_UNIFORMS: readonly string[] = Array.from({ length: WIND_PASSES }, (_, i) => `u_windPass${i}`);
export const WIND_PASS_V_UNIFORMS: readonly string[] = Array.from({ length: WIND_PASSES }, (_, i) => `u_windPassV${i}`);
export const WIND_FRONT_UNIFORMS: readonly string[] = Array.from({ length: WIND_FRONTS }, (_, i) => `u_windFront${i}`);
export const WIND_FRONT_P_UNIFORMS: readonly string[] = Array.from({ length: WIND_FRONTS }, (_, i) => `u_windFrontP${i}`);

/** The `#pragma param` lines a shader that reads the field declares. */
export const WIND_FIELD_PARAMS = [
    ...WIND_PASS_UNIFORMS, ...WIND_PASS_V_UNIFORMS, ...WIND_FRONT_UNIFORMS, ...WIND_FRONT_P_UNIFORMS,
].map((n) => `#pragma param ${n} vec4 default(0,0,0,0)`).join('\n');

// The spring: a shove s seconds ago, as the share of its peak a plant leans by now. Over at about a quarter second, back past upright by a third
// of that, still by two seconds. Kept in step with springAt below.
const SPRING = { damping: 1.8, rate: 5, gain: 1.64 };

const passCalls = (plane: string, prefix: string): string => Array.from({ length: WIND_PASSES }, (_, i) =>
    `    lean = lean + esWindPassAt(at, ${prefix}u_windPass${i}.${plane}, ${prefix}u_windPassV${i}.${plane}, ${prefix}u_windPassV${i}.w, ${prefix}u_windPass${i}.w);`).join('\n');
const frontCalls = (plane: string, prefix: string): string => Array.from({ length: WIND_FRONTS }, (_, i) =>
    `    lean = lean + esWindFrontAt(at, ${prefix}u_windFront${i}.${plane}, ${prefix}u_windFront${i}.w, ${prefix}u_windFrontP${i});`).join('\n');

/**
 * The field in GLSL: `esWindFieldXZ(vec3 world)` on the ground, `esWindFieldXY(vec2 world)` in a 2D picture. Each is the air's push at that
 * point now (world units a second, already through the spring); a shader scales it to a lean.
 */
export const WIND_FIELD_GLSL = `
highp float esWindSpring(highp float s) {
    if (s <= 0.0 || s > ${WIND_RING.toFixed(1)}) return 0.0;
    return exp(-${SPRING.damping.toFixed(2)} * s) * sin(${SPRING.rate.toFixed(2)} * s) * ${SPRING.gain.toFixed(2)};
}
highp vec2 esWindPassAt(highp vec2 at, highp vec2 pos, highp vec2 vel, highp float radius, highp float age) {
    if (radius <= 0.0) return vec2(0.0);
    highp float f = clamp(1.0 - length(at - pos) / radius, 0.0, 1.0);
    return vel * (f * f * (3.0 - 2.0 * f)) * esWindSpring(age);
}
highp vec2 esWindFrontAt(highp vec2 at, highp vec2 centre, highp float age, highp vec4 p) {
    if (p.y <= 0.0) return vec2(0.0);
    highp vec2 d = at - centre;
    highp float len = length(d);
    if (len < 1e-3) return vec2(0.0);
    highp float amp = p.y * (1.0 - smoothstep(0.0, max(p.z, 1e-3), len));
    return d / len * amp * esWindSpring(age - len / max(p.x, 1e-3));
}
highp vec2 esWindFieldXZ(highp vec3 world) {
    highp vec2 at = world.xz;
    highp vec2 lean = vec2(0.0);
${passCalls('xz', '')}
${frontCalls('xz', '')}
    return lean;
}
highp vec2 esWindFieldXY(highp vec2 world) {
    highp vec2 at = world;
    highp vec2 lean = vec2(0.0);
${passCalls('xy', '')}
${frontCalls('xy', '')}
    return lean;
}
`;

/** The same field in WGSL. */
export const WIND_FIELD_WGSL = `
fn esWindSpring(s : f32) -> f32 {
    if (s <= 0.0 || s > ${WIND_RING.toFixed(1)}) { return 0.0; }
    return exp(-${SPRING.damping.toFixed(2)} * s) * sin(${SPRING.rate.toFixed(2)} * s) * ${SPRING.gain.toFixed(2)};
}
fn esWindPassAt(at : vec2f, pos : vec2f, vel : vec2f, radius : f32, age : f32) -> vec2f {
    if (radius <= 0.0) { return vec2f(0.0); }
    let f = clamp(1.0 - length(at - pos) / radius, 0.0, 1.0);
    return vel * (f * f * (3.0 - 2.0 * f)) * esWindSpring(age);
}
fn esWindFrontAt(at : vec2f, centre : vec2f, age : f32, p : vec4f) -> vec2f {
    if (p.y <= 0.0) { return vec2f(0.0); }
    let d = at - centre;
    let len = length(d);
    if (len < 1e-3) { return vec2f(0.0); }
    let amp = p.y * (1.0 - smoothstep(0.0, max(p.z, 1e-3), len));
    return d / len * amp * esWindSpring(age - len / max(p.x, 1e-3));
}
fn esWindFieldXZ(world : vec3f) -> vec2f {
    let at = world.xz;
    var lean = vec2f(0.0);
${passCalls('xz', 'mc.')}
${frontCalls('xz', 'mc.')}
    return lean;
}
fn esWindFieldXY(world : vec2f) -> vec2f {
    let at = world;
    var lean = vec2f(0.0);
${passCalls('xy', 'mc.')}
${frontCalls('xy', 'mc.')}
    return lean;
}
`;

/** The spring the shaders use, on the CPU. */
export function springAt(s: number): number {
    if (s <= 0 || s > WIND_RING) return 0;
    return Math.exp(-SPRING.damping * s) * Math.sin(SPRING.rate * s) * SPRING.gain;
}
