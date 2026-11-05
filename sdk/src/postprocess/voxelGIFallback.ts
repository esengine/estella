// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    voxelGIFallback.ts
 * @brief   The Voxel GI effect for a device with no compute stage (WebGL2): the same cache, built by fragment passes.
 * @details The WebGPU effect keeps a world-space grid of voxels in a storage buffer and scatters the lit picture into it with atomics.
 *          A fragment shader can only write the texel it is running for, so the cache here is a texture and it is built the other way
 *          round: every texel of an atlas is a voxel, and it asks the picture what stands in it (it projects itself to the screen, looks
 *          at the depth buffer around where it lands, and takes the radiance and the facing of the pixels whose surface is inside it).
 *          What it held last frame is carried over, shifted when the window moved with the camera, and faded.
 *
 *          Three passes: `gi_voxels` (the atlas, which the engine keeps from frame to frame), `gi_gather` (rays marched through the
 *          atlas from each visible surface, at half size, blended with the last frames) and `gi_apply` (the gathered light over the
 *          picture, upsampled with the depth). The gather and the apply are the compute kernels' own, in GLSL.
 *
 *          The atlas is 2048 x 1024 half floats: 128 slices of 128 x 64 voxels laid out 16 across and 8 down, radiance and a sample
 *          count in the top half and facing and a count in the bottom. The last texel of the bottom half is not a voxel: it holds the
 *          window's origin (mod 1024, which half floats hold exactly) and the voxel size, which is how the next frame knows how far the
 *          window moved.
 *
 *          It is the same idea at a lower price, and says so: the gather samples the depth buffer around each voxel instead of
 *          being scattered into, so a surface seen at a grazing angle is thinner in the cache than in the compute version.
 */
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { SSAO_GLSL, GBUFFER_GLSL } from './sources/shared';

export { VOXEL_ATLAS } from './voxelAtlas';
import { VOXEL_ATLAS } from './voxelAtlas';

const COMMON = `
const ivec3 DIMS = ivec3(128, 64, 128);
const ivec2 META = ivec2(2047, 1023);
ivec2 slotTexel(ivec3 s, int region) { return ivec2((s.z & 15) * 128 + s.x, region * 512 + (s.z >> 4) * 64 + s.y); }
ivec3 windowOrigin(float vs) {
    vec3 eye = u_camera.w > 0.5 ? u_camera.xyz : worldFromDepth(vec2(0.5), 0.5);
    return ivec3(floor(eye / vs)) - DIMS / 2;
}
float hash1(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}`;

