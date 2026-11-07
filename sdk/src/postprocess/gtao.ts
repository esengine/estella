// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gtao.ts
 * @brief   Ground-truth ambient occlusion: the occlusion pass of the `gtao` effect.
 * @details The `ssao` effect asks, of a ring of nearby points, how many stand above the surface; this asks what a person
 *          standing on the surface would see. For a few slice planes through the pixel it finds the highest the horizon
 *          climbs on each side (a march over the depth buffer) and integrates the visible arc under it, cosine-weighted by
 *          the surface's own normal (Jimenez et al., "Practical Realtime Strategies for Accurate Indirect Occlusion"). The
 *          result has no tuning constant standing in for a bias, which is the visible difference: a flat floor stays white
 *          and a crease darkens by how closed it actually is. The blur and the composite are the `ssao` effect's own.
 */
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { SSAO_GLSL, SSAO_WGSL } from './sources/shared';

export const gtaoPasses = {
    createGtaoAo(): ShaderHandle {
        const source = `#pragma shader "PP GTAO"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(80) range(0.01,500)
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_power float default(1.4) range(0.5,4)
#pragma param u_thickness float default(0.5) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const int SLICES = 3;
const int STEPS = 6;
const float PI = 3.14159265359;
const float HALF_PI = 1.57079632679;
// How far a horizon falls back, at full thickness, each time what lies beyond the thing that raised it is lower again. A wall goes on standing and keeps it; a strand does not.
const float FALL_BACK = 0.6;

float fastAcos(float x) { return acos(clamp(x, -1.0, 1.0)); }

void main() {
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    if (d >= 1.0) { fragColor = vec4(1.0); return; }
    vec2 cuv = uvOfTexel(c, size);
    vec3 P = worldFromDepth(cuv, d);

    // The nearer neighbour on each axis, as the SSAO normal is built: across a silhouette the far side is another surface.
    float dl = depthAt(c + ivec2(-1, 0), size);
    float dr = depthAt(c + ivec2( 1, 0), size);
    float dd = depthAt(c + ivec2(0, -1), size);
    float du = depthAt(c + ivec2(0,  1), size);
    vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P : P - worldAt(c + ivec2(-1, 0), size);
    vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P : P - worldAt(c + ivec2(0, -1), size);
    vec3 N = normalize(cross(ax, ay));
    vec3 V = viewDirection(P);
    if (dot(N, V) < 0.0) N = -N;
    // A strand a pixel wide: both neighbours on an axis lie the same way off it, far off. Depth cannot say which way such a thing faces, so it faces the eye.
    float texelW = max(length(worldFromDepth(cuv + vec2(1.0 / float(size.x), 0.0), d) - P), 1e-6);
    float lx = dot(worldAt(c + ivec2(-1, 0), size) - P, V), rx = dot(worldAt(c + ivec2(1, 0), size) - P, V);
    float ly = dot(worldAt(c + ivec2(0, -1), size) - P, V), ry = dot(worldAt(c + ivec2(0, 1), size) - P, V);
    if ((lx * rx > 0.0 && min(abs(lx), abs(rx)) > texelW * 3.0) || (ly * ry > 0.0 && min(abs(ly), abs(ry)) > texelW * 3.0)) N = V;

    // What a texel step is in the world along each screen axis: the frame the slices are laid in.
    vec3 right = normalize(worldFromDepth(cuv + vec2(1.0 / float(size.x), 0.0), d) - P);
    vec3 up = normalize(worldFromDepth(cuv + vec2(0.0, 1.0 / float(size.y)), d) - P);
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(size.x), 0.0), d) - P), 1e-6);
    float radiusTexels = clamp(u_radius / worldPerTexel, 3.0, 128.0);

    // A 4x4 pattern of slice angles and march offsets, keyed to this pass's own pixel (c counts full-resolution texels).
    ivec2 rp = c / 2;
    int idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    float turn = float(idx - (idx / 16) * 16) / 16.0;
    float jitter = fract(float(((rp.x * 5 + rp.y * 3) & 15)) * 0.0625 + 0.03125);

    float visibility = 0.0;
    for (int slice = 0; slice < SLICES; ++slice) {
        float phi = (float(slice) + turn) * (PI / float(SLICES));
        vec2 dir = vec2(cos(phi), sin(phi));
        vec3 dirW = right * dir.x + up * dir.y;
        // The slice plane holds the view vector and this direction; its normal is the axis the normal is projected off.
        vec3 ortho = dirW - V * dot(dirW, V);
        vec3 axis = normalize(cross(ortho, V));
        vec3 projN = N - axis * dot(N, axis);
        float projLen = length(projN);
        float signN = sign(dot(ortho, projN));
        float cosN = clamp(dot(projN, V) / max(projLen, 1e-5), 0.0, 1.0);
        float n = signN * fastAcos(cosN);

        float lowCos0 = cos(n + HALF_PI);
        float lowCos1 = cos(n - HALF_PI);
        float hCos0 = lowCos0;
        float hCos1 = lowCos1;
        for (int i = 0; i < STEPS; ++i) {
            float f = (float(i) + jitter) / float(STEPS);
            f = f * f + 1.0 / radiusTexels;
            vec2 off = dir * (f * radiusTexels);
            ivec2 s0 = c + ivec2(floor(off + 0.5));
            ivec2 s1 = c - ivec2(floor(off + 0.5));
            float z0 = depthAt(s0, size);
            float z1 = depthAt(s1, size);
            if (z0 < 1.0) {
                vec3 delta = worldAt(s0, size) - P;
                float len = length(delta);
                // Past the radius a sample is another surface: faded, not cut, or the term pops as geometry crosses it.
                float weight = clamp(2.0 * (1.0 - len / u_radius), 0.0, 1.0);
                float shc = dot(delta, V) / max(len, 1e-5);
                hCos0 = shc < hCos0 && weight > 0.0 ? mix(hCos0, lowCos0, FALL_BACK * u_thickness) : max(hCos0, mix(lowCos0, shc, weight));
            }
            if (z1 < 1.0) {
                vec3 delta = worldAt(s1, size) - P;
                float len = length(delta);
                float weight = clamp(2.0 * (1.0 - len / u_radius), 0.0, 1.0);
                float shc = dot(delta, V) / max(len, 1e-5);
                hCos1 = shc < hCos1 && weight > 0.0 ? mix(hCos1, lowCos1, FALL_BACK * u_thickness) : max(hCos1, mix(lowCos1, shc, weight));
            }
        }
        // Thin occluders: a horizon that has just climbed a wall does not climb forever, so it falls back a little.
        hCos0 = mix(hCos0, lowCos0, u_thickness * 0.35);
        hCos1 = mix(hCos1, lowCos1, u_thickness * 0.35);

        float h0 = -fastAcos(hCos1);
        float h1 = fastAcos(hCos0);
        h0 = n + clamp(h0 - n, -HALF_PI, HALF_PI);
        h1 = n + clamp(h1 - n, -HALF_PI, HALF_PI);
        float arc0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
        float arc1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
        visibility += projLen * (arc0 + arc1);
    }
    visibility /= float(SLICES);
    float ao = 1.0 - clamp((1.0 - clamp(visibility, 0.0, 1.0)) * u_intensity, 0.0, 1.0);
    fragColor = vec4(vec3(pow(ao, u_power)), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const SLICES : i32 = 3;
const STEPS : i32 = 6;
const PI : f32 = 3.14159265359;
const HALF_PI : f32 = 1.57079632679;
const FALL_BACK : f32 = 0.6;

fn fastAcos(x : f32) -> f32 { return acos(clamp(x, -1.0, 1.0)); }

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    if (d >= 1.0) { return vec4f(1.0); }
    let cuv = uvOfTexel(c, size);
    let P = worldFromDepth(cuv, d);

    let dl = depthAt(c + vec2i(-1, 0), size);
    let dr = depthAt(c + vec2i( 1, 0), size);
    let dd = depthAt(c + vec2i(0, -1), size);
    let du = depthAt(c + vec2i(0,  1), size);
    var ax = P - worldAt(c + vec2i(-1, 0), size);
    if (abs(dr - d) < abs(dl - d)) { ax = worldAt(c + vec2i(1, 0), size) - P; }
    var ay = P - worldAt(c + vec2i(0, -1), size);
    if (abs(du - d) < abs(dd - d)) { ay = worldAt(c + vec2i(0, 1), size) - P; }
    var N = normalize(cross(ax, ay));
    let V = viewDirection(P);
    if (dot(N, V) < 0.0) { N = -N; }
    let texelW = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(size.x), 0.0), d) - P), 1e-6);
    let lx = dot(worldAt(c + vec2i(-1, 0), size) - P, V);
    let rx = dot(worldAt(c + vec2i(1, 0), size) - P, V);
    let ly = dot(worldAt(c + vec2i(0, -1), size) - P, V);
    let ry = dot(worldAt(c + vec2i(0, 1), size) - P, V);
    if ((lx * rx > 0.0 && min(abs(lx), abs(rx)) > texelW * 3.0) || (ly * ry > 0.0 && min(abs(ly), abs(ry)) > texelW * 3.0)) { N = V; }

    let right = normalize(worldFromDepth(cuv + vec2f(1.0 / f32(size.x), 0.0), d) - P);
    let up = normalize(worldFromDepth(cuv + vec2f(0.0, 1.0 / f32(size.y)), d) - P);
    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(size.x), 0.0), d) - P), 1e-6);
    let radiusTexels = clamp(mc.u_radius / worldPerTexel, 3.0, 128.0);

    let rp = c / 2;
    let idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    let turn = f32(idx - (idx / 16) * 16) / 16.0;
    let jitter = fract(f32((rp.x * 5 + rp.y * 3) & 15) * 0.0625 + 0.03125);

    var visibility = 0.0;
    for (var slice : i32 = 0; slice < SLICES; slice = slice + 1) {
        let phi = (f32(slice) + turn) * (PI / f32(SLICES));
        let dir = vec2f(cos(phi), sin(phi));
        let dirW = right * dir.x + up * dir.y;
        let ortho = dirW - V * dot(dirW, V);
        let axis = normalize(cross(ortho, V));
        let projN = N - axis * dot(N, axis);
        let projLen = length(projN);
        let signN = sign(dot(ortho, projN));
        let cosN = clamp(dot(projN, V) / max(projLen, 1e-5), 0.0, 1.0);
        let n = signN * fastAcos(cosN);

        let lowCos0 = cos(n + HALF_PI);
        let lowCos1 = cos(n - HALF_PI);
        var hCos0 = lowCos0;
        var hCos1 = lowCos1;
        for (var i : i32 = 0; i < STEPS; i = i + 1) {
            var f = (f32(i) + jitter) / f32(STEPS);
            f = f * f + 1.0 / radiusTexels;
            let off = dir * (f * radiusTexels);
            let p0 = c + vec2i(floor(off + vec2f(0.5)));
            let p1 = c - vec2i(floor(off + vec2f(0.5)));
            let z0 = depthAt(p0, size);
            let z1 = depthAt(p1, size);
            if (z0 < 1.0) {
                let delta = worldAt(p0, size) - P;
                let len = length(delta);
                let weight = clamp(2.0 * (1.0 - len / mc.u_radius), 0.0, 1.0);
                let shc = dot(delta, V) / max(len, 1e-5);
                if (shc < hCos0 && weight > 0.0) { hCos0 = mix(hCos0, lowCos0, FALL_BACK * mc.u_thickness); } else { hCos0 = max(hCos0, mix(lowCos0, shc, weight)); }
            }
            if (z1 < 1.0) {
                let delta = worldAt(p1, size) - P;
                let len = length(delta);
                let weight = clamp(2.0 * (1.0 - len / mc.u_radius), 0.0, 1.0);
                let shc = dot(delta, V) / max(len, 1e-5);
                if (shc < hCos1 && weight > 0.0) { hCos1 = mix(hCos1, lowCos1, FALL_BACK * mc.u_thickness); } else { hCos1 = max(hCos1, mix(lowCos1, shc, weight)); }
            }
        }
        hCos0 = mix(hCos0, lowCos0, mc.u_thickness * 0.35);
        hCos1 = mix(hCos1, lowCos1, mc.u_thickness * 0.35);

        var h0 = -fastAcos(hCos1);
        var h1 = fastAcos(hCos0);
        h0 = n + clamp(h0 - n, -HALF_PI, HALF_PI);
        h1 = n + clamp(h1 - n, -HALF_PI, HALF_PI);
        let arc0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
        let arc1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
        visibility = visibility + projLen * (arc0 + arc1);
    }
    visibility = visibility / f32(SLICES);
    let ao = 1.0 - clamp((1.0 - clamp(visibility, 0.0, 1.0)) * mc.u_intensity, 0.0, 1.0);
    return vec4f(vec3f(pow(ao, mc.u_power)), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};
