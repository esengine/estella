// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterfallShader.ts
 * @brief   The Waterfall shader: a sheet of falling water that leaves the lip as glass, tears into strands and ends as veils.
 *
 * @details It reads what a `Waterfall`'s mesh carries (waterfall.ts): across the sheet in uv.x, the seconds fallen in uv.y, the share of the
 *          fall done in the colour's red, the sheet's own number in its green. A pattern keeps its (seconds fallen - now), so it rides down
 *          with the water at the water's own speed and stretches as the water does.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';

const WATERFALL = `#pragma shader "Waterfall"
#pragma version 300 es
#pragma domain Lit
// The water at the lip, before it breaks, and the white it breaks into.
#pragma param u_water color default(0.30,0.55,0.52,1)
#pragma param u_foam color default(0.90,0.94,0.98,1)
// How many strands lie across half the sheet, and how many times in a second of its fall a strand changes: fewer is longer strands.
// The pattern always rides down with the water.
#pragma param u_strands float default(3.75) range(0.5,400) ui(slider)
#pragma param u_run float default(0.97) range(0,40) ui(slider)
// How much of the sheet is gone at its foot (0 a whole sheet to the bottom, 1 nothing left of it), and how far down it is torn that much.
#pragma param u_veil float default(0.75) range(0,1) ui(slider)
#pragma param u_tearBy float default(1) range(0.05,1) ui(slider)
#pragma param u_opacity float default(1) range(0,1) ui(slider)
#pragma param u_roughness float default(0.6) range(0.02,1) ui(slider)
// How much of the light goes through the sheet: a veil of water is lit from whichever side the sun is on, not as a wall facing it.
// 0 lights it as an opaque surface.
#pragma param u_translucency float default(1) range(0,1) ui(slider)

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
layout(location = 2) out vec4 fragAlbedo;
#else
out vec4 fragColor;
#endif

float fallHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float fallNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(mix(fallHash(i), fallHash(i + vec2(1.0, 0.0)), w.x), mix(fallHash(i + vec2(0.0, 1.0)), fallHash(i + vec2(1.0, 1.0)), w.x), w.y);
}

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 N = normalize(v_worldNormal);
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
    highp vec3 N = vec3(0.0, 1.0, 0.0);
#endif
    highp vec3 V = viewDirection(P);
    if (dot(N, V) < 0.0) N = -N;
    float side = v_texCoord.x * 2.0 - 1.0, k = clamp(v_color.r, 0.0, 1.0), own = v_color.g;
    float across = (side + own) * u_strands;
    float along = (v_texCoord.y - u_time.x) * u_run;
    float strands = fallNoise(vec2(across, along)) * 0.55 + fallNoise(vec2(across * 2.5 + 9.0, along * 2.1)) * 0.45;
    float clumps = fallNoise(vec2(across / 3.0 + 3.0, along * 0.45));
    // A glassy lip that tears into strands, then into veils.
    float body = mix(1.0, 0.74, smoothstep(0.05, 0.7, k));
    float cut = mix(-0.05, u_veil, smoothstep(0.0, u_tearBy, k)) - (clumps - 0.5) * 0.35;
    float alpha = smoothstep(cut, cut + 0.22, strands) * body + (1.0 - smoothstep(0.0, 0.06, k)) * 0.9;
    alpha *= pow(max(1.0 - side * side, 0.0), mix(0.35, 0.9, k));
    alpha *= 1.0 - smoothstep(0.90, 1.0, k) * 0.6;
    alpha = clamp(alpha * u_opacity, 0.0, 1.0);
    if (alpha < 0.02) discard;
    vec3 albedo = mix(u_water.rgb, u_foam.rgb, smoothstep(0.0, 0.10, k) * (0.6 + 0.4 * strands));
    SurfaceExt ext = surfaceExtNone(N);
    if (u_translucency > 0.0) {
        ext.scatter = vec4(albedo, u_translucency * 0.5);
        ext.trans = vec4(u_translucency, 0.0, 0.0, 0.0);
    }
    vec3 lit = applyLightingSurface(albedo, N, P, V, 0.0, u_roughness, 0.5, 1.0, ext);
    fragColor = vec4(lit, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(0.5, 0.5, u_roughness, 0.0);
    fragAlbedo = vec4(albedo, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
fn fallHash(p : vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn fallNoise(p : vec2f) -> f32 {
    let i = floor(p); let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);
    return mix(mix(fallHash(i), fallHash(i + vec2f(1.0, 0.0)), w.x), mix(fallHash(i + vec2f(0.0, 1.0)), fallHash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
    @location(2) albedo : vec4f,
};
@fragment fn fs_main(v : VSOut) -> FragOut {
#else
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
#endif
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_NORMALS
    let P = v.v_worldXYZ;
    var N = normalize(v.v_worldNormal);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    var N = vec3f(0.0, 1.0, 0.0);
#endif
    let V = viewDirection(P);
    if (dot(N, V) < 0.0) { N = -N; }
    let side = v.v_texCoord.x * 2.0 - 1.0;
    let k = clamp(v.v_color.r, 0.0, 1.0);
    let across = (side + v.v_color.g) * mc.u_strands;
    let along = (v.v_texCoord.y - tc.u_time.x) * mc.u_run;
    let strands = fallNoise(vec2f(across, along)) * 0.55 + fallNoise(vec2f(across * 2.5 + 9.0, along * 2.1)) * 0.45;
    let clumps = fallNoise(vec2f(across / 3.0 + 3.0, along * 0.45));
    let body = mix(1.0, 0.74, smoothstep(0.05, 0.7, k));
    let cut = mix(-0.05, mc.u_veil, smoothstep(0.0, mc.u_tearBy, k)) - (clumps - 0.5) * 0.35;
    var alpha = smoothstep(cut, cut + 0.22, strands) * body + (1.0 - smoothstep(0.0, 0.06, k)) * 0.9;
    alpha = alpha * pow(max(1.0 - side * side, 0.0), mix(0.35, 0.9, k));
    alpha = alpha * (1.0 - smoothstep(0.90, 1.0, k) * 0.6);
    alpha = clamp(alpha * mc.u_opacity, 0.0, 1.0);
    if (alpha < 0.02) { discard; }
    let albedo = mix(mc.u_water.rgb, mc.u_foam.rgb, smoothstep(0.0, 0.10, k) * (0.6 + 0.4 * strands));
    var ext = surfaceExtNone(N);
    if (mc.u_translucency > 0.0) {
        ext.scatter = vec4f(albedo, mc.u_translucency * 0.5);
        ext.trans = vec4f(mc.u_translucency, 0.0, 0.0, 0.0);
    }
    let lit = applyLightingSurface(albedo, N, P, V, 0.0, mc.u_roughness, 0.5, 1.0, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, alpha);
    frag.surface = vec4f(0.5, 0.5, mc.u_roughness, 0.0);
    frag.albedo = vec4f(albedo, 1.0);
    return frag;
#else
    return vec4f(lit, alpha);
#endif
}
#pragma end
`;

export const WATERFALL_SHADER_TEMPLATE = makeBuiltinShaderTemplate('waterfall', 'Waterfall',
    'Falling water for a Waterfall: glass at the lip, strands and then veils on the way down, riding down with the water.', WATERFALL);
