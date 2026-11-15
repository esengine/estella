// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';
import { skyEffectSource } from '../customSky';

const LAYERS = [[70, 0.5, 2.6, 5], [190, 0.42, 0.9, 6], [460, 0.3, 0.3, 4]] as const;

const GLSL = `float sfHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

vec3 sfLayer(vec3 dir, vec3 band, float cells, float keep, float gain, float steep) {
    vec3 a = abs(dir);
    float face;
    vec2 uv;
    if (a.x >= a.y && a.x >= a.z) { face = dir.x > 0.0 ? 0.0 : 1.0; uv = dir.yz / a.x; }
    else if (a.y >= a.z) { face = dir.y > 0.0 ? 2.0 : 3.0; uv = dir.xz / a.y; }
    else { face = dir.z > 0.0 ? 4.0 : 5.0; uv = dir.xy / a.z; }
    vec2 cell = floor((uv * 0.5 + 0.5) * cells);
    vec3 key = vec3(cell, face * 17.0 + cells);
    vec2 at = ((cell + 0.15 + 0.7 * vec2(sfHash(key + 11.0), sfHash(key + 23.0))) / cells) * 2.0 - 1.0;
    float side = mod(face, 2.0) < 0.5 ? 1.0 : -1.0;
    vec3 to = face < 1.5 ? vec3(side, at.x, at.y) : face < 3.5 ? vec3(at.x, side, at.y) : vec3(at.x, at.y, side);
    float spread = pow(1.0 + dot(at, at), -1.5);
    to = normalize(to);
    float along = dot(to, band);
    float crowd = mix(1.0, 0.25 + 2.2 * exp(-(along * along) / 0.12), u_band);
    if (sfHash(key) > keep * spread * crowd * u_density) return vec3(0.0);
    float mag = pow(sfHash(key + 53.0), steep);
    float width = esSkyPixel * u_size * (0.75 + 1.1 * mag);
    vec3 off = dir - to;
    float spot = exp(-dot(off, off) / (width * width));
    vec3 tint = mix(vec3(1.0), mix(vec3(1.0, 0.7, 0.46), vec3(0.6, 0.76, 1.0), sfHash(key + 71.0)), 0.65);
    return tint * (spot * gain * (0.05 + mag));
}

vec3 skyRadiance(vec3 dir, vec3 sun, vec3 sunColor, float env) {
    if (env > 0.5) return vec3(0.0);
    float tilt = radians(u_bandTilt), turn = radians(u_bandTurn);
    vec3 band = vec3(sin(tilt) * cos(turn), cos(tilt), sin(tilt) * sin(turn));
    vec3 col = vec3(0.0);
    if (u_sunSize > 0.0) {
        float off = acos(clamp(dot(dir, sun), -1.0, 1.0));
        float radius = radians(u_sunSize) * 0.5;
        float disc = 1.0 - smoothstep(radius - esSkyPixel, radius + esSkyPixel, off);
        float halo = u_sunGlow * (0.035 / (1.0 + pow(off / (radius * 2.2), 2.4)) + 0.004 / (1.0 + pow(off / (radius * 14.0), 2.0)));
        col += sunColor * (disc * 24.0 + halo * 24.0);
    }
${LAYERS.map(([cells, keep, gain, steep]) => `    col += sfLayer(dir, band, ${cells.toFixed(1)}, ${keep.toFixed(2)}, ${gain.toFixed(2)}, ${steep.toFixed(1)});`).join('\n')}
    return col;
}`;

