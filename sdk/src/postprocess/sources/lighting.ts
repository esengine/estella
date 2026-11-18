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
import { SSAO_GLSL, PUDDLE_GLSL, BASIN_GLSL, GBUFFER_GLSL, ENV_GLSL } from './shared';
import { IGN_GLSL } from '../../render/shaderLib';
import { qualityUniformMax, qualityUniformParam } from '../qualityParams';

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
        const source = `#pragma shader "PP TAA"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_blend float default(0.1) range(0.02,1)
#pragma param u_objectMotion float default(1) range(0,1)
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_jitter color default(0,0,0,0)
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
    // The frame was drawn shifted by this frame's jitter: read it back where the unshifted picture is, or the
    // output, which is mostly this frame wherever the history is clipped, moves with the jitter.
    vec2 uvNow = v_texCoord + u_jitter.xy * 0.5;
    vec4 cur = texture(u_texture, uvNow);

    // The neighbourhood the history has to look like: its mean and spread, in a
    // space where colour and brightness are apart.
    vec3 m1 = vec3(0.0);
    vec3 m2 = vec3(0.0);
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            vec3 s = toYCoCg(compress(texture(u_texture, uvNow + vec2(float(x), float(y)) * texel).rgb));
            m1 += s;
            m2 += s * s;
        }
    }
    vec3 mean = m1 / 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));
    vec3 curY = toYCoCg(compress(cur.rgb));

    // The surface this output pixel shows is the one drawn at uvNow: its depth and its point are read there too, so a
    // still point projects back to v_texCoord and the history is read where the unshifted picture has it.
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    float d = depthAt(screenTexel(uvNow, dsize), dsize);
    vec3 world = worldFromDepth(uvNow, d);
    vec4 prev = mat4(u_prevViewProjection0, u_prevViewProjection1,
                     u_prevViewProjection2, u_prevViewProjection3) * vec4(world, 1.0);
    vec2 puv = prev.xy / max(prev.w, 1e-6) * 0.5 + 0.5;
    bool inFront = prev.w > 1e-6;
    // A surface that moved by itself: the frame drew its displacement in a pass of its own, and where what it
    // drew is the surface the scene shows here (its depth agrees), that displacement says where this pixel was
    // — the camera's does not know about it. Anywhere else the camera's answer stands.
    ivec2 vsize = textureSize(u_velocity, 0);
    vec4 vel = texelFetch(u_velocity, screenTexel(uvNow, vsize), 0);
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
${IGN_GLSL}
/// The screen uv a world point lands on, and whether it is in front of the camera.
vec3 project(vec3 P) {
    vec4 c = u_projection * vec4(P, 1.0);
    return vec3(c.xy / max(c.w, 1e-6) * 0.5 + 0.5, c.w);
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
#pragma param u_coverActive float default(0) range(0,1)
#pragma param u_coverRange float default(3000) range(10,30000)
#pragma param u_coverBias float default(40) range(0,500)
#pragma param u_coverMatrix0 color default(1,0,0,0)
#pragma param u_coverMatrix1 color default(0,1,0,0)
#pragma param u_coverMatrix2 color default(0,0,1,0)
#pragma param u_coverMatrix3 color default(0,0,0,1)
#pragma param u_rainCover texture default(white)
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

/// 1 under a roof, an awning, a tree — the rain's own map of what stands over each place (see the Rain effect) — and 0 in the
/// open. The ground there is as dry as the rain left it: no film of water, no pools. Without a Rain effect there is no map, and
/// everything is open. The reach and the bias are the Rain effect's, handed over with its map.
float coveredAt(vec3 W) {
    if (u_coverActive < 0.5) return 0.0;
    vec4 c = mat4(u_coverMatrix0, u_coverMatrix1, u_coverMatrix2, u_coverMatrix3) * vec4(W, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    float stored = dot(texture(u_rainCover, uv).rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    float here = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
    return stored < here - u_coverBias / (4.0 * u_coverRange) ? 1.0 : 0.0;
}

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
    // Wet and pooled only where the rain reaches.
    float wetUp = (u_puddles > 0.0 || u_wetness > 0.0) ? flatUp * (1.0 - coveredAt(P)) : 0.0;
    float puddle = 0.0;
    if (u_puddles > 0.0) {
        puddle = puddleMask(P.xz, basinCoverage(c, size, P, u_puddles, u_puddleScale), u_puddleScale) * wetUp;
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), puddle));
    }
    // Wet ground is smoother than dry: a film of water fills the pores a rough surface scatters from.
    rough = mix(rough, rough * 0.35, u_wetness * wetUp);
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
${IGN_GLSL}
/// A direction over the hemisphere of N, cosine weighted, from two numbers in [0, 1).
vec3 cosineDirection(vec3 N, float u, float v) {
    float r = sqrt(u);
    float phi = 6.2831853 * v;
    vec3 up = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);
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
// The scene's albedo, beside its surface record (alpha 1 where a surface wrote one); black is "none written".
#pragma param u_sceneAlbedo texture default(black) texel(data)
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
    // The bounced light is reflected by the receiver's own diffuse colour, which it wrote beside its normal; a surface
    // that wrote none (a shader older than the attachment) has it guessed from the picture, kept below white.
    vec4 written = texelFetch(u_sceneAlbedo, min(c, textureSize(u_sceneAlbedo, 0) - ivec2(1)), 0);
    float lum = max(dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
    vec3 albedo = written.a > 0.5 ? written.rgb
                                  : mix(vec3(0.55), clamp(src.rgb / lum, vec3(0.0), vec3(1.6)) * 0.55, 0.7);
    fragColor = vec4(src.rgb + albedo * gathered * u_intensity, src.a);
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
${qualityUniformParam('contactShadowSteps')}
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const int CONTACT_SHADOW_STEPS_MAX = ${qualityUniformMax('contactShadowSteps')};

${SSAO_GLSL}

${IGN_GLSL}

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
    float steps = clamp(floor(u_contactShadowSteps), 1.0, float(CONTACT_SHADOW_STEPS_MAX));
    for (int i = 0; i < CONTACT_SHADOW_STEPS_MAX; ++i) {
        if (float(i) >= steps) break;
        float t = (float(i) + jitter + 0.5) / steps * u_length;
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
${qualityUniformParam('lightShaftSamples')}
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const int SAMPLES_MAX = ${qualityUniformMax('lightShaftSamples')};

${IGN_GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    ivec2 size = textureSize(u_sceneDepth, 0);
    float aspect = float(size.x) / float(size.y);
    vec2 toSun;
    float dist;
    if (u_camera.w > 0.5) {
        vec3 eye = worldFromDepth(v_texCoord, 0.0);
        vec4 clip = u_projection * vec4(eye + sun * 10000.0, 1.0);
        // Behind the camera there is no screen position to march toward.
        if (clip.w <= 1e-4) { fragColor = src; return; }
        vec2 sunUv = clip.xy / clip.w * 0.5 + 0.5;
        toSun = (sunUv - v_texCoord) * u_reach;
        dist = length(vec2((sunUv.x - v_texCoord.x) * aspect, sunUv.y - v_texCoord.y));
    } else {
        // An orthographic camera has no place on screen for the sun: it is at infinity, and every ray is parallel. It is taken as a
        // perspective camera of 60 degrees would have it, so the shafts keep their strength by how near the view is to facing the sun
        // (dist = tan(angle off the axis) / tan(30 degrees), one value for the whole frame) and run along the sun's direction on screen.
        // The rows of the view-projection are the camera's axes in the world, scaled.
        vec3 right = normalize(vec3(u_projection[0][0], u_projection[1][0], u_projection[2][0]));
        vec3 upAxis = normalize(vec3(u_projection[0][1], u_projection[1][1], u_projection[2][1]));
        // The depth row of an orthographic projection is negative (it maps the view's -z onto +z), so its direction is where the camera looks.
        vec3 forward = normalize(vec3(u_projection[0][2], u_projection[1][2], u_projection[2][2]));
        float front = dot(sun, forward);
        if (front <= 0.05) { fragColor = src; return; }
        vec2 across = vec2(dot(sun, right), dot(sun, upAxis));
        float reach2 = length(across);
        dist = (reach2 / front) / 0.57735;
        toSun = (reach2 > 1e-4 ? normalize(vec2(across.x / aspect, across.y)) : vec2(0.0)) * 0.5 * u_reach;
    }
    float samples = clamp(floor(u_shaftSamples), 1.0, float(SAMPLES_MAX));
    vec2 stepUv = toSun / samples;
    vec2 uv = v_texCoord + stepUv * ign(gl_FragCoord.xy);
    float light = 0.0;
    float weight = 1.0;
    float decay = pow(u_decay, float(SAMPLES_MAX) / samples);
    for (int i = 0; i < SAMPLES_MAX; ++i) {
        if (float(i) >= samples) break;
        uv += stepUv;
        ivec2 t = clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
        // Open sky is where the sun reaches; anything with a surface blocks it.
        float open = texelFetch(u_sceneDepth, t, 0).r >= 1.0 ? 1.0 : 0.0;
        light += open * weight;
        weight *= decay;
    }
    light /= samples;
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
#ifdef ES_LINEAR
#else
            // A gamma frame holds codes: the light they stand for is what is metered, or 18% grey would be sought as a code (46 of 255).
            c = srgbToLinear(c);
#endif
            float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
            if (lum > 0.0039) { sum += log2(lum); counted += 1.0; }
        }
    }
    float code = counted > 0.0 ? clamp((sum / counted + 12.0) / 20.0, 0.0, 1.0) : 0.0;
    fragColor = vec4(code, counted / 16.0, 0.0, 1.0);
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
#ifdef ES_LINEAR
    fragColor = vec4(scene.rgb * exp2(ev), scene.a);
#else
    // The gain is of light: a gamma frame's codes are decoded for it and encoded again.
    fragColor = vec4(linearToSrgb(srgbToLinear(scene.rgb) * exp2(ev)), scene.a);
#endif
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
        vec3 eye = worldFromDepth(vec2(u_focusX, 1.0 - u_focusY), u_camera.w > 0.5 ? 0.0 : 0.5);
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
        // An orthographic eye has no point to measure from; its depth range runs from far behind the camera to far ahead of it (near = -far), so the plane it
        // stands in is mid-depth, and a surface is as far as it is along the view.
        vec3 eye = u_camera.w > 0.5 ? u_camera.xyz : worldFromDepth(v_texCoord, 0.5);
        float dist = length(worldFromDepth(v_texCoord, depth) - eye);
        coc = min(u_aperture * max(abs(dist - focus) - u_focusRange, 0.0) / max(dist, 1e-3), u_maxBlur);
    }
    fragColor = vec4(src.rgb, coc);
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
const int TAPS_MAX = ${qualityUniformMax('dofSamples')};
const float TAU = 6.2831853;
${IGN_GLSL}
/// A point of the unit disc pushed out to the n-gon that has the disc as its circumscribing circle.
vec2 shapeTap(vec2 p, float blades, float turn) {
    if (blades < 2.5) return p;
    float a = atan(p.y, p.x) - turn;
    float sector = TAU / blades;
    float within = mod(a + sector * 0.5, sector) - sector * 0.5;
    return p * (cos(sector * 0.5) / cos(within));
}`;
        const source = `#pragma shader "PP DoF Gather"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_blades float default(0) range(0,9)
#pragma param u_bokehRotation float default(0) range(0,360)
#pragma param u_highlight float default(0) range(0,8)
${qualityUniformParam('dofSamples')}

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
    float taps = clamp(floor(u_dofTaps), 1.0, float(TAPS_MAX));
    for (int i = 0; i < TAPS_MAX; ++i) {
        if (float(i) >= taps) break;
        float k = float(i) + jitter;
        float r = sqrt((k + 0.5) / taps);
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
    // A surface too far off for this pass to measure is left open, faded out and not cut. Two things say so. Its radius is under a texel or two: its
    // samples are then the texels beside it, where the radius was clamped up to a size it was never asked for. And one step of the depth buffer there
    // is longer than the bias that keeps a flat surface from shading itself: the samples then vote occluded at random, differently each frame, and
    // the surface boils (a planet seen from space, whose near face is still a few texels to the radius).
    float depthStep = length(worldFromDepth(cuv, min(d + 1.0 / 16777216.0, 1.0)) - P);
    float reach = smoothstep(1.0, 2.5, u_radius / worldPerTexel) * (1.0 - smoothstep(0.25, 1.0, depthStep / max(u_bias * u_radius, 1e-6)));
    if (reach <= 0.0) { fragColor = vec4(1.0); return; }

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

    float ao = 1.0 - clamp(occl / float(K) * u_intensity, 0.0, 1.0) * reach;
    fragColor = vec4(vec3(pow(ao, u_power)), 1.0);
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
    float tol = worldPerTexel * SLOPE * max(1.0, float(dsize.x) / (2.0 * float(hsize.x)));
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
    ivec2 hsize = textureSize(u_texture, 0);
    float tol = worldPerTexel * SLOPE * max(1.0, float(dsize.x) / (2.0 * float(hsize.x)));
    float perDepth = worldPerDepth(cuv, d, P);

    // The four half-resolution texels this pixel falls between, in SCREEN texel
    // space so the bilinear weights mean the same on both backends.
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
