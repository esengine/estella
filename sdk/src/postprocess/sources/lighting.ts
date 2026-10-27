// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lighting.ts
 * @brief   The shader sources of the ambient occlusion, reflections, global illumination, exposure, depth of field and temporal anti-aliasing, installed by a package that uses one of them.
 */
import type { ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';
import { registerEffectSources } from '../effectSources';
import { gtaoPasses } from '../gtao';
import { subsurfacePasses } from '../subsurface';
import { voxelGIFallback } from '../voxelGIFallback';
import { SSAO_GLSL, SSAO_WGSL, PUDDLE_GLSL, PUDDLE_WGSL, BASIN_GLSL, BASIN_WGSL, GBUFFER_GLSL, GBUFFER_WGSL, ENV_GLSL, ENV_WGSL } from './shared';

export const lightingEffects = {
    /**
     * Temporal anti-aliasing. The engine shifts the picture by a sub-pixel amount each
     * frame and keeps this pass's last output as `u_history`; this blends the two.
     */
    createTaa(): ShaderHandle {
        const GLSL = `
vec3 toYCoCg(vec3 c) {
    return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 fromYCoCg(vec3 c) {
    return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
/// Weighs a pixel by 1 / (1 + peak): an HDR highlight cannot dominate the average.
vec3 compress(vec3 c) { return c / (1.0 + max(max(c.r, c.g), c.b)); }
vec3 expand(vec3 c) { return c / max(1.0 - max(max(c.r, c.g), c.b), 1e-4); }`;
        const WGSL = `
fn toYCoCg(c : vec3f) -> vec3f {
    return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
fn fromYCoCg(c : vec3f) -> vec3f {
    return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
fn compress(c : vec3f) -> vec3f { return c / (1.0 + max(max(c.r, c.g), c.b)); }
fn expand(c : vec3f) -> vec3f { return c / max(1.0 - max(max(c.r, c.g), c.b), 1e-4); }`;
        const source = `#pragma shader "PP TAA"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_blend float default(0.1) range(0.02,1)
#pragma param u_objectMotion float default(1) range(0,1)
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_prevViewProjection0 color default(1,0,0,0)
#pragma param u_prevViewProjection1 color default(0,1,0,0)
#pragma param u_prevViewProjection2 color default(0,0,1,0)
#pragma param u_prevViewProjection3 color default(0,0,0,1)
#pragma param u_history texture default(black)
#pragma param u_velocity texture default(black)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}
${GLSL}

/// The history at a uv, by a Catmull-Rom fit in five taps. A bilinear fetch at a fractional offset blurs the picture a little, and every frame
/// resamples the frame before it, so the blur accumulates: the softness of a temporal pass and the smear of a moving one.
vec3 historyBicubic(vec2 uv) {
    vec2 texSize = vec2(textureSize(u_history, 0));
    vec2 samplePos = uv * texSize;
    vec2 tc1 = floor(samplePos - 0.5) + 0.5;
    vec2 f = samplePos - tc1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 tc0 = (tc1 - 1.0) / texSize;
    vec2 tc3 = (tc1 + 2.0) / texSize;
    vec2 tc12 = (tc1 + w2 / w12) / texSize;
    vec3 sum = texture(u_history, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
             + texture(u_history, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
             + texture(u_history, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y)
             + texture(u_history, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
             + texture(u_history, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
    float weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    // The lobes on either side of the fit are negative, so a bright texel beside a dark one overshoots: no light below black.
    return max(sum / weight, vec3(0.0));
}

void main() {
    ivec2 size = textureSize(u_texture, 0);
    vec2 texel = 1.0 / vec2(size);
    vec4 cur = texture(u_texture, v_texCoord);

    // The neighbourhood the history has to look like: its mean and spread, in a
    // space where colour and brightness are apart.
    vec3 m1 = vec3(0.0);
    vec3 m2 = vec3(0.0);
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            vec3 s = toYCoCg(compress(texture(u_texture, v_texCoord + vec2(float(x), float(y)) * texel).rgb));
            m1 += s;
            m2 += s * s;
        }
    }
    vec3 mean = m1 / 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));
    vec3 curY = toYCoCg(compress(cur.rgb));

    ivec2 dsize = textureSize(u_sceneDepth, 0);
    float d = depthAt(screenTexel(v_texCoord, dsize), dsize);
    vec3 world = worldFromDepth(v_texCoord, d);
    vec4 prev = mat4(u_prevViewProjection0, u_prevViewProjection1,
                     u_prevViewProjection2, u_prevViewProjection3) * vec4(world, 1.0);
    vec2 puv = prev.xy / max(prev.w, 1e-6) * 0.5 + 0.5;
    bool inFront = prev.w > 1e-6;
    // A surface that moved by itself: the frame drew its displacement in a pass of its own, and where what it
    // drew is the surface the scene shows here (its depth agrees), that displacement says where this pixel was
    // — the camera's does not know about it. Anywhere else the camera's answer stands.
    ivec2 vsize = textureSize(u_velocity, 0);
    vec4 vel = texelFetch(u_velocity, screenTexel(v_texCoord, vsize), 0);
    if (u_objectMotion > 0.5 && vel.a > 0.5 && abs(vel.b - d) <= 2e-5 + (1.0 - d) * 0.02) {
        puv = v_texCoord + vel.xy;
        inFront = true;
    }
    bool seen = u_historyValid > 0.5 && inFront
             && puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0;
    if (!seen) { fragColor = cur; return; }

    vec3 hist = toYCoCg(compress(historyBicubic(puv)));
    // Pulled toward the neighbourhood's mean until it sits inside the box the
    // current frame spans: what it clips is what no longer matches.
    vec3 lo = mean - sigma * 1.25;
    vec3 hi = mean + sigma * 1.25;
    vec3 dir = hist - mean;
    vec3 over = max(abs(dir) / max((hi - lo) * 0.5, vec3(1e-5)), vec3(1.0));
    hist = mean + dir / max(max(over.x, over.y), over.z);

    // A fast-moving pixel trusts the new frame more: its history is thin.
    float speed = length((puv - v_texCoord) / texel);
    float blend = mix(u_blend, min(u_blend * 4.0, 1.0), clamp(speed, 0.0, 1.0));
    vec3 outY = mix(hist, curY, blend);
    fragColor = vec4(expand(fromYCoCg(outY)), cur.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${WGSL}

// See the GLSL twin: the history by a Catmull-Rom fit in five taps, not one bilinear fetch.
fn historyBicubic(uv : vec2f) -> vec3f {
    let texSize = vec2f(textureDimensions(u_history, 0));
    let samplePos = uv * texSize;
    let tc1 = floor(samplePos - 0.5) + 0.5;
    let f = samplePos - tc1;
    let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    let w3 = f * f * (-0.5 + 0.5 * f);
    let w12 = w1 + w2;
    let tc0 = (tc1 - 1.0) / texSize;
    let tc3 = (tc1 + 2.0) / texSize;
    let tc12 = (tc1 + w2 / w12) / texSize;
    let sum = textureSampleLevel(u_history, u_history_s, vec2f(tc12.x, tc0.y), 0.0).rgb * (w12.x * w0.y)
            + textureSampleLevel(u_history, u_history_s, vec2f(tc0.x, tc12.y), 0.0).rgb * (w0.x * w12.y)
            + textureSampleLevel(u_history, u_history_s, vec2f(tc12.x, tc12.y), 0.0).rgb * (w12.x * w12.y)
            + textureSampleLevel(u_history, u_history_s, vec2f(tc3.x, tc12.y), 0.0).rgb * (w3.x * w12.y)
            + textureSampleLevel(u_history, u_history_s, vec2f(tc12.x, tc3.y), 0.0).rgb * (w12.x * w3.y);
    let weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return max(sum / weight, vec3f(0.0));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t0, 0));
    let texel = 1.0 / vec2f(size);
    let cur = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);

    var m1 = vec3f(0.0);
    var m2 = vec3f(0.0);
    for (var y : i32 = -1; y <= 1; y = y + 1) {
        for (var x : i32 = -1; x <= 1; x = x + 1) {
            let s = toYCoCg(compress(textureSampleLevel(t0, s0, v.v_texCoord + vec2f(f32(x), f32(y)) * texel, 0.0).rgb));
            m1 = m1 + s;
            m2 = m2 + s * s;
        }
    }
    let mean = m1 / 9.0;
    let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
    let curY = toYCoCg(compress(cur.rgb));

    let dsize = vec2i(textureDimensions(t7, 0));
    let d = depthAt(screenTexel(v.v_texCoord, dsize), dsize);
    let world = worldFromDepth(v.v_texCoord, d);
    let vp = mat4x4f(mc.u_prevViewProjection0, mc.u_prevViewProjection1,
                     mc.u_prevViewProjection2, mc.u_prevViewProjection3);
    let prev = vp * vec4f(world, 1.0);
    // This device's uv runs down the rows, so clip y is flipped on the way back.
    let pw = max(prev.w, 1e-6);
    var puv = vec2f(prev.x / pw * 0.5 + 0.5, 0.5 - prev.y / pw * 0.5);
    var inFront = prev.w > 1e-6;
    // See the GLSL twin: a surface that moved by itself, from the frame's motion pass. This device's uv
    // runs down the rows, so the displacement's y is flipped on the way in.
    let vsize = vec2i(textureDimensions(u_velocity, 0));
    let vel = textureLoad(u_velocity, screenTexel(v.v_texCoord, vsize), 0);
    if (mc.u_objectMotion > 0.5 && vel.a > 0.5 && abs(vel.b - d) <= 2e-5 + (1.0 - d) * 0.02) {
        puv = v.v_texCoord + vec2f(vel.x, -vel.y);
        inFront = true;
    }
    let seen = mc.u_historyValid > 0.5 && inFront
            && puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0;
    if (!seen) { return cur; }

    var hist = toYCoCg(compress(historyBicubic(puv)));
    let lo = mean - sigma * 1.25;
    let hi = mean + sigma * 1.25;
    let dir = hist - mean;
    let over = max(abs(dir) / max((hi - lo) * 0.5, vec3f(1e-5)), vec3f(1.0));
    hist = mean + dir / max(max(over.x, over.y), over.z);

    let speed = length((puv - v.v_texCoord) / texel);
    let blend = mix(mc.u_blend, min(mc.u_blend * 4.0, 1.0), clamp(speed, 0.0, 1.0));
    let outY = mix(hist, curY, blend);
    return vec4f(expand(fromYCoCg(outY)), cur.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Screen-space reflections. No G-buffer: the surface normal is rebuilt from depth the way
     * SSAO does, the reflected ray is marched in the world and projected back to the screen at
     * every step, and a step that lands behind what the depth buffer shows by less than
     * `u_thickness` is a hit. What the ray found is blended over the pixel by a Schlick
     */
    createSsr(): ShaderHandle {
        const GLSL = `
const int STEPS = 48;
const int REFINE = 6;

/// Interleaved gradient noise: a different start offset per pixel, so the stepping
/// bands dissolve into noise that a temporal pass then averages away.
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// The screen uv a world point lands on, and whether it is in front of the camera.
vec3 project(vec3 P) {
    vec4 c = u_projection * vec4(P, 1.0);
    return vec3(c.xy / max(c.w, 1e-6) * 0.5 + 0.5, c.w);
}`;
        const WGSL = `
const STEPS : i32 = 48;
const REFINE : i32 = 6;
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn project(P : vec3f) -> vec3f {
    let c = frame.projection * vec4f(P, 1.0);
    let w = max(c.w, 1e-6);
    return vec3f(c.x / w * 0.5 + 0.5, 0.5 - c.y / w * 0.5, c.w);
}`;
        const source = `#pragma shader "PP SSR"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_maxDistance float default(400) range(10,3000)
#pragma param u_thickness float default(12) range(1,200)
#pragma param u_floorBias float default(0) range(0,1)
#pragma param u_puddles float default(0) range(0,1)
#pragma param u_puddleScale float default(350) range(40,2000)
#pragma param u_maxRoughness float default(0.75) range(0.05,1)
#pragma param u_wetness float default(0) range(0,1)
#pragma param u_skyReflection float default(1) range(0,1)
#pragma param u_envParams color default(0,0,0,0)
#pragma param u_envTint color default(0,0,0,0)
#pragma param u_reflParams color default(1,0,0,0)
#pragma param u_environment texture default(black)
#pragma gbuffer

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
uniform highp sampler2D u_gbuffer;
out vec4 fragColor;

${SSAO_GLSL}
${PUDDLE_GLSL}
${BASIN_GLSL}
${GBUFFER_GLSL}
${ENV_GLSL}
${GLSL}

void main() {
    vec4 scene = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    if (d >= 1.0 || u_intensity <= 0.0) { fragColor = scene; return; }

    vec2 cuv = uvOfTexel(c, size);
    vec3 P = worldFromDepth(cuv, d);

    // The nearer neighbour on each axis, as SSAO takes it: across a silhouette the far
    // side is another surface and a centred derivative would average the two.
    float dl = depthAt(c + ivec2(-1, 0), size);
    float dr = depthAt(c + ivec2( 1, 0), size);
    float dd = depthAt(c + ivec2(0, -1), size);
    float du = depthAt(c + ivec2(0,  1), size);
    vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P
                                        : P - worldAt(c + ivec2(-1, 0), size);
    vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P
                                        : P - worldAt(c + ivec2(0, -1), size);
    vec3 N = normalize(cross(ax, ay));
    vec3 V = viewDirection(P);
    if (dot(N, V) < 0.0) N = -N;

    // What the surface is, as the scene wrote it: its own normal (a normal map's detail, which depth
    // cannot see), how rough it is and whether it is metal. Where nothing wrote — a sprite, a draw whose
    // shader has no record to give — nothing is known of it, and a reflection of a guess is worse than none.
    Surface sf = readSurface(c);
    if (!sf.known) { fragColor = scene; return; }
    N = sf.normal;
    if (dot(N, V) < 0.0) N = -N;
    float rough = sf.roughness;
    float metal = sf.metallic;

    // Standing water is flat and mirror-like whatever the ground under it is: its normal is
    // straight up, and a still surface reflects far more than the 4% a dry one does.
    float flatUp = smoothstep(0.86, 0.95, N.y);
    float puddle = 0.0;
    if (u_puddles > 0.0) {
        puddle = puddleMask(P.xz, basinCoverage(c, size, P, u_puddles, u_puddleScale), u_puddleScale) * flatUp;
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), puddle));
    }
    // Wet ground is smoother than dry: a film of water fills the pores a rough surface scatters from.
    rough = mix(rough, rough * 0.35, u_wetness * flatUp);
    rough = mix(rough, 0.04, puddle);
    // Too rough to show anything: skipped before the march, which is the whole cost.
    if (rough > u_maxRoughness) { fragColor = scene; return; }

    // Fresnel at this angle, Schlick from the surface's own reflectance face-on: a dielectric's 4%, a
    // metal's near-all. The floor mask keeps a surface nobody described from shining on every wall.
    float cosT = clamp(dot(N, V), 0.0, 1.0);
    float f0 = mix(0.04, 0.9, metal);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
    fresnel = mix(fresnel, max(fresnel, 0.55), puddle);
    // A rough surface's reflection is spread over the lobe and dimmer for it.
    float gloss = (1.0 - rough) * (1.0 - rough);
    // Optionally only what faces up reflects: a wet street and not the walls beside it.
    float up = mix(1.0, smoothstep(0.55, 0.9, N.y), u_floorBias);
    float weight = fresnel * up * gloss * u_intensity;
    if (weight < 0.002) { fragColor = scene; return; }

    vec3 R = reflect(-V, N);
    // A ray heading back at the camera has nothing on screen to find.
    if (dot(R, V) > 0.97) { fragColor = scene; return; }

    float stepLen = u_maxDistance / float(STEPS);
    float jitter = ign(gl_FragCoord.xy);
    vec3 eye = u_camera.w > 0.5 ? u_camera.xyz : P + u_camera.xyz * 1e4;
    vec3 hitColor = vec3(0.0);
    float hit = 0.0;
    float travelled = 0.0;
    vec3 prevP = P;
    for (int i = 0; i < STEPS; ++i) {
        float t = (float(i) + jitter) * stepLen + stepLen * 0.5;
        vec3 Q = P + R * t;
        vec3 s = project(Q);
        if (s.z <= 0.0 || s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) break;
        float ds = depthAt(screenTexel(s.xy, size), size);
        if (ds >= 1.0) { prevP = Q; continue; }
        vec3 S = worldFromDepth(uvOfTexel(screenTexel(s.xy, size), size), ds);
        // How far the ray has gone past the surface the depth buffer shows there,
        // measured along the view: positive is behind it.
        float behind = length(Q - eye) - length(S - eye);
        if (behind > 0.0 && behind < u_thickness + stepLen) {
            // Bisect between the last step in front and this one behind.
            vec3 a = prevP;
            vec3 b = Q;
            for (int k = 0; k < REFINE; ++k) {
                vec3 m = 0.5 * (a + b);
                vec3 sm = project(m);
                float dm = depthAt(screenTexel(sm.xy, size), size);
                vec3 Sm = worldFromDepth(uvOfTexel(screenTexel(sm.xy, size), size), dm);
                if (length(m - eye) - length(Sm - eye) > 0.0) b = m; else a = m;
            }
            vec3 sh = project(b);
            // The reflected surface must face the ray; one seen edge-on is an
            // artefact of the depth buffer's stair-stepping, not a surface.
            vec2 e = min(sh.xy, 1.0 - sh.xy);
            float edge = smoothstep(0.0, 0.1, min(e.x, e.y));
            // A farther hit is a rougher reflection: blur it by how far it is.
            // Wider with the surface's own roughness, and with how far the ray went.
            float blur = ((length(b - P) / max(u_maxDistance, 1.0)) * 6.0 + rough * 10.0) * (1.0 - 0.85 * puddle);
            vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
            vec3 col = texture(u_texture, sh.xy).rgb * 0.4;
            col += texture(u_texture, sh.xy + vec2( blur, 0.0) * texel).rgb * 0.15;
            col += texture(u_texture, sh.xy + vec2(-blur, 0.0) * texel).rgb * 0.15;
            col += texture(u_texture, sh.xy + vec2(0.0,  blur) * texel).rgb * 0.15;
            col += texture(u_texture, sh.xy + vec2(0.0, -blur) * texel).rgb * 0.15;
            travelled = length(b - P);
            hit = edge * (1.0 - smoothstep(0.6, 1.0, travelled / u_maxDistance));
            hitColor = col;
            break;
        }
        prevP = Q;
    }
    vec3 result = mix(scene.rgb, hitColor, clamp(weight * hit, 0.0, 1.0));
    // Where the ray found nothing on screen — it left the picture, or went on to the sky — the surface still
    // reflects what is there: the environment, at the sharpness its roughness gives. Without it a mirror
    // (a puddle) would show the sky only where the scene had already painted a blurred copy of it.
    if (u_envParams.x > 0.5 && u_skyReflection > 0.0) {
        vec3 sky = envSky(R, rough);
        result = mix(result, sky, clamp(weight * (1.0 - hit) * u_skyReflection, 0.0, 1.0));
    }
    fragColor = vec4(result, scene.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${PUDDLE_WGSL}
${BASIN_WGSL}
${GBUFFER_WGSL}
${ENV_WGSL}
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let scene = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    if (d >= 1.0 || mc.u_intensity <= 0.0) { return scene; }

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

    let sf = readSurface(c);
    if (!sf.known) { return scene; }
    N = sf.normal;
    if (dot(N, V) < 0.0) { N = -N; }
    var rough = sf.roughness;
    let metal = sf.metallic;

    let flatUp = smoothstep(0.86, 0.95, N.y);
    var puddle = 0.0;
    if (mc.u_puddles > 0.0) {
        puddle = puddleMask(P.xz, basinCoverage(c, size, P, mc.u_puddles, mc.u_puddleScale), mc.u_puddleScale) * flatUp;
        N = normalize(mix(N, vec3f(0.0, 1.0, 0.0), puddle));
    }
    rough = mix(rough, rough * 0.35, mc.u_wetness * flatUp);
    rough = mix(rough, 0.04, puddle);
    if (rough > mc.u_maxRoughness) { return scene; }

    let cosT = clamp(dot(N, V), 0.0, 1.0);
    let f0 = mix(0.04, 0.9, metal);
    var fresnel = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
    fresnel = mix(fresnel, max(fresnel, 0.55), puddle);
    let gloss = (1.0 - rough) * (1.0 - rough);
    let up = mix(1.0, smoothstep(0.55, 0.9, N.y), mc.u_floorBias);
    let weight = fresnel * up * gloss * mc.u_intensity;
    if (weight < 0.002) { return scene; }

    let R = reflect(-V, N);
    if (dot(R, V) > 0.97) { return scene; }

    let stepLen = mc.u_maxDistance / f32(STEPS);
    let jitter = ign(v.pos.xy);
    var eye = P + frame.camera.xyz * 1e4;
    if (frame.camera.w > 0.5) { eye = frame.camera.xyz; }
    var hitColor = vec3f(0.0);
    var hit = 0.0;
    var prevP = P;
    for (var i : i32 = 0; i < STEPS; i = i + 1) {
        let t = (f32(i) + jitter) * stepLen + stepLen * 0.5;
        let Q = P + R * t;
        let s = project(Q);
        if (s.z <= 0.0 || s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { break; }
        let st = screenTexel(s.xy, size);
        let ds = depthAt(st, size);
        if (ds >= 1.0) { prevP = Q; continue; }
        let S = worldFromDepth(uvOfTexel(st, size), ds);
        let behind = length(Q - eye) - length(S - eye);
        if (behind > 0.0 && behind < mc.u_thickness + stepLen) {
            var a = prevP;
            var b = Q;
            for (var k : i32 = 0; k < REFINE; k = k + 1) {
                let m = 0.5 * (a + b);
                let sm = project(m);
                let mt = screenTexel(sm.xy, size);
                let dm = depthAt(mt, size);
                let Sm = worldFromDepth(uvOfTexel(mt, size), dm);
                if (length(m - eye) - length(Sm - eye) > 0.0) { b = m; } else { a = m; }
            }
            let sh = project(b);
            let e = min(sh.xy, vec2f(1.0) - sh.xy);
            let edge = smoothstep(0.0, 0.1, min(e.x, e.y));
            let travelled = length(b - P);
            let blur = ((travelled / max(mc.u_maxDistance, 1.0)) * 6.0 + rough * 10.0) * (1.0 - 0.85 * puddle);
            let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
            var col = textureSampleLevel(t0, s0, sh.xy, 0.0).rgb * 0.4;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f( blur, 0.0) * texel, 0.0).rgb * 0.15;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f(-blur, 0.0) * texel, 0.0).rgb * 0.15;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f(0.0,  blur) * texel, 0.0).rgb * 0.15;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f(0.0, -blur) * texel, 0.0).rgb * 0.15;
            hit = edge * (1.0 - smoothstep(0.6, 1.0, travelled / mc.u_maxDistance));
            hitColor = col;
            break;
        }
        prevP = Q;
    }
    var result = mix(scene.rgb, hitColor, vec3f(clamp(weight * hit, 0.0, 1.0)));
    if (mc.u_envParams.x > 0.5 && mc.u_skyReflection > 0.0) {
        let sky = envSky(R, rough);
        result = mix(result, sky, vec3f(clamp(weight * (1.0 - hit) * mc.u_skyReflection, 0.0, 1.0)));
    }
    return vec4f(result, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Screen-space global illumination, pass 1 of 2: what each surface receives from the others. From each surface a few
     * rays leave over its hemisphere (cosine weighted, around the normal the G-buffer holds), each is marched a short way in
     * the depth buffer, and what it lands on contributes the colour it is lit with — a red wall tints the white floor beside
     * it, a sunlit patch lights the shade next to it. The scene's colour stands for the light a surface gives out (its direct
     */
    createSsgiGather(): ShaderHandle {
        const GLSL = `
const int RAYS = 8;
const int STEPS = 6;
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// A direction over the hemisphere of N, cosine weighted, from two numbers in [0, 1).
vec3 cosineDirection(vec3 N, float u, float v) {
    float r = sqrt(u);
    float phi = 6.2831853 * v;
    vec3 up = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);
    return normalize(T * (r * cos(phi)) + B * (r * sin(phi)) + N * sqrt(max(1.0 - u, 0.0)));
}`;
        const WGSL = `
const RAYS : i32 = 8;
const STEPS : i32 = 6;
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn cosineDirection(N : vec3f, u : f32, v : f32) -> vec3f {
    let r = sqrt(u);
    let phi = 6.2831853 * v;
    var up = vec3f(1.0, 0.0, 0.0);
    if (abs(N.y) < 0.99) { up = vec3f(0.0, 1.0, 0.0); }
    let T = normalize(cross(up, N));
    let B = cross(N, T);
    return normalize(T * (r * cos(phi)) + B * (r * sin(phi)) + N * sqrt(max(1.0 - u, 0.0)));
}`;
        const source = `#pragma shader "PP SSGI Gather"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(150) range(0.05,1500)
#pragma param u_thickness float default(30) range(0.01,300)
#pragma param u_maxBounce float default(3) range(0.5,16)
#pragma gbuffer
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
uniform sampler2D u_gbuffer;
out vec4 fragColor;

${SSAO_GLSL}
${GBUFFER_GLSL}
${GLSL}

void main() {
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    if (d >= 1.0) { fragColor = vec4(0.0); return; }
    Surface sf = readSurface(c);
    if (!sf.known) { fragColor = vec4(0.0); return; }

    vec3 P = worldFromDepth(uvOfTexel(c, size), d);
    vec3 N = sf.normal;
    if (dot(N, viewDirection(P)) < 0.0) N = -N;

    float rot = ign(gl_FragCoord.xy);
    float turn = ign(gl_FragCoord.yx + vec2(5.588238 * u_time.x * 60.0, 0.0));
    vec3 gathered = vec3(0.0);
    for (int k = 0; k < RAYS; ++k) {
        // A stratified pair per ray, shifted per pixel: the rays of one pixel never bunch, and its neighbours differ.
        float u = fract((float(k) + 0.5) / float(RAYS) + rot);
        float v = fract(float(k) * 0.61803399 + turn);
        vec3 dir = cosineDirection(N, u, v);
        for (int i = 1; i <= STEPS; ++i) {
            float f = float(i) / float(STEPS);
            float t = u_radius * f * f;
            vec3 Q = P + N * (u_radius * 0.01) + dir * t;
            vec4 q = u_projection * vec4(Q, 1.0);
            if (q.w <= 1e-4) break;
            vec2 uv = q.xy / q.w * 0.5 + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            ivec2 tx = screenTexel(uv, size);
            if (depthAt(tx, size) >= 1.0) continue;
            float surface = (u_projection * vec4(worldAt(tx, size), 1.0)).w;
            float behind = q.w - surface;
            if (behind > u_thickness * 0.05 && behind < u_thickness) {
                // What that surface gives out, less as it is further: the light of a far wall is spread thin.
                vec3 hit = min(texture(u_texture, uv).rgb, vec3(u_maxBounce));
                gathered += hit * (1.0 - f * 0.6);
                break;
            }
        }
    }
    fragColor = vec4(gathered / float(RAYS), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${GBUFFER_WGSL}
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    if (d >= 1.0) { return vec4f(0.0); }
    let sf = readSurface(c);
    if (!sf.known) { return vec4f(0.0); }

    let P = worldFromDepth(uvOfTexel(c, size), d);
    var N = sf.normal;
    if (dot(N, viewDirection(P)) < 0.0) { N = -N; }

    let rot = ign(v.pos.xy);
    let turn = ign(v.pos.yx + vec2f(5.588238 * tc.u_time.x * 60.0, 0.0));
    var gathered = vec3f(0.0);
    for (var k : i32 = 0; k < RAYS; k = k + 1) {
        let u = fract((f32(k) + 0.5) / f32(RAYS) + rot);
        let w = fract(f32(k) * 0.61803399 + turn);
        let dir = cosineDirection(N, u, w);
        for (var i : i32 = 1; i <= STEPS; i = i + 1) {
            let f = f32(i) / f32(STEPS);
            let t = mc.u_radius * f * f;
            let Q = P + N * (mc.u_radius * 0.01) + dir * t;
            let q = frame.projection * vec4f(Q, 1.0);
            if (q.w <= 1e-4) { break; }
            let uv = vec2f(q.x / q.w * 0.5 + 0.5, 0.5 - q.y / q.w * 0.5);
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
            let tx = screenTexel(uv, size);
            if (depthAt(tx, size) >= 1.0) { continue; }
            let surface = (frame.projection * vec4f(worldAt(tx, size), 1.0)).w;
            let behind = q.w - surface;
            if (behind > mc.u_thickness * 0.05 && behind < mc.u_thickness) {
                let hit = min(textureSampleLevel(t0, s0, uv, 0.0).rgb, vec3f(mc.u_maxBounce));
                gathered = gathered + hit * (1.0 - f * 0.6);
                break;
            }
        }
    }
    return vec4f(gathered / f32(RAYS), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Screen-space global illumination, pass 2 of 2: the bounce, cleaned and laid over the picture. Each pixel averages the
     * gathered light of the pixels around it that lie on the same surface (close in depth, facing the same way), which turns
     * eight noisy rays into something near two hundred; what the receiver adds is that light times its own colour, since
     * light that bounced off a surface carries the surface's tint, so a grey wall bounces grey.
     */
    createSsgiApply(): ShaderHandle {
        const source = `#pragma shader "PP SSGI Apply"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,4)
#pragma gbuffer

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
uniform sampler2D u_gbuffer;
out vec4 fragColor;

${SSAO_GLSL}
${GBUFFER_GLSL}

void main() {
    vec4 src = texture(u_sceneTexture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    Surface sf = readSurface(c);
    if (d >= 1.0 || !sf.known || u_intensity <= 0.0) { fragColor = src; return; }

    vec3 P = worldFromDepth(uvOfTexel(c, size), d);
    float reach = max(length(worldAt(c + ivec2(2, 0), size) - P), 1e-3);
    vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int j = -2; j <= 2; ++j) {
        for (int i = -2; i <= 2; ++i) {
            vec2 uv = v_texCoord + vec2(float(i), float(j)) * texel;
            ivec2 t = screenTexel(uv, size);
            float dt = depthAt(t, size);
            if (dt >= 1.0) continue;
            Surface st = readSurface(t);
            if (!st.known) continue;
            // The same surface: nearby in the world and facing the same way.
            float apart = length(worldAt(t, size) - P) / (reach * 8.0);
            float w = exp(-apart * apart * 4.0) * pow(max(dot(sf.normal, st.normal), 0.0), 8.0);
            sum += texture(u_texture, uv).rgb * w;
            wsum += w;
        }
    }
    vec3 gathered = wsum > 1e-4 ? sum / wsum : vec3(0.0);
    // The bounced light wears the receiver's own colour (its chroma, kept below white so a bright surface does not run away).
    float lum = max(dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
    vec3 albedo = mix(vec3(0.55), clamp(src.rgb / lum, vec3(0.0), vec3(1.6)) * 0.55, 0.7);
    fragColor = vec4(src.rgb + albedo * gathered * u_intensity, src.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${GBUFFER_WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    let sf = readSurface(c);
    if (d >= 1.0 || !sf.known || mc.u_intensity <= 0.0) { return src; }

    let P = worldFromDepth(uvOfTexel(c, size), d);
    let reach = max(length(worldAt(c + vec2i(2, 0), size) - P), 1e-3);
    let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
    var sum = vec3f(0.0);
    var wsum = 0.0;
    for (var j : i32 = -2; j <= 2; j = j + 1) {
        for (var i : i32 = -2; i <= 2; i = i + 1) {
            let uv = v.v_texCoord + vec2f(f32(i), f32(j)) * texel;
            let t = screenTexel(uv, size);
            let dt = depthAt(t, size);
            if (dt >= 1.0) { continue; }
            let st = readSurface(t);
            if (!st.known) { continue; }
            let apart = length(worldAt(t, size) - P) / (reach * 8.0);
            let w = exp(-apart * apart * 4.0) * pow(max(dot(sf.normal, st.normal), 0.0), 8.0);
            sum = sum + textureSampleLevel(t0, s0, uv, 0.0).rgb * w;
            wsum = wsum + w;
        }
    }
    var gathered = vec3f(0.0);
    if (wsum > 1e-4) { gathered = sum / wsum; }
    let lum = max(dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.02);
    let albedo = mix(vec3f(0.55), clamp(src.rgb / lum, vec3f(0.0), vec3f(1.6)) * 0.55, 0.7);
    return vec4f(src.rgb + albedo * gathered * mc.u_intensity, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Contact shadows: the small, sharp shadows a shadow map is too coarse to hold — a lamp's foot on the ground, a
     * fold of cloth, the crack under a door. From each pixel a short ray is marched toward the sun in the depth buffer; a
     * step that lands just behind what the buffer shows is a surface standing between this point and the light. It is
     * laid over the finished picture, so it darkens what is already lit by the same amount whatever the light did: a
     */
    createContactShadows(): ShaderHandle {
        const source = `#pragma shader "PP Contact Shadows"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.6) range(0,1)
#pragma param u_length float default(60) range(5,600)
#pragma param u_thickness float default(8) range(0.5,80)
#pragma param u_followSun float default(1) range(0,1)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(35) range(-90,90)
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const int STEPS = 20;

${SSAO_GLSL}

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    if (d >= 1.0 || u_intensity <= 0.0) { fragColor = src; return; }

    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 L = (u_followSun > 0.5 && lightDir.w > 0.5) ? lightDir.xyz
           : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));

    vec3 P = worldFromDepth(uvOfTexel(c, size), d);
    // A surface that faces away from the sun is already dark, and a shadow on it is a second one: the term fades out before
    // the terminator instead of speckling the dark side. The normal is the depth buffer's own, from the nearer neighbour on
    // each axis (the same pick the occlusion passes make, so a silhouette does not average into a normal facing neither).
    float dl = depthAt(c + ivec2(-1, 0), size);
    float dr = depthAt(c + ivec2( 1, 0), size);
    float dd = depthAt(c + ivec2(0, -1), size);
    float du = depthAt(c + ivec2(0,  1), size);
    vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P : P - worldAt(c + ivec2(-1, 0), size);
    vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P : P - worldAt(c + ivec2(0, -1), size);
    vec3 N = normalize(cross(ax, ay));
    if (dot(N, viewDirection(P)) < 0.0) N = -N;
    float facing = smoothstep(0.02, 0.25, dot(N, L));
    if (facing <= 0.0) { fragColor = src; return; }
    // A different start offset every frame as well as every pixel, so what a temporal pass averages is the whole march and not one
    // fixed pattern of it.
    float jitter = ign(gl_FragCoord.xy + 5.588238 * float(int(u_time.x * 60.0) & 63));
    float occluded = 0.0;
    for (int i = 0; i < STEPS; ++i) {
        float t = (float(i) + jitter + 0.5) / float(STEPS) * u_length;
        vec3 Q = P + L * t;
        vec4 q = u_projection * vec4(Q, 1.0);
        if (q.w <= 1e-4) break;
        vec2 uv = q.xy / q.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        ivec2 tx = screenTexel(uv, size);
        if (depthAt(tx, size) >= 1.0) continue;
        float surface = (u_projection * vec4(worldAt(tx, size), 1.0)).w;
        // Behind what the buffer shows by more than the surface's own noise, and by less than a wall's thickness.
        float behind = q.w - surface;
        if (behind > u_thickness * 0.08 + t * 0.01 && behind < u_thickness) {
            // The nearer the blocker, the harder the contact: a hit at the far end of the march is half a shadow, not a whole one.
            float reach = t / u_length;
            occluded = 1.0 - reach * reach;
            break;
        }
    }
    fragColor = vec4(src.rgb * (1.0 - u_intensity * occluded * facing), src.a);
}
#pragma end

#pragma fragment wgsl
const STEPS : i32 = 20;

${SSAO_WGSL}

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    if (d >= 1.0 || mc.u_intensity <= 0.0) { return src; }

    let found = findSun();
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var L = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (mc.u_followSun > 0.5 && found.dir.w > 0.5) { L = found.dir.xyz; }

    let P = worldFromDepth(uvOfTexel(c, size), d);
    let dl = depthAt(c + vec2i(-1, 0), size);
    let dr = depthAt(c + vec2i( 1, 0), size);
    let dd = depthAt(c + vec2i(0, -1), size);
    let du = depthAt(c + vec2i(0,  1), size);
    var ax = P - worldAt(c + vec2i(-1, 0), size);
    if (abs(dr - d) < abs(dl - d)) { ax = worldAt(c + vec2i(1, 0), size) - P; }
    var ay = P - worldAt(c + vec2i(0, -1), size);
    if (abs(du - d) < abs(dd - d)) { ay = worldAt(c + vec2i(0, 1), size) - P; }
    var N = normalize(cross(ax, ay));
    if (dot(N, viewDirection(P)) < 0.0) { N = -N; }
    let facing = smoothstep(0.02, 0.25, dot(N, L));
    if (facing <= 0.0) { return src; }
    let jitter = ign(v.pos.xy + vec2f(5.588238 * f32(i32(tc.u_time.x * 60.0) & 63)));
    var occluded = 0.0;
    for (var i : i32 = 0; i < STEPS; i = i + 1) {
        let t = (f32(i) + jitter + 0.5) / f32(STEPS) * mc.u_length;
        let Q = P + L * t;
        let q = frame.projection * vec4f(Q, 1.0);
        if (q.w <= 1e-4) { break; }
        // This device's uv runs down the rows, so clip y is flipped on the way back.
        let uv = vec2f(q.x / q.w * 0.5 + 0.5, 0.5 - q.y / q.w * 0.5);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
        let tx = screenTexel(uv, size);
        if (depthAt(tx, size) >= 1.0) { continue; }
        let surface = (frame.projection * vec4f(worldAt(tx, size), 1.0)).w;
        let behind = q.w - surface;
        if (behind > mc.u_thickness * 0.08 + t * 0.01 && behind < mc.u_thickness) {
            let reach = t / mc.u_length;
            occluded = 1.0 - reach * reach;
            break;
        }
    }
    return vec4f(src.rgb * (1.0 - mc.u_intensity * occluded * facing), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Light shafts: the sun's light through whatever stands between it and the camera, found in
     * screen space. From each pixel a short march toward the sun's position on screen collects
     * how much of the way is open sky; a pixel behind a branch or a building sees little of it
     * and one in the open sees all of it, so what stands in front of the sun leaves rays in the
     */
    createLightShafts(): ShaderHandle {
        const source = `#pragma shader "PP Light Shafts"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_sunColor color default(1,0.85,0.6,1)
#pragma param u_intensity float default(0.6) range(0,3)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(25) range(-90,90)
#pragma param u_decay float default(0.96) range(0.8,1)
#pragma param u_reach float default(0.6) range(0.1,1)
#pragma param u_followSun float default(1) range(0,1)
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const int SAMPLES = 40;

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    vec3 eye = worldFromDepth(v_texCoord, 0.0);
    vec4 clip = u_projection * vec4(eye + sun * 10000.0, 1.0);
    // Behind the camera there is no screen position to march toward.
    if (clip.w <= 1e-4) { fragColor = src; return; }
    vec2 sunUv = clip.xy / clip.w * 0.5 + 0.5;

    ivec2 size = textureSize(u_sceneDepth, 0);
    vec2 toSun = (sunUv - v_texCoord) * u_reach;
    float aspect = float(size.x) / float(size.y);
    float dist = length(vec2((sunUv.x - v_texCoord.x) * aspect, sunUv.y - v_texCoord.y));
    vec2 stepUv = toSun / float(SAMPLES);
    vec2 uv = v_texCoord + stepUv * ign(gl_FragCoord.xy);
    float light = 0.0;
    float weight = 1.0;
    for (int i = 0; i < SAMPLES; ++i) {
        uv += stepUv;
        ivec2 t = clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
        // Open sky is where the sun reaches; anything with a surface blocks it.
        float open = texelFetch(u_sceneDepth, t, 0).r >= 1.0 ? 1.0 : 0.0;
        light += open * weight;
        weight *= u_decay;
    }
    light /= float(SAMPLES);
    // Strongest next to the sun, gone a screen away from it.
    float falloff = 1.0 - smoothstep(0.0, 1.2, dist);
    vec3 tint = u_sunColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    if (follow) tint = lightColor.rgb / max(max(lightColor.r, lightColor.g), max(lightColor.b, 1e-3));
    fragColor = vec4(src.rgb + tint * light * falloff * u_intensity, src.a);
}
#pragma end

#pragma fragment wgsl
const SAMPLES : i32 = 40;

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let found = findSun();
    let follow = mc.u_followSun > 0.5 && found.dir.w > 0.5;
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (follow) { sun = found.dir.xyz; }
    let eye = worldFromDepth(v.v_texCoord, 0.0);
    let clip = frame.projection * vec4f(eye + sun * 10000.0, 1.0);
    if (clip.w <= 1e-4) { return src; }
    // This device's uv runs down the rows, so clip y is flipped on the way back.
    let sunUv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);

    let size = vec2i(textureDimensions(t7, 0));
    let toSun = (sunUv - v.v_texCoord) * mc.u_reach;
    let aspect = f32(size.x) / f32(size.y);
    let dist = length(vec2f((sunUv.x - v.v_texCoord.x) * aspect, sunUv.y - v.v_texCoord.y));
    let stepUv = toSun / f32(SAMPLES);
    var uv = v.v_texCoord + stepUv * ign(v.pos.xy);
    var light = 0.0;
    var weight = 1.0;
    for (var i : i32 = 0; i < SAMPLES; i = i + 1) {
        uv = uv + stepUv;
        let t = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - vec2i(1));
        var lit = 0.0;
        if (textureLoad(t7, t, 0) >= 1.0) { lit = 1.0; }
        light = light + lit * weight;
        weight = weight * mc.u_decay;
    }
    light = light / f32(SAMPLES);
    let falloff = 1.0 - smoothstep(0.0, 1.2, dist);
    var tint = mc.u_sunColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    if (follow) { tint = found.color.rgb / max(max(found.color.r, found.color.g), max(found.color.b, 1e-3)); }
    return vec4f(src.rgb + tint * light * falloff * mc.u_intensity, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Auto exposure, pass 1 of 3: how bright is the picture, in a few texels. Each texel of this
     * small target averages the LOG of the luminance over a block of the scene — the log, because
     * the eye judges brightness by ratio, and an average of raw values is decided by whatever
     * lamp or sun is in view. Pixels darker than 2^-8 are left out of the average — a black
     */
    createAutoExposureMeasure(): ShaderHandle {
        const source = `#pragma shader "PP Auto Exposure Measure"
#pragma version 300 es
#pragma domain PostProcess
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
    float sum = 0.0;
    float counted = 0.0;
    // Sixteen bilinear taps, four pixels apart: each reads 2x2 pixels and together they
    // cover the 16x16 block this texel stands for.
    for (int j = 0; j < 4; ++j) {
        for (int i = 0; i < 4; ++i) {
            vec3 c = texture(u_texture, v_texCoord + (vec2(float(i), float(j)) - 1.5) * 4.0 * texel).rgb;
            float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
            if (lum > 0.0039) { sum += log2(lum); counted += 1.0; }
        }
    }
    float code = counted > 0.0 ? clamp((sum / counted + 12.0) / 20.0, 0.0, 1.0) : 0.0;
    fragColor = vec4(code, counted / 16.0, 0.0, 1.0);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
    var sum = 0.0;
    var counted = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        for (var i : i32 = 0; i < 4; i = i + 1) {
            let c = textureSampleLevel(t0, s0, v.v_texCoord + (vec2f(f32(i), f32(j)) - 1.5) * 4.0 * texel, 0.0).rgb;
            let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
            if (lum > 0.0039) { sum = sum + log2(lum); counted = counted + 1.0; }
        }
    }
    var code = 0.0;
    if (counted > 0.0) { code = clamp((sum / counted + 12.0) / 20.0, 0.0, 1.0); }
    return vec4f(code, counted / 16.0, 0.0, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Auto exposure, pass 2 of 3: the exposure the eye has settled on. The measurement is averaged
     * to one number, turned into the exposure that would put that brightness at middle grey, and
     * moved toward over time from where the last frame left it — that last value is this pass's own
     * previous output, which the engine keeps for it (`u_feedback`). Brightening is allowed to
     */
    createAutoExposureAdapt(): ShaderHandle {
        const source = `#pragma shader "PP Auto Exposure Adapt"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_bias float default(0) range(-4,4)
#pragma param u_speedUp float default(3) range(0.1,20)
#pragma param u_speedDown float default(1) range(0.1,20)
#pragma param u_minEV float default(-4) range(-10,0)
#pragma param u_maxEV float default(4) range(0,10)
#pragma param u_metering float default(0) range(0,2)
#pragma param u_meterSize float default(0.35) range(0.02,1)
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_feedback texture default(black)
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

/// How much a place on the screen counts: everywhere equally, a soft bright-centre bias, or a disc and nothing else.
float meterWeight(vec2 uv) {
    if (u_metering < 0.5) return 1.0;
    float r = length(uv - 0.5) / max(u_meterSize, 0.02);
    if (u_metering < 1.5) return exp(-2.0 * r * r) + 0.04;
    return r < 1.0 ? 1.0 : 0.0;
}

void main() {
    float sum = 0.0;
    float weight = 0.0;
    // The taps spread over the part of the picture that counts: all of it for an average, a region around the centre
    // for the other two, so a small spot still has taps in it.
    float extent = u_metering < 0.5 ? 1.0 : clamp(u_meterSize * 2.4, 0.1, 1.0);
    for (int j = 0; j < 8; ++j) {
        for (int i = 0; i < 8; ++i) {
            vec2 at = 0.5 + ((vec2(float(i), float(j)) + 0.5) / 8.0 - 0.5) * extent;
            vec2 m = texture(u_texture, at).rg;
            float w = meterWeight(at);
            sum += m.r * m.g * w;
            weight += m.g * w;
        }
    }
    // Weighted by how much of each block counted; a picture with nothing to measure
    // is left at the exposure the author's compensation alone asks for.
    float meanLog = weight > 1e-3 ? (sum / weight) * 20.0 - 12.0 : log2(0.18);
    // The exposure that takes the scene's mean to 18% grey, plus what the author asked for.
    float target = clamp(log2(0.18) - meanLog + u_bias, u_minEV, u_maxEV);
    float prev = texture(u_feedback, vec2(0.5)).r * 20.0 - 10.0;
    float ev = target;
    if (u_historyValid > 0.5) {
        float rate = target > prev ? u_speedUp : u_speedDown;
        ev = prev + (target - prev) * (1.0 - exp(-clamp(u_time.y, 0.0, 0.25) * rate));
    }
    float code = clamp((ev + 10.0) / 20.0, 0.0, 1.0);
    fragColor = vec4(code, code, code, 1.0);
}
#pragma end

#pragma fragment wgsl
fn meterWeight(uv : vec2f) -> f32 {
    if (mc.u_metering < 0.5) { return 1.0; }
    let r = length(uv - vec2f(0.5)) / max(mc.u_meterSize, 0.02);
    if (mc.u_metering < 1.5) { return exp(-2.0 * r * r) + 0.04; }
    return select(0.0, 1.0, r < 1.0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    var sum = 0.0;
    var weight = 0.0;
    var extent = 1.0;
    if (mc.u_metering >= 0.5) { extent = clamp(mc.u_meterSize * 2.4, 0.1, 1.0); }
    for (var j : i32 = 0; j < 8; j = j + 1) {
        for (var i : i32 = 0; i < 8; i = i + 1) {
            let at = vec2f(0.5) + ((vec2f(f32(i), f32(j)) + 0.5) / 8.0 - vec2f(0.5)) * extent;
            let m = textureSampleLevel(t0, s0, at, 0.0).rg;
            let w = meterWeight(at);
            sum = sum + m.r * m.g * w;
            weight = weight + m.g * w;
        }
    }
    var meanLog = log2(0.18);
    if (weight > 1e-3) { meanLog = (sum / weight) * 20.0 - 12.0; }
    let target_ev = clamp(log2(0.18) - meanLog + mc.u_bias, mc.u_minEV, mc.u_maxEV);
    let prev = textureSampleLevel(u_feedback, u_feedback_s, vec2f(0.5), 0.0).r * 20.0 - 10.0;
    var ev = target_ev;
    if (mc.u_historyValid > 0.5) {
        var rate = mc.u_speedDown;
        if (target_ev > prev) { rate = mc.u_speedUp; }
        ev = prev + (target_ev - prev) * (1.0 - exp(-clamp(tc.u_time.y, 0.0, 0.25) * rate));
    }
    let code = clamp((ev + 10.0) / 20.0, 0.0, 1.0);
    return vec4f(code, code, code, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /** Auto exposure, pass 3 of 3: the scene, at unit 1, scaled by the exposure the last pass settled on. */
    createAutoExposureApply(): ShaderHandle {
        const source = `#pragma shader "PP Auto Exposure Apply"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
out vec4 fragColor;

void main() {
    float ev = texture(u_texture, vec2(0.5)).r * 20.0 - 10.0;
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    fragColor = vec4(scene.rgb * exp2(ev), scene.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let ev = textureSampleLevel(t0, s0, vec2f(0.5), 0.0).r * 20.0 - 10.0;
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    return vec4f(scene.rgb * exp2(ev), scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Depth of field, pass 1 of 3: where the lens is focused. A few texels hold one number, the focus distance —
     * the one the author wrote, or with `u_autoFocus` on, the distance of the surface under the focus point,
     * which moves toward its target a little each frame so a rack focus is a glide and not a cut. A float
     * target, because a distance in metres is not a share of 255.
     */
    createDofFocus(): ShaderHandle {
        const source = `#pragma shader "PP DoF Focus"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_focusDistance float default(600) range(1,5000)
#pragma param u_autoFocus float default(0) range(0,1)
#pragma param u_focusX float default(0.5) range(0,1)
#pragma param u_focusY float default(0.5) range(0,1)
#pragma param u_focusSpeed float default(5) range(0.1,40)
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_feedback texture default(black)
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

void main() {
    float prev = texture(u_feedback, vec2(0.5)).r;
    float target = u_focusDistance;
    if (u_autoFocus > 0.5) {
        ivec2 size = textureSize(u_sceneDepth, 0);
        vec3 eye = worldFromDepth(vec2(u_focusX, 1.0 - u_focusY), 0.0);
        // Nine taps a little apart: what is under the point, not whatever one pixel of it happens to be.
        float sum = 0.0;
        float n = 0.0;
        for (int j = -1; j <= 1; ++j) {
            for (int i = -1; i <= 1; ++i) {
                vec2 uv = vec2(u_focusX, 1.0 - u_focusY) + vec2(float(i), float(j)) * 0.012;
                float d = depthAt(screenTexel(uv, size), size);
                if (d >= 1.0) continue;
                sum += length(worldFromDepth(uv, d) - eye);
                n += 1.0;
            }
        }
        // Nothing but sky under the point: the lens stays where it was.
        target = n > 0.5 ? sum / n : (u_historyValid > 0.5 ? prev : u_focusDistance);
    }
    float focus = target;
    if (u_historyValid > 0.5 && prev > 0.0) {
        // In the log of the distance: the same share of a near thing and a far one per second.
        float k = 1.0 - exp(-clamp(u_time.y, 0.0, 0.25) * u_focusSpeed);
        focus = exp(mix(log(prev), log(max(target, 1e-3)), k));
    }
    fragColor = vec4(focus, 0.0, 0.0, 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let prev = textureSampleLevel(u_feedback, u_feedback_s, vec2f(0.5), 0.0).r;
    var target_d = mc.u_focusDistance;
    if (mc.u_autoFocus > 0.5) {
        let size = vec2i(textureDimensions(t7, 0));
        let eye = worldFromDepth(vec2f(mc.u_focusX, mc.u_focusY), 0.0);
        var sum = 0.0;
        var n = 0.0;
        for (var j : i32 = -1; j <= 1; j = j + 1) {
            for (var i : i32 = -1; i <= 1; i = i + 1) {
                let uv = vec2f(mc.u_focusX, mc.u_focusY) + vec2f(f32(i), f32(j)) * 0.012;
                let d = depthAt(screenTexel(uv, size), size);
                if (d >= 1.0) { continue; }
                sum = sum + length(worldFromDepth(uv, d) - eye);
                n = n + 1.0;
            }
        }
        if (n > 0.5) { target_d = sum / n; }
        else if (mc.u_historyValid > 0.5) { target_d = prev; }
    }
    var focus = target_d;
    if (mc.u_historyValid > 0.5 && prev > 0.0) {
        let k = 1.0 - exp(-clamp(tc.u_time.y, 0.0, 0.25) * mc.u_focusSpeed);
        focus = exp(mix(log(prev), log(max(target_d, 1e-3)), k));
    }
    return vec4f(focus, 0.0, 0.0, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Depth of field, pass 2 of 3: how blurred each pixel is. The circle of confusion comes from how far the surface is
     * from the focus the first pass settled on (at unit 0), past the slab that stays sharp, as a share of its distance — the
     * thin-lens ratio, capped — and travels in the alpha of the scene (unit 1), so the pass that gathers does not have to find
     * a depth for every tap. A float target: a blur of 11.4 pixels is not a share of 255.
     */
    createDofCoc(): ShaderHandle {
        const source = `#pragma shader "PP DoF Circle"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_focusRange float default(100) range(0,2000)
#pragma param u_aperture float default(24) range(0,64)
#pragma param u_maxBlur float default(14) range(1,32)
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

void main() {
    vec4 src = texture(u_sceneTexture, v_texCoord);
    float focus = texture(u_texture, vec2(0.5)).r;
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = depthAt(screenTexel(v_texCoord, size), size);
    float coc = min(u_aperture, u_maxBlur);
    if (depth < 1.0) {
        vec3 eye = u_camera.w > 0.5 ? u_camera.xyz : worldFromDepth(v_texCoord, 0.0);
        float dist = length(worldFromDepth(v_texCoord, depth) - eye);
        coc = min(u_aperture * max(abs(dist - focus) - u_focusRange, 0.0) / max(dist, 1e-3), u_maxBlur);
    }
    fragColor = vec4(src.rgb, coc);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let focus = textureSampleLevel(t0, s0, vec2f(0.5), 0.0).r;
    let size = vec2i(textureDimensions(t7, 0));
    let depth = depthAt(screenTexel(v.v_texCoord, size), size);
    var coc = min(mc.u_aperture, mc.u_maxBlur);
    if (depth < 1.0) {
        var eye = worldFromDepth(v.v_texCoord, 0.0);
        if (frame.camera.w > 0.5) { eye = frame.camera.xyz; }
        let dist = length(worldFromDepth(v.v_texCoord, depth) - eye);
        coc = min(mc.u_aperture * max(abs(dist - focus) - mc.u_focusRange, 0.0) / max(dist, 1e-3), mc.u_maxBlur);
    }
    return vec4f(src.rgb, coc);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Depth of field, pass 3 of 3: the blur. A pixel gathers its neighbours over its own circle, counting a neighbour
     * only to the extent that neighbour's own circle reaches back (read from the previous pass's alpha, so a sharp object in
     * front of a blurred background does not bleed into it while a blurred foreground spreads over what is behind). The taps
     * lie on a spiral inside a disc, or inside an n-sided polygon when `u_blades` is 3 or more — the shape of the lens's
     */
    createDofGather(): ShaderHandle {
        const GLSL = `
const int TAPS = 64;
const float TAU = 6.2831853;
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// A point of the unit disc pushed out to the n-gon that has the disc as its circumscribing circle.
vec2 shapeTap(vec2 p, float blades, float turn) {
    if (blades < 2.5) return p;
    float a = atan(p.y, p.x) - turn;
    float sector = TAU / blades;
    float within = mod(a + sector * 0.5, sector) - sector * 0.5;
    return p * (cos(sector * 0.5) / cos(within));
}`;
        const WGSL = `
const TAPS : i32 = 64;
const TAU : f32 = 6.2831853;
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn shapeTap(p : vec2f, blades : f32, turn : f32) -> vec2f {
    if (blades < 2.5) { return p; }
    let a = atan2(p.y, p.x) - turn;
    let sector = TAU / blades;
    let within = (a + sector * 0.5) - sector * floor((a + sector * 0.5) / sector) - sector * 0.5;
    return p * (cos(sector * 0.5) / cos(within));
}`;
        const source = `#pragma shader "PP DoF Gather"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_blades float default(0) range(0,9)
#pragma param u_bokehRotation float default(0) range(0,360)
#pragma param u_highlight float default(0) range(0,8)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

${GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    float coc = src.a;
    if (coc < 0.5) { fragColor = vec4(src.rgb, 1.0); return; }

    vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
    // The taps shift along their spiral by a fraction of one, a different one at each pixel: the pattern stays whole and
    // what is left of the jitter is grain a temporal pass averages away, instead of a disc turned about at random.
    float jitter = ign(gl_FragCoord.xy);
    float turn = radians(u_bokehRotation);
    float centre = 1.0 + u_highlight * smoothstep(1.0, 6.0, dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)));
    vec3 sum = src.rgb * centre;
    float wsum = centre;
    for (int i = 0; i < TAPS; ++i) {
        float k = float(i) + jitter;
        float r = sqrt((k + 0.5) / float(TAPS));
        float a = k * 2.39996323;
        vec2 disc = shapeTap(vec2(cos(a), sin(a)) * r, u_blades, turn);
        vec2 uv = v_texCoord + disc * coc * texel;
        vec4 tap = texture(u_texture, uv);
        // Gathered only to the extent that tap's own blur reaches back here.
        float w = clamp(tap.a / max(length(disc) * coc, 0.5), 0.0, 1.0);
        w *= 1.0 + u_highlight * smoothstep(1.0, 6.0, dot(tap.rgb, vec3(0.2126, 0.7152, 0.0722)));
        sum += tap.rgb * w;
        wsum += w;
    }
    fragColor = vec4(sum / wsum, 1.0);
}
#pragma end

#pragma fragment wgsl
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let coc = src.a;
    if (coc < 0.5) { return vec4f(src.rgb, 1.0); }

    let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
    let jitter = ign(v.pos.xy);
    let turn = radians(mc.u_bokehRotation);
    let centre = 1.0 + mc.u_highlight * smoothstep(1.0, 6.0, dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722)));
    var sum = src.rgb * centre;
    var wsum = centre;
    for (var i : i32 = 0; i < TAPS; i = i + 1) {
        let k = f32(i) + jitter;
        let r = sqrt((k + 0.5) / f32(TAPS));
        let a = k * 2.39996323;
        let disc = shapeTap(vec2f(cos(a), sin(a)) * r, mc.u_blades, turn);
        let uv = v.v_texCoord + disc * coc * texel;
        let tap = textureSampleLevel(t0, s0, uv, 0.0);
        var w = clamp(tap.a / max(length(disc) * coc, 0.5), 0.0, 1.0);
        w = w * (1.0 + mc.u_highlight * smoothstep(1.0, 6.0, dot(tap.rgb, vec3f(0.2126, 0.7152, 0.0722))));
        sum = sum + tap.rgb * w;
        wsum = wsum + w;
    }
    return vec4f(sum / wsum, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * SSAO, pass 1 of 4: the occlusion term, at half resolution. No G-buffer —
     * scene depth and the injected `worldFromDepth` are the whole input, and
     * positions come back in WORLD space, so the radius is a world length.
     * Coordinates are the pass uv's texels, which run in each device's own row order.
     */
    createSsaoAo(): ShaderHandle {
        const source = `#pragma shader "PP SSAO"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(60) range(0.01,400)
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_bias float default(0.12) range(0,0.6)
#pragma param u_power float default(1.6) range(0.5,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const int K = 12;
const float TAU = 6.28318530718;

void main() {
    // Depth is full resolution and this pass is not, so the texel comes from the
    // uv — gl_FragCoord here counts THIS pass's smaller grid.
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    // The cleared far plane is the absence of a surface: nothing there is
    // occluded, and shading it would ring the sky in grey.
    if (d >= 1.0) { fragColor = vec4(1.0); return; }

    // The TEXEL CENTRE, not this pass's uv: at half resolution they differ by
    // half a depth texel, and the tangents below are one texel long. Mixing the
    // two conventions reconstructs noise instead of a normal.
    vec2 cuv = uvOfTexel(c, size);
    vec3 P = worldFromDepth(cuv, d);

    // The NEARER neighbour on each axis. Across a silhouette the far side is a
    // different surface, and a centred derivative would average the two into a
    // normal facing neither — the smeared ring a naive reconstruction leaves.
    float dl = depthAt(c + ivec2(-1, 0), size);
    float dr = depthAt(c + ivec2( 1, 0), size);
    float dd = depthAt(c + ivec2(0, -1), size);
    float du = depthAt(c + ivec2(0,  1), size);
    vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P
                                        : P - worldAt(c + ivec2(-1, 0), size);
    vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P
                                        : P - worldAt(c + ivec2(0, -1), size);
    vec3 N = normalize(cross(ax, ay));
    // Which side each pick came from decides the sign of the cross; the camera
    // settles it, because a visible surface faces the eye.
    if (dot(N, viewDirection(P)) < 0.0) N = -N;

    // A world radius spans different pixel counts near and far. One texel step
    // un-projected AT THIS DEPTH measures that scale without a projection matrix
    // or a neighbour's geometry. The ceiling is the bandwidth budget.
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(size.x), 0.0), d) - P), 1e-6);
    float radiusTexels = clamp(u_radius / worldPerTexel, 2.0, 96.0);

    // A 4x4 rotation scrambled by a factor coprime to 16, so the blur averages a
    // pattern and not a band. Keyed to THIS pass's pixel — c counts full-res
    // texels, and raw it would give a half-res pass every other phase.
    ivec2 rp = c / 2;
    int idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    float rot = float(idx - (idx / 16) * 16) * (TAU / 16.0);

    // Every sample votes equally: the result is the fraction of the
    // neighbourhood closed off. Weighting near taps louder is the tempting
    // mistake — they land back on this surface and would vote OPEN loudest.
    float occl = 0.0;
    for (int i = 0; i < K; ++i) {
        float a = (float(i) + 0.5) / float(K);
        float ang = a * 7.0 * TAU + rot;
        vec2 off = vec2(cos(ang), sin(ang)) * (a * radiusTexels);
        ivec2 st = c + ivec2(floor(off + 0.5));
        float ds = depthAt(st, size);
        // Sky: nothing in that direction, so it votes OPEN by contributing
        // nothing. This is what lightens the top of a wall toward its edge.
        if (ds >= 1.0) continue;

        // Measured in radii, so the estimator keeps its shape when the radius
        // changes and u_bias keeps one meaning.
        vec3 u = (worldAt(st, size) - P) / max(u_radius, 1e-4);
        float uu = dot(u, u);
        // Elevation above the tangent plane, less the bias that stops a flat
        // surface from occluding itself into grey.
        float sinE = dot(u, N) / max(sqrt(uu), 1e-6);
        // Beyond the radius a sample is a different surface, not an occluder:
        // this is what stops a silhouette haloing what is behind it. Faded, not
        // cut, or the term pops as geometry crosses the edge under camera motion.
        float range = 1.0 - smoothstep(0.6, 1.0, uu);
        occl += max(sinE - u_bias, 0.0) * range;
    }

    float ao = 1.0 - clamp(occl / float(K) * u_intensity, 0.0, 1.0);
    fragColor = vec4(vec3(pow(ao, u_power)), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const K : i32 = 12;
const TAU : f32 = 6.28318530718;

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
    if (dot(N, viewDirection(P)) < 0.0) { N = -N; }

    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(size.x), 0.0), d) - P), 1e-6);
    let radiusTexels = clamp(mc.u_radius / worldPerTexel, 2.0, 96.0);

    let rp = c / 2;
    let idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    let rot = f32(idx - (idx / 16) * 16) * (TAU / 16.0);

    var occl = 0.0;
    for (var i : i32 = 0; i < K; i = i + 1) {
        let a = (f32(i) + 0.5) / f32(K);
        let ang = a * 7.0 * TAU + rot;
        let off = vec2f(cos(ang), sin(ang)) * (a * radiusTexels);
        let st = c + vec2i(floor(off + 0.5));
        let ds = depthAt(st, size);
        if (ds >= 1.0) { continue; }

        let u = (worldAt(st, size) - P) / max(mc.u_radius, 1e-4);
        let uu = dot(u, u);
        let sinE = dot(u, N) / max(sqrt(uu), 1e-6);
        let range = 1.0 - smoothstep(0.6, 1.0, uu);
        occl = occl + max(sinE - mc.u_bias, 0.0) * range;
    }

    let ao = 1.0 - clamp(occl / f32(K) * mc.u_intensity, 0.0, 1.0);
    return vec4f(vec3f(pow(ao, mc.u_power)), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * SSAO, passes 2 and 3: a separable blur that will not cross a depth edge,
     * or a contact shadow ends up on the wall behind. Each tap is weighted by
     * its gap ALONG THE VIEW RAY in world units against the pixel's own scale,
     * so one constant holds near and far where a raw depth compare would not.
     */
    createSsaoBlur(axis: 0 | 1): ShaderHandle {
        const step = axis === 0 ? 'vec2(1.0, 0.0)' : 'vec2(0.0, 1.0)';
        const stepW = axis === 0 ? 'vec2f(1.0, 0.0)' : 'vec2f(0.0, 1.0)';
        const source = `#pragma shader "PP SSAO Blur ${axis.toFixed(0)}"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const int R = 3;
/// A tap whose view-ray gap exceeds this many texel-widths is another surface.
const float SLOPE = 4.0;

void main() {
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 hsize = textureSize(u_texture, 0);
    ivec2 dc = screenTexel(v_texCoord, dsize);
    float d = depthAt(dc, dsize);
    if (d >= 1.0) { fragColor = texture(u_texture, v_texCoord); return; }

    vec2 cuv = uvOfTexel(dc, dsize);
    vec3 P = worldFromDepth(cuv, d);
    // The pixel's own world scale, from one texel step at ITS depth — the same
    // measure the AO pass sizes its radius with.
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(dsize.x), 0.0), d) - P), 1e-6);
    float tol = worldPerTexel * SLOPE;
    float perDepth = worldPerDepth(cuv, d, P);

    vec2 stepUv = ${step} / vec2(hsize);
    float sum = 0.0;
    float wsum = 0.0;
    for (int i = -R; i <= R; ++i) {
        vec2 uv = v_texCoord + stepUv * float(i);
        float g = exp(-float(i * i) / 8.0);

        ivec2 dt = screenTexel(uv, dsize);
        float dj = depthAt(dt, dsize);
        // Off the far plane there is no surface to agree with; the Gaussian
        // alone would let the sky pull the edge of a silhouette toward white.
        float w = dj >= 1.0 ? 0.0
                            : g * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        sum += texture(u_texture, uv).r * w;
        wsum += w;
    }
    // Every neighbour rejected (a one-pixel sliver): keep this pixel's own value
    // rather than dividing by nothing.
    float ao = wsum > 1e-5 ? sum / wsum : texture(u_texture, v_texCoord).r;
    fragColor = vec4(vec3(ao), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const R : i32 = 3;
const SLOPE : f32 = 4.0;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let dsize = vec2i(textureDimensions(t7, 0));
    let hsize = vec2i(textureDimensions(t0, 0));
    let dc = screenTexel(v.v_texCoord, dsize);
    let d = depthAt(dc, dsize);
    if (d >= 1.0) { return textureSampleLevel(t0, s0, v.v_texCoord, 0.0); }

    let cuv = uvOfTexel(dc, dsize);
    let P = worldFromDepth(cuv, d);
    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(dsize.x), 0.0), d) - P), 1e-6);
    let tol = worldPerTexel * SLOPE;
    let perDepth = worldPerDepth(cuv, d, P);

    let stepUv = ${stepW} / vec2f(hsize);
    var sum = 0.0;
    var wsum = 0.0;
    for (var i : i32 = -R; i <= R; i = i + 1) {
        let uv = v.v_texCoord + stepUv * f32(i);
        let g = exp(-f32(i * i) / 8.0);

        let dt = screenTexel(uv, dsize);
        let dj = depthAt(dt, dsize);
        var w = 0.0;
        if (dj < 1.0) {
            w = g * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        }
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).r * w;
        wsum = wsum + w;
    }
    var ao = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).r;
    if (wsum > 1e-5) { ao = sum / wsum; }
    return vec4f(vec3f(ao), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * SSAO, pass 4 of 4: upsample the half-resolution term and apply it. Plain
     * bilinear would undo the blur's care — a half-res texel straddling a
     * silhouette bleeds back across it — so the four candidates carry the same
     * view-ray gap weight. The scene arrives at unit 1, as bloom's composite.
     */
    createSsaoComposite(): ShaderHandle {
        const source = `#pragma shader "PP SSAO Composite"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const float SLOPE = 4.0;

void main() {
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 dc = screenTexel(v_texCoord, dsize);
    float d = depthAt(dc, dsize);
    if (d >= 1.0) { fragColor = scene; return; }

    vec2 cuv = uvOfTexel(dc, dsize);
    vec3 P = worldFromDepth(cuv, d);
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(dsize.x), 0.0), d) - P), 1e-6);
    float tol = worldPerTexel * SLOPE;
    float perDepth = worldPerDepth(cuv, d, P);

    // The four half-resolution texels this pixel falls between, in SCREEN texel
    // space so the bilinear weights mean the same on both backends.
    ivec2 hsize = textureSize(u_texture, 0);
    vec2 hf = v_texCoord * vec2(hsize) - 0.5;
    ivec2 base = ivec2(floor(hf));
    vec2 frac = hf - vec2(base);

    float sum = 0.0;
    float wsum = 0.0;
    for (int j = 0; j < 4; ++j) {
        ivec2 o = ivec2(j & 1, j >> 1);
        ivec2 t = clamp(base + o, ivec2(0), hsize - ivec2(1));
        vec2 uv = uvOfTexel(t, hsize);
        float bw = (o.x == 1 ? frac.x : 1.0 - frac.x) * (o.y == 1 ? frac.y : 1.0 - frac.y);

        ivec2 dt = screenTexel(uv, dsize);
        float dj = depthAt(dt, dsize);
        float w = dj >= 1.0 ? 0.0
                            : bw * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        sum += texture(u_texture, uv).r * w;
        wsum += w;
    }
    // No candidate agreed: this pixel is its own sliver, so take the term
    // straight rather than leaving it unshaded.
    float ao = wsum > 1e-5 ? sum / wsum : texture(u_texture, v_texCoord).r;
    fragColor = vec4(scene.rgb * ao, scene.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const SLOPE : f32 = 4.0;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let dsize = vec2i(textureDimensions(t7, 0));
    let dc = screenTexel(v.v_texCoord, dsize);
    let d = depthAt(dc, dsize);
    if (d >= 1.0) { return scene; }

    let cuv = uvOfTexel(dc, dsize);
    let P = worldFromDepth(cuv, d);
    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(dsize.x), 0.0), d) - P), 1e-6);
    let tol = worldPerTexel * SLOPE;
    let perDepth = worldPerDepth(cuv, d, P);

    let hsize = vec2i(textureDimensions(t0, 0));
    let hf = v.v_texCoord * vec2f(hsize) - 0.5;
    let base = vec2i(floor(hf));
    let frac = hf - vec2f(base);

    var sum = 0.0;
    var wsum = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let o = vec2i(j & 1, j >> 1);
        let t = clamp(base + o, vec2i(0), hsize - vec2i(1));
        let uv = uvOfTexel(t, hsize);
        var bwx = 1.0 - frac.x;
        if (o.x == 1) { bwx = frac.x; }
        var bwy = 1.0 - frac.y;
        if (o.y == 1) { bwy = frac.y; }
        let bw = bwx * bwy;

        let dt = screenTexel(uv, dsize);
        let dj = depthAt(dt, dsize);
        var w = 0.0;
        if (dj < 1.0) {
            w = bw * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        }
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).r * w;
        wsum = wsum + w;
    }
    var ao = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).r;
    if (wsum > 1e-5) { ao = sum / wsum; }
    return vec4f(scene.rgb * ao, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};

export function registerLightingEffectSources(): void {
    registerEffectSources(lightingEffects);
    registerEffectSources(gtaoPasses);
    registerEffectSources(subsurfacePasses);
    registerEffectSources(voxelGIFallback);
}