const WGSL = `fn sfHash(q : vec3f) -> f32 {
    var p = fract(q * vec3f(0.1031, 0.1030, 0.0973));
    p = p + dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

fn sfLayer(dir : vec3f, band : vec3f, cells : f32, keep : f32, gain : f32, steep : f32) -> vec3f {
    let a = abs(dir);
    var face = 0.0;
    var uv = vec2f(0.0);
    if (a.x >= a.y && a.x >= a.z) { face = select(1.0, 0.0, dir.x > 0.0); uv = dir.yz / a.x; }
    else if (a.y >= a.z) { face = select(3.0, 2.0, dir.y > 0.0); uv = dir.xz / a.y; }
    else { face = select(5.0, 4.0, dir.z > 0.0); uv = dir.xy / a.z; }
    let cell = floor((uv * 0.5 + 0.5) * cells);
    let key = vec3f(cell, face * 17.0 + cells);
    let at = ((cell + 0.15 + 0.7 * vec2f(sfHash(key + 11.0), sfHash(key + 23.0))) / cells) * 2.0 - 1.0;
    let side = select(-1.0, 1.0, (face - 2.0 * floor(face / 2.0)) < 0.5);
    var to = vec3f(at.x, at.y, side);
    if (face < 1.5) { to = vec3f(side, at.x, at.y); } else if (face < 3.5) { to = vec3f(at.x, side, at.y); }
    let spread = pow(1.0 + dot(at, at), -1.5);
    to = normalize(to);
    let along = dot(to, band);
    let crowd = mix(1.0, 0.25 + 2.2 * exp(-(along * along) / 0.12), mc.u_band);
    if (sfHash(key) > keep * spread * crowd * mc.u_density) { return vec3f(0.0); }
    let mag = pow(sfHash(key + 53.0), steep);
    let width = esSkyPixel * mc.u_size * (0.75 + 1.1 * mag);
    let off = dir - to;
    let spot = exp(-dot(off, off) / (width * width));
    let tint = mix(vec3f(1.0), mix(vec3f(1.0, 0.7, 0.46), vec3f(0.6, 0.76, 1.0), sfHash(key + 71.0)), 0.65);
    return tint * (spot * gain * (0.05 + mag));
}

fn skyRadiance(dir : vec3f, sun : vec3f, sunColor : vec3f, env : f32) -> vec3f {
    if (env > 0.5) { return vec3f(0.0); }
    let tilt = radians(mc.u_bandTilt);
    let turn = radians(mc.u_bandTurn);
    let band = vec3f(sin(tilt) * cos(turn), cos(tilt), sin(tilt) * sin(turn));
    var col = vec3f(0.0);
    if (mc.u_sunSize > 0.0) {
        let off = acos(clamp(dot(dir, sun), -1.0, 1.0));
        let radius = radians(mc.u_sunSize) * 0.5;
        let disc = 1.0 - smoothstep(radius - esSkyPixel, radius + esSkyPixel, off);
        let halo = mc.u_sunGlow * (0.035 / (1.0 + pow(off / (radius * 2.2), 2.4)) + 0.004 / (1.0 + pow(off / (radius * 14.0), 2.0)));
        col = col + sunColor * (disc * 24.0 + halo * 24.0);
    }
${LAYERS.map(([cells, keep, gain, steep]) => `    col = col + sfLayer(dir, band, ${cells.toFixed(1)}, ${keep.toFixed(2)}, ${gain.toFixed(2)}, ${steep.toFixed(1)});`).join('\n')}
    return col;
}`;

const STARFIELD_UNIFORMS = [
    { name: 'u_density', label: 'Density', min: 0, max: 3, step: 0.01, defaultValue: 1 },
    { name: 'u_size', label: 'Size (pixels)', min: 0.5, max: 4, step: 0.01, defaultValue: 1 },
    { name: 'u_band', label: 'Band', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    { name: 'u_bandTilt', label: 'Band Tilt', min: -90, max: 90, step: 1, defaultValue: 25 },
    { name: 'u_bandTurn', label: 'Band Turn', min: 0, max: 360, step: 1, defaultValue: 0 },
    { name: 'u_sunSize', label: 'Sun Size (degrees)', min: 0, max: 10, step: 0.01, defaultValue: 0 },
    { name: 'u_sunGlow', label: 'Sun Glow', min: 0, max: 4, step: 0.01, defaultValue: 1 },
];

export const starfieldEffects = {
    createStarfield(): ShaderHandle {
        return Material.compileShader(skyEffectSource({ type: 'starfield', label: 'Starfield', over: true, uniforms: STARFIELD_UNIFORMS, glsl: GLSL, wgsl: WGSL }));
    },
};
