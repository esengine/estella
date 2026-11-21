// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { BrushShape, BrushCurve } from './sculpt';

export const brushShapeId: Record<BrushShape, number> = { circle: 0, square: 1, diamond: 2 };
export const brushCurveId: Record<BrushCurve, number> = { smooth: 0, linear: 1, spherical: 2, tip: 3 };

// The footprint belongs to the material instance drawing the selected ground. It is
// applied after lighting and after reading baked pages, never to the pages themselves.
export const BRUSH_PARAMS = `#pragma param u_sculptBrush vec4 default(0,0,0,0)
#pragma param u_sculptProfile vec2 default(0,0)
#pragma param u_sculptMapping vec4 default(0,0,0,0)
#pragma param u_sculptUV vec2 default(0,0)
#pragma param u_sculptDetail vec4 default(0,0,0,0)
#pragma param u_sculptMask texture default(white) texel(data)
`;

export const BRUSH_GLSL = `vec3 tnBrush(vec3 lit, vec2 worldXZ) {
    if (u_sculptBrush.z <= 0.0) return lit;
    vec2 p = abs(worldXZ - u_sculptBrush.xy) / u_sculptBrush.z;
    float d = length(p);
    if (u_sculptProfile.x == 1.0) d = max(p.x, p.y);
    if (u_sculptProfile.x == 2.0) d = p.x + p.y;
    vec2 delta = worldXZ - u_sculptBrush.xy;
    vec2 uv = u_sculptUV + vec2(dot(delta, u_sculptMapping.xy), dot(delta, u_sculptMapping.zw));
    float kind = u_sculptDetail.x;
    if (kind == 1.0) d = 2.0 * max(abs(uv.x - 0.5), abs(uv.y - 0.5));
    if (kind == 3.0) d = max(abs(delta.x) / u_sculptDetail.z, abs(delta.y) / u_sculptDetail.w);
    float core = 1.0 - u_sculptBrush.w;
    float t = clamp((1.0 - d) / max(u_sculptBrush.w, 0.000001), 0.0, 1.0);
    float weight = t * t * (3.0 - 2.0 * t);
    if (u_sculptProfile.y == 1.0) weight = t;
    if (u_sculptProfile.y == 2.0) weight = sqrt(t * (2.0 - t));
    if (u_sculptProfile.y == 3.0) weight = 1.0 - sqrt(1.0 - t * t);
    if (kind == 1.0 || kind == 2.0) {
        vec2 sampleUV = uv;
        if (kind == 1.0) sampleUV = clamp(uv, u_sculptDetail.zw, vec2(1.0) - u_sculptDetail.zw);
        vec4 mask = textureLod(u_sculptMask, sampleUV, 0.0);
        weight *= mask[int(u_sculptDetail.y)];
    }
    float gap = abs(d - 1.0);
    if (core > 0.0 && core < 1.0) gap = min(gap, abs(d - core));
    float pixels = gap / clamp(fwidth(d), 0.000001, 0.08);
    if (kind == 3.0) {
        vec3 fill = mix(lit, vec3(1.0, 0.48, 0.035), 0.42 * weight);
        return mix(fill, vec3(1.0, 0.54, 0.035), 1.0 - smoothstep(0.4, 1.45, pixels));
    }
    vec3 ink = mix(lit, vec3(0.43, 0.32, 0.81), 0.42 * weight);
    ink = mix(ink, vec3(0.08, 0.06, 0.13), 0.45 * (1.0 - smoothstep(0.8, 2.0, pixels)));
    return mix(ink, vec3(0.95, 0.92, 1.0), 0.92 * (1.0 - smoothstep(0.35, 1.15, pixels)));
}`;

export const BRUSH_WGSL = `fn tnBrush(lit: vec3f, worldXZ: vec2f) -> vec3f {
    if (mc.u_sculptBrush.z <= 0.0) { return lit; }
    let p = abs(worldXZ - mc.u_sculptBrush.xy) / mc.u_sculptBrush.z;
    var d = length(p);
    if (mc.u_sculptProfile.x == 1.0) { d = max(p.x, p.y); }
    if (mc.u_sculptProfile.x == 2.0) { d = p.x + p.y; }
    let delta = worldXZ - mc.u_sculptBrush.xy;
    let uv = mc.u_sculptUV + vec2f(dot(delta, mc.u_sculptMapping.xy), dot(delta, mc.u_sculptMapping.zw));
    let kind = mc.u_sculptDetail.x;
    if (kind == 1.0) { d = 2.0 * max(abs(uv.x - 0.5), abs(uv.y - 0.5)); }
    if (kind == 3.0) { d = max(abs(delta.x) / mc.u_sculptDetail.z, abs(delta.y) / mc.u_sculptDetail.w); }
    let core = 1.0 - mc.u_sculptBrush.w;
    let t = clamp((1.0 - d) / max(mc.u_sculptBrush.w, 0.000001), 0.0, 1.0);
    var weight = t * t * (3.0 - 2.0 * t);
    if (mc.u_sculptProfile.y == 1.0) { weight = t; }
    if (mc.u_sculptProfile.y == 2.0) { weight = sqrt(t * (2.0 - t)); }
    if (mc.u_sculptProfile.y == 3.0) { weight = 1.0 - sqrt(1.0 - t * t); }
    if (kind == 1.0 || kind == 2.0) {
        var sampleUV = uv;
        if (kind == 1.0) { sampleUV = clamp(uv, mc.u_sculptDetail.zw, vec2f(1.0) - mc.u_sculptDetail.zw); }
        let mask = textureSampleLevel(u_sculptMask, u_sculptMask_s, sampleUV, 0.0);
        weight *= mask[i32(mc.u_sculptDetail.y)];
    }
    var gap = abs(d - 1.0);
    if (core > 0.0 && core < 1.0) { gap = min(gap, abs(d - core)); }
    let pixels = gap / clamp(fwidth(d), 0.000001, 0.08);
    if (kind == 3.0) {
        let fill = mix(lit, vec3f(1.0, 0.48, 0.035), 0.42 * weight);
        return mix(fill, vec3f(1.0, 0.54, 0.035), 1.0 - smoothstep(0.4, 1.45, pixels));
    }
    var ink = mix(lit, vec3f(0.43, 0.32, 0.81), 0.42 * weight);
    ink = mix(ink, vec3f(0.08, 0.06, 0.13), 0.45 * (1.0 - smoothstep(0.8, 2.0, pixels)));
    return mix(ink, vec3f(0.95, 0.92, 1.0), 0.92 * (1.0 - smoothstep(0.35, 1.15, pixels)));
}`;