export const voxelGIFallback = {
    /** The atlas: carries the last frame's, shifted and faded, and adds what the picture shows stands in each voxel. */
    createVoxels(): ShaderHandle {
        const source = `#pragma shader "PP VoxelGI Voxels"
#pragma version 300 es
#pragma domain PostProcess
#pragma highprecision
#pragma gbuffer
#pragma param u_voxelSize float default(40) range(0.01,400)
#pragma param u_decay float default(0.93) range(0,0.99)
#pragma param u_maxBounce float default(3) range(0.5,16)
#pragma param u_feedback texture default(black)

#pragma fragment
precision highp float;
precision highp int;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
uniform highp sampler2D u_gbuffer;
out vec4 fragColor;

${SSAO_GLSL}
${GBUFFER_GLSL}
${COMMON}

void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    float vs = max(u_voxelSize, 1.0);
    ivec3 origin = windowOrigin(vs);
    if (t == META) { fragColor = vec4(mod(vec3(origin), 1024.0), vs); return; }
    vec4 meta = texelFetch(u_feedback, META, 0);

    int region = t.y >= 512 ? 1 : 0;
    int y = t.y - region * 512;
    ivec3 slot = ivec3(t.x % 128, y % 64, (y / 64) * 16 + t.x / 128);
    ivec3 cell = origin + slot;

    // What the last frame held for this cell, where the window has moved: the cell was at its old slot, this many over.
    vec3 moved = mod(vec3(origin) - meta.xyz + 512.0, 1024.0) - 512.0;
    ivec3 was = slot + ivec3(floor(moved + 0.5));
    vec4 held = vec4(0.0);
    if (abs(meta.w - vs) < 0.5 && all(greaterThanEqual(was, ivec3(0))) && all(lessThan(was, DIMS))) {
        held = texelFetch(u_feedback, slotTexel(was, region), 0) * u_decay;
    }

    // Where this voxel is on the screen, and how big.
    vec3 centre = (vec3(cell) + 0.5) * vs;
    vec4 clip = u_projection * vec4(centre, 1.0);
    ivec2 size = textureSize(u_sceneDepth, 0);
    if (clip.w <= 1e-3) { fragColor = held; return; }
    vec2 ndc = clip.xy / clip.w;
    if (abs(ndc.x) > 1.25 || abs(ndc.y) > 1.25) { fragColor = held; return; }
    vec2 px = (ndc * 0.5 + 0.5) * vec2(size);
    float radius = clamp(vs * 0.5 * abs(u_projection[1][1]) * 0.5 * float(size.y) / clip.w, 0.5, 48.0) * 1.15;

    // Five looks first: if the surfaces the screen shows around this voxel are all well in front of it or well behind it, it is
    // empty air or hidden, and the rest of the work is skipped. Most voxels are.
    bool near = false;
    for (int k = 0; k < 5; ++k) {
        vec2 o = k == 0 ? vec2(0.0) : (k == 1 ? vec2(radius, 0.0) : (k == 2 ? vec2(-radius, 0.0) : (k == 3 ? vec2(0.0, radius) : vec2(0.0, -radius))));
        ivec2 tp = clamp(ivec2(px + o), ivec2(0), size - ivec2(1));
        float d = depthAt(tp, size);
        if (d >= 1.0) continue;
        float w = (u_projection * vec4(worldAt(tp, size), 1.0)).w;
        if (abs(w - clip.w) < vs * 3.0) { near = true; break; }
    }
    if (!near) { fragColor = held; return; }

    // Then the pixels in its footprint whose surface is inside it. The grid is jittered per voxel and per frame, so what the memory
    // averages is the whole footprint and not one fixed pattern of it.
    float frameSeed = floor(u_time.x * 30.0);
    vec2 jit = vec2(hash1(vec3(cell) + frameSeed), hash1(vec3(cell.zxy) * 1.7 + frameSeed * 3.1)) - 0.5;
    vec3 sum = vec3(0.0);
    float count = 0.0;
    for (int j = -2; j <= 2; ++j) {
        for (int i = -2; i <= 2; ++i) {
            ivec2 tp = ivec2(px + (vec2(float(i), float(j)) + jit * 0.9) * radius * 0.5);
            if (tp.x < 0 || tp.y < 0 || tp.x >= size.x || tp.y >= size.y) continue;
            float d = depthAt(tp, size);
            if (d >= 1.0) continue;
            vec3 world = worldAt(tp, size);
            if (any(notEqual(ivec3(floor(world / vs)), cell))) continue;
            if (region == 0) {
                sum += clamp(texelFetch(u_texture, tp, 0).rgb, vec3(0.0), vec3(u_maxBounce));
            } else {
                Surface s = readSurface(tp);
                if (!s.known) continue;
                vec3 n = s.normal;
                if (dot(n, viewDirection(world)) < 0.0) n = -n;
                sum += n * 0.5 + 0.5;
            }
            count += 1.0;
        }
    }
    fragColor = held + vec4(sum, count);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /** Rays from each visible surface through the atlas, at half the picture's size, blended with the last frames' gathers. */
    createGather(): ShaderHandle {
        const source = `#pragma shader "PP VoxelGI Gather"
#pragma version 300 es
#pragma domain PostProcess
#pragma highprecision
#pragma gbuffer
#pragma param u_voxelSize float default(40) range(0.01,400)
#pragma param u_rays float default(8) range(1,32)
#pragma param u_range float default(48) range(4,90)
#pragma param u_bias float default(1.2) range(0,4)
#pragma param u_blend float default(0.2) range(0.02,1)
#pragma param u_prevViewProjection0 color default(1,0,0,0)
#pragma param u_prevViewProjection1 color default(0,1,0,0)
#pragma param u_prevViewProjection2 color default(0,0,1,0)
#pragma param u_prevViewProjection3 color default(0,0,0,1)
#pragma param u_feedback texture default(black)

#pragma fragment
precision highp float;
precision highp int;

in vec2 v_texCoord;
uniform highp sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
uniform highp sampler2D u_gbuffer;
out vec4 fragColor;

${SSAO_GLSL}
${GBUFFER_GLSL}
${COMMON}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 cosineDirection(vec3 n, float u, float v) {
    float r = sqrt(u);
    float phi = 6.2831853 * v;
    vec3 up = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(up, n));
    vec3 b = cross(n, t);
    return normalize(t * (r * cos(phi)) + b * (r * sin(phi)) + n * sqrt(max(1.0 - u, 0.0)));
}

/// The light a ray from origin along dir brings: that of the first voxel it meets that faces it.
vec3 trace(vec3 origin, vec3 dir, ivec3 window, float vs) {
    vec3 pos = origin / vs;
    ivec3 cell = ivec3(floor(pos));
    ivec3 stepv = ivec3(dir.x >= 0.0 ? 1 : -1, dir.y >= 0.0 ? 1 : -1, dir.z >= 0.0 ? 1 : -1);
    vec3 safe = vec3(abs(dir.x) < 1e-6 ? 1e-6 : dir.x, abs(dir.y) < 1e-6 ? 1e-6 : dir.y, abs(dir.z) < 1e-6 ? 1e-6 : dir.z);
    vec3 delta = abs(vec3(1.0) / safe);
    vec3 next = vec3(dir.x >= 0.0 ? float(cell.x + 1) : float(cell.x), dir.y >= 0.0 ? float(cell.y + 1) : float(cell.y), dir.z >= 0.0 ? float(cell.z + 1) : float(cell.z));
    vec3 tMax = (next - pos) / safe;
    float t = 0.0;
    for (int i = 0; i < 96; ++i) {
        if (t > u_range) break;
        if (tMax.x < tMax.y && tMax.x < tMax.z) { cell.x += stepv.x; t = tMax.x; tMax.x += delta.x; }
        else if (tMax.y < tMax.z) { cell.y += stepv.y; t = tMax.y; tMax.y += delta.y; }
        else { cell.z += stepv.z; t = tMax.z; tMax.z += delta.z; }
        ivec3 slot = cell - window;
        if (any(lessThan(slot, ivec3(0))) || any(greaterThanEqual(slot, DIMS))) break;
        vec4 a = texelFetch(u_texture, slotTexel(slot, 0), 0);
        if (a.a < 2.0) continue;
        vec4 b = texelFetch(u_texture, slotTexel(slot, 1), 0);
        vec3 facing = (b.xyz / max(b.w, 1.0)) * 2.0 - 1.0;
        // A surface is met from the side it faces. One facing away is behind the ray, or the ray skims along it.
        if (dot(normalize(facing), dir) > -0.15) continue;
        return (a.rgb / a.a) * clamp(1.0 - t / u_range, 0.0, 1.0);
    }
    return vec3(0.0);
}

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 low = textureSize(u_feedback, 0);
    int frame = int(u_time.x * 60.0);
    ivec2 t = min(p * 2 + ivec2(frame % 2, (frame / 2) % 2), size - ivec2(1));
    float d = depthAt(t, size);
    Surface s = readSurface(t);
    if (d >= 1.0 || !s.known) { fragColor = vec4(0.0); return; }

    float vs = max(u_voxelSize, 1.0);
    ivec3 window = windowOrigin(vs);
    vec3 world = worldAt(t, size);
    vec3 n = s.normal;
    if (dot(n, viewDirection(world)) < 0.0) n = -n;
    vec3 origin = world + n * (vs * u_bias);

    int rays = int(u_rays);
    float r1 = ign(vec2(p) + vec2(0.0, float(frame % 16)));
    float r2 = ign(vec2(p.yx) + vec2(float(frame % 16) * 5.588238, 0.0));
    vec3 sum = vec3(0.0);
    for (int k = 0; k < rays; ++k) {
        float u = fract((float(k) + 0.5) / float(rays) + r1);
        float v = fract(float(k) * 0.61803399 + r2);
        sum += trace(origin, cosineDirection(n, u, v), window, vs);
    }
    vec3 light = sum / float(rays);

    // What the last frames agreed on, found where this surface was in the last frame's picture.
    mat4 prevVP = mat4(u_prevViewProjection0, u_prevViewProjection1, u_prevViewProjection2, u_prevViewProjection3);
    vec4 prev = prevVP * vec4(world, 1.0);
    if (prev.w > 1e-4) {
        vec2 uv = prev.xy / prev.w * 0.5 + 0.5;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
            ivec2 q = clamp(ivec2(uv * vec2(low)), ivec2(0), low - ivec2(1));
            light = mix(texelFetch(u_feedback, q, 0).rgb, light, u_blend);
        }
    }
    fragColor = vec4(light, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /** The gathered light over the picture, upsampled with the depth so it does not bleed across an edge. */
    createApply(): ShaderHandle {
        const source = `#pragma shader "PP VoxelGI Apply"
#pragma version 300 es
#pragma domain PostProcess
// The scene's albedo, beside its surface record (alpha 1 where a surface wrote one); black is "none written".
#pragma param u_sceneAlbedo texture default(black) texel(data)
#pragma param u_intensity float default(1) range(0,4)
#pragma param u_debug float default(0) range(0,1)

#pragma fragment
precision highp float;
precision highp int;

in vec2 v_texCoord;
uniform highp sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

void main() {
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 t = screenTexel(v_texCoord, size);
    vec4 src = texelFetch(u_sceneTexture, ivec2(gl_FragCoord.xy), 0);
    ivec2 low = textureSize(u_texture, 0);
    const int DIV = 2;
    float depth = depthAt(t, size);
    vec3 light = vec3(0.0);
    if (depth < 1.0) {
        // A depth-weighted blend of the low-resolution texels around the pixel: the ones on the same surface count, the ones across an
        // edge do not. The window is wider than the bilinear four, which is what smooths the rays' noise.
        ivec2 centre = ivec2(floor((vec2(t) + 0.5) / float(DIV) - 0.5));
        float total = 0.0;
        vec3 acc = vec3(0.0);
        for (int dy = -1; dy <= 2; ++dy) {
            for (int dx = -1; dx <= 2; ++dx) {
                ivec2 q = clamp(centre + ivec2(dx, dy), ivec2(0), low - ivec2(1));
                float qd = depthAt(min(q * DIV, size - ivec2(1)), size);
                if (qd >= 1.0) continue;
                vec2 nearv = abs(vec2(t) / float(DIV) - 0.5 - vec2(q));
                float spatial = max(1.0 - 0.4 * (nearv.x + nearv.y), 0.05);
                // Depth is nonlinear: it is the ratio of what is left to the far plane that says how far apart two surfaces are.
                float w = spatial * exp(-abs(log((1.0 - qd + 1e-6) / (1.0 - depth + 1e-6))) * 24.0);
                acc += texelFetch(u_texture, q, 0).rgb * w;
                total += w;
            }
        }
        if (total > 1e-4) light = acc / total;
    }
    // What the gathered light is lit onto reflects it by its own diffuse colour, which the surface wrote beside its
    // normal. A surface that wrote none (a shader older than the attachment) has its colour guessed from the picture.
    vec4 written = texelFetch(u_sceneAlbedo, min(t, textureSize(u_sceneAlbedo, 0) - ivec2(1)), 0);
    float lum = max(dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
    vec3 albedo = written.a > 0.5 ? written.rgb
                                  : mix(vec3(0.55), clamp(src.rgb / lum, vec3(0.0), vec3(1.6)) * 0.55, 0.7);
    vec3 result = src.rgb + albedo * light * u_intensity;
    if (u_debug > 0.5) result = light * u_intensity;
    fragColor = vec4(result, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};
