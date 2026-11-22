// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

namespace esengine {

// Forward lighting reads the refracted flux at the opaque receiver. Compare each bilinear
// tap at its own depth so flux on a fish cannot leak through its silhouette to the bed.
// Neutral flux is one. Interpolating the signed change keeps an empty beam dark.
inline constexpr char WATER_SUN_GLSL[] = R"(
#ifdef ES_SURFACE_3D
precision highp float;
precision highp int;
uniform highp sampler2D u_waterSunField;
void waterIncidentSun(inout Light lamp, vec3 position) {
    float depth = u_waterDepth.x - position.y;
    float reach = u_waterDepth.z - u_waterDepth.y;
    vec2 uv = (position.xz + u_waterSun.xy * depth - u_waterRect.xy) / u_waterRect.z;
    vec2 edge = min(uv, 1.0 - uv);
    float fade = smoothstep(0.025, 0.09, min(edge.x, edge.y))
               * (1.0 - smoothstep(reach - u_waterDepth.w, reach, depth));
    if (fade <= 0.0 || depth < -u_waterDepth.y) return;
    int n = textureSize(u_waterSunField, 0).y;
    vec2 grid = uv * float(n) - 0.5;
    ivec2 cell = ivec2(floor(grid));
    vec2 fraction = fract(grid);
    vec3 sun = -normalize(lamp.posDir.xyw);
    vec3 bend = vec3(0.0);
    float change = 0.0;
    for (int i = 0; i < 4; ++i) {
        ivec2 corner = ivec2(i & 1, i >> 1);
        ivec2 at = clamp(cell + corner, ivec2(0), ivec2(n - 1));
        vec4 hit = texelFetch(u_waterSunField, at + ivec2(n, 0), 0);
        float gain = max((255.0 * hit.a - 128.0) * (4.0/127.0), 0.0);
        if (gain <= 0.0) continue;
        float z = 2.0 * dot(hit.rgb, vec3(1.0, 1.0/255.0, 1.0/65025.0)) - 1.0;
        float behind = depth - (z * u_waterDepth.z - u_waterDepth.y);
        float tolerance = 2.5 * u_waterRect.w;
        if (behind < -tolerance) continue;
        vec4 m = vec4(0.0);
        if (behind <= tolerance) m = texelFetch(u_waterSunField, at, 0) * (255.0/32.0);
        vec2 w = mix(1.0 - fraction, fraction, vec2(corner));
        float weight = w.x * w.y;
        // Unit gain reproduces measured flux. Higher artistic contrast preserves
        // positive light between folds and cannot turn a lit patch into a clipped black plateau.
        float contrast = (m.r - 1.0) / (m.r + 1.0);
        float flux = mix(1.0, m.r, min(gain, 1.0)) * (1.0 + (1.0 - 1.0/max(gain, 1.0)) * contrast);
        change += weight * (flux - 1.0);
        if (m.r > 1e-4) {
            vec2 h = clamp(2.0 * m.gb / m.r - 1.0, -1.0, 1.0);
            vec3 ray = normalize(vec3(h.x, sqrt(max(1.0 - dot(h,h), 1e-5)), h.y));
            bend += weight * min(gain, 1.0) * (ray - sun);
        }
    }
    vec3 direction = normalize(sun + fade * bend);
    lamp.posDir.xyw = -direction;
    // The atlas measures flux per horizontal area. Convert to incident radiance
    // before the receiver's own BRDF applies its actual normal and material response.
    lamp.color.rgb *= max(0.0, 1.0 + fade * change) * sun.y / max(direction.y, 1e-5);
}
#endif
)";

inline constexpr char WATER_SUN_WGSL[] = R"(
#ifdef ES_SURFACE_3D
@group(1) @binding(32) var u_waterSunField : texture_2d<f32>;
fn waterIncidentSun(input : Light, position : vec3f) -> Light {
    var lamp = input;
    let depth = lc.u_waterDepth.x - position.y;
    let reach = lc.u_waterDepth.z - lc.u_waterDepth.y;
    let uv = (position.xz + lc.u_waterSun.xy * depth - lc.u_waterRect.xy) / lc.u_waterRect.z;
    let edge = min(uv, 1.0 - uv);
    let fade = smoothstep(0.025, 0.09, min(edge.x, edge.y))
             * (1.0 - smoothstep(reach - lc.u_waterDepth.w, reach, depth));
    if (fade <= 0.0 || depth < -lc.u_waterDepth.y) { return lamp; }
    let n = i32(textureDimensions(u_waterSunField, 0).y);
    let grid = uv * f32(n) - 0.5;
    let cell = vec2i(floor(grid));
    let fraction = fract(grid);
    let sun = -normalize(lamp.posDir.xyw);
    var bend = vec3f(0.0);
    var change = 0.0;
    for (var i = 0; i < 4; i++) {
        let corner = vec2i(i & 1, i >> 1u);
        let at = clamp(cell + corner, vec2i(0), vec2i(n - 1));
        let hit = textureLoad(u_waterSunField, at + vec2i(n, 0), 0);
        let gain = max((255.0 * hit.a - 128.0) * (4.0/127.0), 0.0);
        if (gain <= 0.0) { continue; }
        let z = 2.0 * dot(hit.rgb, vec3f(1.0, 1.0/255.0, 1.0/65025.0)) - 1.0;
        let behind = depth - (z * lc.u_waterDepth.z - lc.u_waterDepth.y);
        let tolerance = 2.5 * lc.u_waterRect.w;
        if (behind < -tolerance) { continue; }
        var m = vec4f(0.0);
        if (behind <= tolerance) { m = textureLoad(u_waterSunField, at, 0) * (255.0/32.0); }
        let w = mix(1.0 - fraction, fraction, vec2f(corner));
        let weight = w.x * w.y;
        let contrast = (m.r - 1.0) / (m.r + 1.0);
        let flux = mix(1.0, m.r, min(gain, 1.0)) * (1.0 + (1.0 - 1.0/max(gain, 1.0)) * contrast);
        change += weight * (flux - 1.0);
        if (m.r > 1e-4) {
            let h = clamp(2.0 * m.gb / m.r - 1.0, vec2f(-1), vec2f(1));
            let ray = normalize(vec3f(h.x, sqrt(max(1.0 - dot(h,h), 1e-5)), h.y));
            bend += weight * min(gain, 1.0) * (ray - sun);
        }
    }
    let direction = normalize(sun + fade * bend);
    lamp.posDir = vec4f(-direction.xy, lamp.posDir.z, -direction.z);
    lamp.color = vec4f(lamp.color.rgb * (max(0.0, 1.0 + fade * change) * sun.y / max(direction.y, 1e-5)), lamp.color.a);
    return lamp;
}
#endif
)";
}  // namespace esengine
