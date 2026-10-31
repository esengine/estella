// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    atmosphere.ts
 * @brief   The shader sources of the sky, fog and rain, installed by a package that uses one of them.
 */
import type { ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';
import { registerEffectSources } from '../effectSources';
import { rain2dEffects } from './rain2d';
import { fog2dEffects } from './fog2d';
import { SSAO_GLSL, SSAO_WGSL, PUDDLE_GLSL, PUDDLE_WGSL, BASIN_GLSL, BASIN_WGSL, GBUFFER_GLSL, GBUFFER_WGSL } from './shared';

export const atmosphereEffects = {
    ...rain2dEffects,
    ...fog2dEffects,
    /**
     * A sky that has a time of day and weather in it: the scattering of the atmosphere, a sun that goes red as it sets, a
     * moon, stars, and volumetric clouds that the sun lights.
     *
     * Pass 2 of 2, the composite. The clouds, and the shadow they cast on the ground, are the dear part and smooth, so the
     * first pass works them out at half size and this one reads them back by the way a pixel's neighbours agree with it
     * (see createSkyClouds); the dome, the sun, the moon and the stars, which have an edge, are drawn here at full size.
     */
    createSkyAtmosphere(): ShaderHandle {
        const source = `#pragma shader "PP Sky Atmosphere"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,8)
#pragma param u_panorama float default(0) range(0,1)
// A marker the engine reads, not a setting: with it declared (and the background not kept) the scene is cleared to nothing, so its alpha
// is how much of each pixel geometry covers and the sky is laid under it. See PostProcessPipeline::sceneCoverageWanted.
#pragma param u_sceneCoverage float default(1) range(0,1)
#pragma param u_overcast float default(0) range(0,1)
#pragma param u_haze float default(1) range(0,8)
#pragma param u_altitude float default(0.1) range(0,20)
#pragma param u_sunSize float default(1) range(0.2,8)
#pragma param u_sunBrightness float default(40) range(0,400)
#pragma param u_moon float default(1) range(0,4)
#pragma param u_stars float default(1) range(0,4)
#pragma param u_clouds float default(0.45) range(0,1)
#pragma param u_cloudBase float default(1.5) range(0.2,10)
#pragma param u_cloudThickness float default(2.5) range(0.2,8)
#pragma param u_cloudBrightness float default(1) range(0,4)
#pragma param u_windSpeed float default(0.05) range(0,2)
#pragma param u_windDirection float default(60) range(0,360)
#pragma param u_followSun float default(1) range(0,1)
#pragma param u_planetRadius float default(0) range(0,100000000)
#pragma param u_planetX float default(0) range(-100000000,100000000)
#pragma param u_planetY float default(0) range(-100000000,100000000)
#pragma param u_planetZ float default(0) range(-100000000,100000000)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(35) range(-90,90)
#pragma param u_cloudShadow float default(0) range(0,1)
#pragma param u_unitsPerKm float default(1000) range(1,100000)
#pragma param u_cloudMask texture default(black)
#pragma param u_cloudMaskTile float default(0) range(0,100)
#pragma param u_cloudMask2 texture default(black)
#pragma param u_cloudMask2Tile float default(0) range(0,100)
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const float R_E = 6360.0;
const float R_A = 6420.0;
const vec3 BETA_R = vec3(0.0058, 0.0135, 0.0331);
const float BETA_M = 0.021;
const float H_R = 8.0;
const float H_M = 1.2;
const float SUN_I = 22.0;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x);
    float b = mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x);
    float c = mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x);
    float d = mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

vec3 lin(vec3 c) {
#ifdef ES_LINEAR
    return srgbToLinear(c);
#else
    return c;
#endif
}

/// Where a ray from o along d meets the sphere of radius r about the planet's centre: the two distances, or -1 for a miss.
vec2 sphereHit(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float disc = b * b - (dot(o, o) - r * r);
    if (disc < 0.0) return vec2(-1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
}

/// The turn that takes up to +Y by the shortest way: the sky is worked out where up is +Y, so on a round world it is worked out in the frame of the ground the camera stands on.
mat3 upFrame(vec3 up) {
    vec3 v = vec3(-up.z, 0.0, up.x);
    float k = 1.0 / max(1.0 + up.y, 1e-4);
    mat3 cross = mat3(0.0, v.z, -v.y, -v.z, 0.0, v.x, v.y, -v.x, 0.0);
    return mat3(1.0) + cross + cross * cross * k;
}

/// The air between p and the top of the atmosphere along d, as (Rayleigh, Mie) optical depth; z is 0 where the planet is in the way.
vec3 lightDepth(vec3 p, vec3 d) {
    vec2 ground = sphereHit(p, d, R_E);
    if (ground.y > 0.0 && ground.x > 0.0) return vec3(0.0);
    float len = sphereHit(p, d, R_A).y;
    float ds = len / 4.0;
    vec2 od = vec2(0.0);
    for (int j = 0; j < 4; ++j) {
        vec3 q = p + d * (ds * (float(j) + 0.5));
        od += exp(-(length(q) - R_E) / vec2(H_R, H_M)) * ds;
    }
    return vec3(od, 1.0);
}

/// The sky's radiance along dir, by single scattering; @p sunTrans is the sun's light by the time it reaches the viewer.
vec3 scatter(vec3 dir, vec3 sun, float alt, float haze, out vec3 sunTrans) {
    vec3 o = vec3(0.0, R_E + alt, 0.0);
    float len = sphereHit(o, dir, R_A).y;
    const int N = 16;
    float ds = len / float(N);
    float mu = dot(dir, sun);
    float g = 0.76;
    float phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    float phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec2 od = vec2(0.0);
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    for (int i = 0; i < N; ++i) {
        vec3 p = o + dir * (ds * (float(i) + 0.5));
        vec2 dens = exp(-(length(p) - R_E) / vec2(H_R, H_M)) * ds;
        od += dens;
        vec3 ol = lightDepth(p, sun);
        if (ol.z > 0.5) {
            vec3 attn = exp(-(BETA_R * (od.x + ol.x) + BETA_M * haze * 1.1 * (od.y + ol.y)));
            sumR += attn * dens.x;
            sumM += attn * dens.y;
        }
    }
    vec3 st = lightDepth(o, sun);
    sunTrans = st.z > 0.5 ? exp(-(BETA_R * st.x + BETA_M * haze * 1.1 * st.y)) : vec3(0.0);
    return (sumR * BETA_R * phaseR + sumM * BETA_M * haze * phaseM) * SUN_I;
}

/// Where a coverage texture is given, the shape of the clouds on the ground is its, and the noise erodes it. The layers are tiled in kilometres
/// of the cloud plane, the second a softer, higher one folded in.
float cloudField(vec2 xz, float noise, float h) {
    if (u_cloudMaskTile <= 0.0) return noise;
    float m = textureLod(u_cloudMask, xz / u_cloudMaskTile, 0.0).r;
    if (u_cloudMask2Tile > 0.0) m = mix(m, textureLod(u_cloudMask2, xz / u_cloudMask2Tile, 0.0).r, 0.3);
    // A mask knows nothing of height, and a column of it seen along the slab is a streak: the cloud's top stands only over the mask's core, a dome.
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

float cloudDensity(vec3 p, float coverage, float base, float thick, int octaves) {
    float h = clamp((p.y - base) / thick, 0.0, 1.0);
    float shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    vec3 q = vec3(p.x, p.y * 1.8, p.z) * 0.32;
    float n = vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28;
    if (octaves > 2) n += vnoise(q * 4.7) * 0.14;
    else n += 0.07;
    n = cloudField(p.xz, n, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}

/// How much of the sun reaches a surface at @p world through the cloud layer: 1 is all of it. The sun's ray is marched up through
/// the slab against the same density the sky draws, so a shadow falls where the cloud above it is. Ambient light is not shadowed.
float cloudShadowAt(vec3 world, vec3 cam, vec3 sun, float coverage, float overcast, vec3 drift) {
    float strength = u_cloudShadow * smoothstep(0.02, 0.14, sun.y);
    if (strength <= 0.001 || coverage <= 0.01) return 1.0;
    float k = 1.0 / max(u_unitsPerKm, 1e-3);
    float h = u_altitude + (world.y - cam.y) * k;
    float tt = (u_cloudBase + u_cloudThickness - h) / sun.y;
    if (tt <= 0.0) return 1.0;
    float tb = max(u_cloudBase - h, 0.0) / sun.y;
    const int N = 6;
    float ds = (tt - tb) / float(N);
    float sigma = 1.3 * (1.0 + overcast * 1.5);
    float tau = 0.0;
    float jitter = ign(gl_FragCoord.xy);
    for (int i = 0; i < N; ++i) {
        float t = tb + (float(i) + jitter) * ds;
        vec3 p = vec3(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau += cloudDensity(p, coverage, u_cloudBase, u_cloudThickness, 2) * sigma * ds;
    }
    return 1.0 - strength * 0.8 * (1.0 - exp(-tau));
}
/// The cloud slab along @p dir as a map of what is behind it, colour * T + L: how much of it the clouds let through, and the light they add.
/// A function of the direction alone, so it can be worked out small and read back big.
void cloudLayer(vec3 dir, vec3 sun, vec3 dome, vec3 sunTrans, float night, float overcast, vec3 windDrift, out vec3 L, out float T) {
    L = vec3(0.0);
    T = 1.0;
    float coverage = max(u_clouds, overcast * 0.95);
    if (coverage > 0.01 && dir.y > 0.01) {
        float base = u_cloudBase;
        float thick = u_cloudThickness;
        float tb = max(base - u_altitude, 0.0) / dir.y;
        float tt = (base + thick - u_altitude) / dir.y;
        const int STEPS = 16;
        float ds = (tt - tb) / float(STEPS);
        float jitter = ign(gl_FragCoord.xy);
        float sigma = 1.3 * (1.0 + overcast * 1.5);
        vec3 drift = windDrift;
        float cosS = dot(dir, sun);
        float phase = mix(0.35 + 0.65 * pow(max(cosS, 0.0), 6.0), 0.5, 0.4);
        vec3 ambient = dome * 0.7 + lin(vec3(0.55, 0.65, 0.9)) * 0.015 * night;
        vec3 sunLight = sunTrans * 1.2 * u_cloudBrightness;
        float trans = 1.0;
        vec3 lit = vec3(0.0);
        for (int i = 0; i < STEPS; ++i) {
            if (trans < 0.02) break;
            float t = tb + (float(i) + jitter) * ds;
            vec3 p = vec3(dir.x * t, u_altitude + dir.y * t, dir.z * t) + drift;
            float d = cloudDensity(p, coverage, base, thick, 3);
            if (d < 0.002) continue;
            float tau = 0.0;
            for (int k = 1; k <= 3; ++k) {
                vec3 q = p + sun * (0.35 * float(k));
                tau += cloudDensity(q, coverage, base, thick, 2) * 0.35 * sigma;
            }
            float energy = exp(-tau * 1.1) + 0.25 * exp(-tau * 0.25);
            vec3 S = sunLight * energy * phase * 2.0 + ambient;
            float ext = d * sigma * ds;
            float tr = exp(-ext);
            lit += trans * (1.0 - tr) * S;
            trans *= tr;
        }
        float fade = smoothstep(0.01, 0.14, dir.y);
        T = mix(1.0, trans, fade);
        L = lit * fade;
    }

}
${SSAO_GLSL}

const float UP_MIN_WEIGHT = 0.15;

/// The cloud layer for a sky pixel, read from the half-size pass: the sky texels among the four it falls between (a surface's
/// texel has a negative alpha), by bilinear weight. False when none of them is sky, and the pixel works it out itself.
bool upsampledClouds(out vec3 L, out float T) {
    ivec2 hsize = textureSize(u_texture, 0);
    vec2 hf = v_texCoord * vec2(hsize) - 0.5;
    ivec2 base = ivec2(floor(hf));
    vec2 fr = hf - vec2(base);
    vec4 sum = vec4(0.0);
    float wsum = 0.0;
    for (int j = 0; j < 4; ++j) {
        ivec2 o = ivec2(j & 1, j >> 1);
        vec4 h = texelFetch(u_texture, clamp(base + o, ivec2(0), hsize - ivec2(1)), 0);
        if (h.a < 0.0) continue;
        float bw = (o.x == 1 ? fr.x : 1.0 - fr.x) * (o.y == 1 ? fr.y : 1.0 - fr.y);
        sum += h * bw;
        wsum += bw;
    }
    if (wsum < UP_MIN_WEIGHT) return false;
    sum /= wsum;
    L = sum.rgb;
    T = sum.a;
    return true;
}

/// The cloud shadow on a surface, read from the half-size pass: the surface texels among the four the pixel falls between, each weighted
/// by how near its point in the world is to this pixel's, so a texel across a silhouette does not lend its shadow. False when none is near.
bool upsampledShadow(vec3 P, vec3 entry, out float lit) {
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 hsize = textureSize(u_texture, 0);
    vec2 hf = v_texCoord * vec2(hsize) - 0.5;
    ivec2 base = ivec2(floor(hf));
    vec2 fr = hf - vec2(base);
    float tol = max(0.08 * length(P - entry), 1e-4);
    float sum = 0.0;
    float wsum = 0.0;
    for (int j = 0; j < 4; ++j) {
        ivec2 o = ivec2(j & 1, j >> 1);
        ivec2 t = clamp(base + o, ivec2(0), hsize - ivec2(1));
        vec4 h = texelFetch(u_texture, t, 0);
        if (h.a >= 0.0) continue;
        vec2 uv = uvOfTexel(t, hsize);
        vec3 Pj = worldFromDepth(uv, depthAt(screenTexel(uv, dsize), dsize));
        float bw = (o.x == 1 ? fr.x : 1.0 - fr.x) * (o.y == 1 ? fr.y : 1.0 - fr.y);
        float w = bw * max(1.0 - length(Pj - P) / tol, 0.0);
        sum += h.r * w;
        wsum += w;
    }
    if (wsum < UP_MIN_WEIGHT) return false;
    lit = sum / wsum;
    return true;
}

void main() {
    vec4 src = texture(u_sceneTexture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1)), 0).r;
    // The scene was cleared to nothing when the background is not kept (the engine's rule, same threshold): what is left of a pixel's
    // alpha is how much the sky shows through it, and that includes a pixel whose depth says surface because one sample of it is.
    bool covered = u_panorama <= 0.001;
    bool geometry = covered ? (depth < 1.0 && src.a > 0.999) : depth < 1.0;
    if (geometry && u_cloudShadow <= 0.001) { fragColor = src; return; }

    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    vec3 dir = normalize(worldFromDepth(v_texCoord, 1.0) - entry);

    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (u_planetRadius > 0.0) {
        // Up is away from the planet's centre where the camera is: the direction and the sun are turned into the frame where that is +Y.
        mat3 frame = upFrame(normalize(entry + u_renderOrigin.xyz - vec3(u_planetX, u_planetY, u_planetZ)));
        dir = frame * dir;
        sun = frame * sun;
    }
    float se = sun.y;

    float overcast = clamp(u_overcast, 0.0, 1.0);
    float haze = u_haze * (1.0 + overcast * 2.0);

    // Clouds that cast shadows are in the world, not on the camera: the pattern is anchored to where the camera stands.
    bool shadowed = u_cloudShadow > 0.001;
    vec3 entryWorld = entry + u_renderOrigin.xyz;
    vec3 anchor = shadowed ? vec3(entryWorld.x, 0.0, entryWorld.z) / max(u_unitsPerKm, 1e-3) : vec3(0.0);
    float windAngle = radians(u_windDirection);
    vec3 windDrift = vec3(sin(windAngle), 0.0, cos(windAngle)) * (u_windSpeed * u_time.x) + anchor;
    if (geometry) {
        float lit;
        if (!upsampledShadow(worldFromDepth(v_texCoord, depth), entry, lit)) {
            lit = cloudShadowAt(worldFromDepth(v_texCoord, depth) + u_renderOrigin.xyz, entryWorld, sun, max(u_clouds, overcast * 0.95), overcast, windDrift - anchor);
        }
        fragColor = vec4(src.rgb * lit, src.a);
        return;
    }

    // The dome. Below the horizon there is no sky: the ray is flattened onto it so a camera that looks down sees the haze there.
    vec3 sdir = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
    vec3 sunTrans;
    vec3 col = scatter(sdir, sun, u_altitude, haze, sunTrans) * 0.55 * u_intensity;
    // Below the horizon there is no sky, only the dimmer light the ground sends up.
    col *= 1.0 - 0.75 * smoothstep(0.0, -0.3, dir.y);
    // What the air keeps of the night: a faint glow so the dome is not black where there is no moon.
    float night = 1.0 - smoothstep(-0.10, 0.12, se);
    col += mix(lin(vec3(0.003, 0.006, 0.02)), lin(vec3(0.016, 0.024, 0.06)), pow(1.0 - max(dir.y, 0.0), 3.0)) * night;
    vec3 dome = col;

    // The sun: a disc as bright as the light that reaches us, so it is white overhead and red at the horizon.
    float cosd = dot(dir, sun);
    float sunR = radians(0.265 * u_sunSize);
    float disc = smoothstep(cos(sunR * 1.15), cos(sunR * 0.85), cosd);
    float above = smoothstep(-0.02, 0.02, dir.y);
    col += sunTrans * disc * u_sunBrightness * above * (1.0 - overcast);

    // The moon stands opposite the sun and a little above where it would be, so it is up when the sun is well down.
    float sAz = atan(sun.x, sun.z);
    float sEl = asin(clamp(sun.y, -1.0, 1.0));
    float mEl = -sEl * 0.85 + radians(12.0);
    float mAz = sAz + 3.14159265;
    vec3 moon = vec3(cos(mEl) * sin(mAz), sin(mEl), cos(mEl) * cos(mAz));
    float md = dot(dir, moon);
    float moonR = radians(0.26 * 2.5);
    float moonDisc = smoothstep(cos(moonR * 1.1), cos(moonR * 0.9), md);
    float moonGlow = pow(max(md, 0.0), 2500.0) * 0.5 + pow(max(md, 0.0), 60.0) * 0.015;
    col += lin(vec3(0.80, 0.88, 1.0)) * ((moonDisc * 3.0 + moonGlow) * u_moon * night * smoothstep(-0.02, 0.04, dir.y));

    // Stars: a point in some of the cells of a lattice over the sphere, brighter and more coloured at random.
    if (night > 0.02 && dir.y > 0.0 && u_stars > 0.0) {
        vec3 p = dir * 180.0;
        vec3 id = floor(p);
        vec3 fr = p - id;
        float h = hash13(id);
        if (h > 0.965) {
            vec3 c = vec3(hash13(id + 7.1), hash13(id + 13.3), hash13(id + 3.7)) * 0.6 + 0.2;
            float spot = smoothstep(0.22, 0.02, length(fr - c));
            float bright = (0.4 + hash13(id + 1.7) * 1.6) * (h > 0.995 ? 3.0 : 1.0);
            vec3 tint = mix(lin(vec3(1.0, 0.85, 0.7)), lin(vec3(0.7, 0.8, 1.0)), hash13(id + 5.3));
            float seen = night * night * smoothstep(0.05, -0.15, se) * smoothstep(0.0, 0.15, dir.y) * (1.0 - 0.9 * smoothstep(0.97, 0.999, md));
            col += tint * (spot * bright * 2.5 * u_stars * seen);
        }
    }

    // Clouds: read from the half-size pass, worked out here only where it has nothing for this pixel (a gap in a skyline).
    if (max(u_clouds, overcast * 0.95) > 0.01 && dir.y > 0.01) {
        vec3 L;
        float T;
        if (!upsampledClouds(L, T)) cloudLayer(dir, sun, dome, sunTrans, night, overcast, windDrift, L, T);
        col = col * T + L;
    }

    // An overcast sky is also a little greyer than the cloud-free one under it.
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(luma), overcast * 0.5);

    if (covered) {
        // Under the geometry by its coverage; a mark in the alpha (a scattering surface's 0.996) is kept, a partial edge becomes whole.
        fragColor = vec4(src.rgb + (1.0 - src.a) * col, src.a > 0.99 ? src.a : 1.0);
        return;
    }
    fragColor = vec4(mix(col, src.rgb, clamp(u_panorama, 0.0, 1.0)), src.a);
}
#pragma end

#pragma fragment wgsl
const R_E : f32 = 6360.0;
const R_A : f32 = 6420.0;
const BETA_R : vec3f = vec3f(0.0058, 0.0135, 0.0331);
const BETA_M : f32 = 0.021;
const H_R : f32 = 8.0;
const H_M : f32 = 1.2;
const SUN_I : f32 = 22.0;

fn hash13(p0 : vec3f) -> f32 {
    var p = fract(p0 * 0.1031);
    p = p + dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn vnoise(p : vec3f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = mix(hash13(i), hash13(i + vec3f(1, 0, 0)), f.x);
    let b = mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), f.x);
    let c = mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), f.x);
    let d = mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

fn lin(c : vec3f) -> vec3f {
#ifdef ES_LINEAR
    return srgbToLinear(c);
#else
    return c;
#endif
}

fn sphereHit(o : vec3f, d : vec3f, r : f32) -> vec2f {
    let b = dot(o, d);
    let disc = b * b - (dot(o, o) - r * r);
    if (disc < 0.0) { return vec2f(-1.0); }
    let s = sqrt(disc);
    return vec2f(-b - s, -b + s);
}

fn lightDepth(p : vec3f, d : vec3f) -> vec3f {
    let ground = sphereHit(p, d, R_E);
    if (ground.y > 0.0 && ground.x > 0.0) { return vec3f(0.0); }
    let len = sphereHit(p, d, R_A).y;
    let ds = len / 4.0;
    var od = vec2f(0.0);
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let q = p + d * (ds * (f32(j) + 0.5));
        od = od + exp(-(length(q) - R_E) / vec2f(H_R, H_M)) * ds;
    }
    return vec3f(od, 1.0);
}

struct Scatter { radiance : vec3f, sunTrans : vec3f };

fn scatter(dir : vec3f, sun : vec3f, alt : f32, haze : f32) -> Scatter {
    let o = vec3f(0.0, R_E + alt, 0.0);
    let len = sphereHit(o, dir, R_A).y;
    let N = 16;
    let ds = len / f32(N);
    let mu = dot(dir, sun);
    let g = 0.76;
    let phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    let phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    var od = vec2f(0.0);
    var sumR = vec3f(0.0);
    var sumM = vec3f(0.0);
    for (var i : i32 = 0; i < N; i = i + 1) {
        let p = o + dir * (ds * (f32(i) + 0.5));
        let dens = exp(-(length(p) - R_E) / vec2f(H_R, H_M)) * ds;
        od = od + dens;
        let ol = lightDepth(p, sun);
        if (ol.z > 0.5) {
            let attn = exp(-(BETA_R * (od.x + ol.x) + BETA_M * haze * 1.1 * (od.y + ol.y)));
            sumR = sumR + attn * dens.x;
            sumM = sumM + attn * dens.y;
        }
    }
    let st = lightDepth(o, sun);
    var trans = vec3f(0.0);
    if (st.z > 0.5) { trans = exp(-(BETA_R * st.x + BETA_M * haze * 1.1 * st.y)); }
    var out : Scatter;
    out.radiance = (sumR * BETA_R * phaseR + sumM * BETA_M * haze * phaseM) * SUN_I;
    out.sunTrans = trans;
    return out;
}

fn cloudField(xz : vec2f, noise : f32, h : f32) -> f32 {
    if (mc.u_cloudMaskTile <= 0.0) { return noise; }
    var m = textureSampleLevel(u_cloudMask, u_cloudMask_s, xz / mc.u_cloudMaskTile, 0.0).r;
    if (mc.u_cloudMask2Tile > 0.0) { m = mix(m, textureSampleLevel(u_cloudMask2, u_cloudMask2_s, xz / mc.u_cloudMask2Tile, 0.0).r, 0.3); }
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

fn cloudDensity(p : vec3f, coverage : f32, base : f32, thick : f32, octaves : i32) -> f32 {
    let h = clamp((p.y - base) / thick, 0.0, 1.0);
    let shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    let q = vec3f(p.x, p.y * 1.8, p.z) * 0.32;
    var n = vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28;
    if (octaves > 2) { n = n + vnoise(q * 4.7) * 0.14; } else { n = n + 0.07; }
    n = cloudField(p.xz, n, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}

fn frame_origin() -> vec3f { return frame.renderOrigin.xyz; }

/// The turn that takes up to +Y by the shortest way: the sky is worked out where up is +Y, so on a round world in the frame of the ground the camera stands on.
fn upFrame(up : vec3f) -> mat3x3f {
    let v = vec3f(-up.z, 0.0, up.x);
    let k = 1.0 / max(1.0 + up.y, 1e-4);
    let cross = mat3x3f(vec3f(0.0, v.z, -v.y), vec3f(-v.z, 0.0, v.x), vec3f(v.y, -v.x, 0.0));
    return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0)) + cross + (cross * cross) * k;
}

fn cloudShadowAt(world : vec3f, cam : vec3f, sun : vec3f, coverage : f32, overcast : f32, drift : vec3f, px : vec2f) -> f32 {
    let strength = mc.u_cloudShadow * smoothstep(0.02, 0.14, sun.y);
    if (strength <= 0.001 || coverage <= 0.01) { return 1.0; }
    let k = 1.0 / max(mc.u_unitsPerKm, 1e-3);
    let h = mc.u_altitude + (world.y - cam.y) * k;
    let tt = (mc.u_cloudBase + mc.u_cloudThickness - h) / sun.y;
    if (tt <= 0.0) { return 1.0; }
    let tb = max(mc.u_cloudBase - h, 0.0) / sun.y;
    let N = 6;
    let ds = (tt - tb) / f32(N);
    let sigma = 1.3 * (1.0 + overcast * 1.5);
    var tau = 0.0;
    let jitter = ign(px);
    for (var i : i32 = 0; i < N; i = i + 1) {
        let t = tb + (f32(i) + jitter) * ds;
        let p = vec3f(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau = tau + cloudDensity(p, coverage, mc.u_cloudBase, mc.u_cloudThickness, 2) * sigma * ds;
    }
    return 1.0 - strength * 0.8 * (1.0 - exp(-tau));
}

struct CloudLayer { L : vec3f, T : f32 };

/// The cloud slab along dir as a map of what is behind it, colour * T + L. A function of the direction alone, so it can be worked out small and read back big.
fn cloudLayer(dir : vec3f, sun : vec3f, dome : vec3f, sunTrans : vec3f, night : f32, overcast : f32, windDrift : vec3f, px : vec2f) -> CloudLayer {
    var out : CloudLayer;
    out.L = vec3f(0.0);
    out.T = 1.0;
    let coverage = max(mc.u_clouds, overcast * 0.95);
    if (coverage > 0.01 && dir.y > 0.01) {
        let base = mc.u_cloudBase;
        let thick = mc.u_cloudThickness;
        let tb = max(base - mc.u_altitude, 0.0) / dir.y;
        let tt = (base + thick - mc.u_altitude) / dir.y;
        let STEPS = 16;
        let ds = (tt - tb) / f32(STEPS);
        let jitter = ign(px);
        let sigma = 1.3 * (1.0 + overcast * 1.5);
        let drift = windDrift;
        let cosS = dot(dir, sun);
        let phase = mix(0.35 + 0.65 * pow(max(cosS, 0.0), 6.0), 0.5, 0.4);
        let ambient = dome * 0.7 + lin(vec3f(0.55, 0.65, 0.9)) * 0.015 * night;
        let sunLight = sunTrans * 1.2 * mc.u_cloudBrightness;
        var trans = 1.0;
        var lit = vec3f(0.0);
        for (var i : i32 = 0; i < STEPS; i = i + 1) {
            if (trans < 0.02) { break; }
            let t = tb + (f32(i) + jitter) * ds;
            let p = vec3f(dir.x * t, mc.u_altitude + dir.y * t, dir.z * t) + drift;
            let d = cloudDensity(p, coverage, base, thick, 3);
            if (d < 0.002) { continue; }
            var tau = 0.0;
            for (var k : i32 = 1; k <= 3; k = k + 1) {
                let q = p + sun * (0.35 * f32(k));
                tau = tau + cloudDensity(q, coverage, base, thick, 2) * 0.35 * sigma;
            }
            let energy = exp(-tau * 1.1) + 0.25 * exp(-tau * 0.25);
            let S = sunLight * energy * phase * 2.0 + ambient;
            let ext = d * sigma * ds;
            let tr = exp(-ext);
            lit = lit + trans * (1.0 - tr) * S;
            trans = trans * tr;
        }
        let fade = smoothstep(0.01, 0.14, dir.y);
        out.T = mix(1.0, trans, fade);
        out.L = lit * fade;
    }

    return out;
}
${SSAO_WGSL}

const UP_MIN_WEIGHT : f32 = 0.15;

struct CloudRead { ok : bool, L : vec3f, T : f32 };

/// The cloud layer for a sky pixel, read from the half-size pass: the sky texels among the four it falls between (a surface's texel has a
/// negative alpha), by bilinear weight. Not ok when none of them is sky, and the pixel works it out itself.
fn upsampledClouds(uv : vec2f) -> CloudRead {
    var out : CloudRead;
    out.ok = false;
    let hsize = vec2i(textureDimensions(t0, 0));
    let hf = uv * vec2f(hsize) - 0.5;
    let base = vec2i(floor(hf));
    let fr = hf - vec2f(base);
    var sum = vec4f(0.0);
    var wsum = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let o = vec2i(j & 1, j >> 1);
        let h = textureLoad(t0, clamp(base + o, vec2i(0), hsize - vec2i(1)), 0);
        if (h.a < 0.0) { continue; }
        var bx = 1.0 - fr.x;
        if (o.x == 1) { bx = fr.x; }
        var by = 1.0 - fr.y;
        if (o.y == 1) { by = fr.y; }
        let bw = bx * by;
        sum = sum + h * bw;
        wsum = wsum + bw;
    }
    if (wsum < UP_MIN_WEIGHT) { return out; }
    sum = sum / wsum;
    out.ok = true;
    out.L = sum.rgb;
    out.T = sum.a;
    return out;
}

struct ShadowRead { ok : bool, lit : f32 };

/// The cloud shadow on a surface, read from the half-size pass: the surface texels among the four the pixel falls between, each weighted by how
/// near its point in the world is to this pixel's, so a texel across a silhouette does not lend its shadow. Not ok when none is near.
fn upsampledShadow(uv : vec2f, P : vec3f, entry : vec3f) -> ShadowRead {
    var out : ShadowRead;
    out.ok = false;
    let dsize = vec2i(textureDimensions(t7, 0));
    let hsize = vec2i(textureDimensions(t0, 0));
    let hf = uv * vec2f(hsize) - 0.5;
    let base = vec2i(floor(hf));
    let fr = hf - vec2f(base);
    let tol = max(0.08 * length(P - entry), 1e-4);
    var sum = 0.0;
    var wsum = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let o = vec2i(j & 1, j >> 1);
        let t = clamp(base + o, vec2i(0), hsize - vec2i(1));
        let h = textureLoad(t0, t, 0);
        if (h.a >= 0.0) { continue; }
        let tuv = uvOfTexel(t, hsize);
        let Pj = worldFromDepth(tuv, depthAt(screenTexel(tuv, dsize), dsize));
        var bx = 1.0 - fr.x;
        if (o.x == 1) { bx = fr.x; }
        var by = 1.0 - fr.y;
        if (o.y == 1) { by = fr.y; }
        let w = bx * by * max(1.0 - length(Pj - P) / tol, 0.0);
        sum = sum + h.r * w;
        wsum = wsum + w;
    }
    if (wsum < UP_MIN_WEIGHT) { return out; }
    out.ok = true;
    out.lit = sum / wsum;
    return out;
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let depth = textureLoad(t7, clamp(vec2i(v.v_texCoord * vec2f(size)), vec2i(0), size - vec2i(1)), 0);
    let covered = mc.u_panorama <= 0.001;
    let geometry = (covered && depth < 1.0 && src.a > 0.999) || (!covered && depth < 1.0);
    if (geometry && mc.u_cloudShadow <= 0.001) { return src; }

    let entry = worldFromDepth(v.v_texCoord, 0.0);
    var dir = normalize(worldFromDepth(v.v_texCoord, 1.0) - entry);

    let found = findSun();
    let follow = mc.u_followSun > 0.5 && found.dir.w > 0.5;
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (follow) { sun = found.dir.xyz; }
    if (mc.u_planetRadius > 0.0) {
        let frame = upFrame(normalize(entry + frame_origin() - vec3f(mc.u_planetX, mc.u_planetY, mc.u_planetZ)));
        dir = frame * dir;
        sun = frame * sun;
    }
    let se = sun.y;

    let overcast = clamp(mc.u_overcast, 0.0, 1.0);
    let haze = mc.u_haze * (1.0 + overcast * 2.0);

    let entryWorld = entry + frame.renderOrigin.xyz;
    var anchor = vec3f(0.0);
    if (mc.u_cloudShadow > 0.001) { anchor = vec3f(entryWorld.x, 0.0, entryWorld.z) / max(mc.u_unitsPerKm, 1e-3); }
    let windAngle = radians(mc.u_windDirection);
    let windDrift = vec3f(sin(windAngle), 0.0, cos(windAngle)) * (mc.u_windSpeed * tc.u_time.x) + anchor;
    if (geometry) {
        var lit = 1.0;
        let up = upsampledShadow(v.v_texCoord, worldFromDepth(v.v_texCoord, depth), entry);
        if (up.ok) { lit = up.lit; } else { lit = cloudShadowAt(worldFromDepth(v.v_texCoord, depth) + frame.renderOrigin.xyz, entryWorld, sun, max(mc.u_clouds, overcast * 0.95), overcast, windDrift - anchor, v.pos.xy); }
        return vec4f(src.rgb * lit, src.a);
    }

    let sdir = normalize(vec3f(dir.x, max(dir.y, 0.015), dir.z));
    let sc = scatter(sdir, sun, mc.u_altitude, haze);
    let sunTrans = sc.sunTrans;
    var col = sc.radiance * 0.55 * mc.u_intensity;
    col = col * (1.0 - 0.75 * smoothstep(0.0, -0.3, dir.y));
    let night = 1.0 - smoothstep(-0.10, 0.12, se);
    col = col + mix(lin(vec3f(0.003, 0.006, 0.02)), lin(vec3f(0.016, 0.024, 0.06)), pow(1.0 - max(dir.y, 0.0), 3.0)) * night;
    let dome = col;

    let cosd = dot(dir, sun);
    let sunR = radians(0.265 * mc.u_sunSize);
    let disc = smoothstep(cos(sunR * 1.15), cos(sunR * 0.85), cosd);
    let above = smoothstep(-0.02, 0.02, dir.y);
    col = col + sunTrans * disc * mc.u_sunBrightness * above * (1.0 - overcast);

    let sAz = atan2(sun.x, sun.z);
    let sEl = asin(clamp(sun.y, -1.0, 1.0));
    let mEl = -sEl * 0.85 + radians(12.0);
    let mAz = sAz + 3.14159265;
    let moon = vec3f(cos(mEl) * sin(mAz), sin(mEl), cos(mEl) * cos(mAz));
    let md = dot(dir, moon);
    let moonR = radians(0.26 * 2.5);
    let moonDisc = smoothstep(cos(moonR * 1.1), cos(moonR * 0.9), md);
    let moonGlow = pow(max(md, 0.0), 2500.0) * 0.5 + pow(max(md, 0.0), 60.0) * 0.015;
    col = col + lin(vec3f(0.80, 0.88, 1.0)) * ((moonDisc * 3.0 + moonGlow) * mc.u_moon * night * smoothstep(-0.02, 0.04, dir.y));

    if (night > 0.02 && dir.y > 0.0 && mc.u_stars > 0.0) {
        let p = dir * 180.0;
        let id = floor(p);
        let fr = p - id;
        let h = hash13(id);
        if (h > 0.965) {
            let c = vec3f(hash13(id + 7.1), hash13(id + 13.3), hash13(id + 3.7)) * 0.6 + 0.2;
            let spot = smoothstep(0.22, 0.02, length(fr - c));
            var bright = 0.4 + hash13(id + 1.7) * 1.6;
            if (h > 0.995) { bright = bright * 3.0; }
            let tint = mix(lin(vec3f(1.0, 0.85, 0.7)), lin(vec3f(0.7, 0.8, 1.0)), hash13(id + 5.3));
            let seen = night * night * smoothstep(0.05, -0.15, se) * smoothstep(0.0, 0.15, dir.y) * (1.0 - 0.9 * smoothstep(0.97, 0.999, md));
            col = col + tint * (spot * bright * 2.5 * mc.u_stars * seen);
        }
    }

    if (max(mc.u_clouds, overcast * 0.95) > 0.01 && dir.y > 0.01) {
        var cl : CloudLayer;
        let up = upsampledClouds(v.v_texCoord);
        if (up.ok) {
            cl.L = up.L;
            cl.T = up.T;
        } else {
            cl = cloudLayer(dir, sun, dome, sunTrans, night, overcast, windDrift, v.pos.xy);
        }
        col = col * cl.T + cl.L;
    }

    let luma = dot(col, vec3f(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3f(luma), overcast * 0.5);

    if (covered) {
        return vec4f(src.rgb + (1.0 - src.a) * col, select(1.0, src.a, src.a > 0.99));
    }
    return vec4f(mix(col, src.rgb, vec3f(clamp(mc.u_panorama, 0.0, 1.0))), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * The sky's clouds and their shadow on the ground, at half size: pass 1 of 2. Each texel stands for the pixels under it and
     * keeps either the cloud layer in front of a sky pixel (what it lets through, and the light it adds) or the light that
     * reaches a surface, which of the two the depth says. The composite reads these back.
     */
    createSkyClouds(): ShaderHandle {
        const source = `#pragma shader "PP Sky Clouds"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,8)
#pragma param u_panorama float default(0) range(0,1)
// A marker the engine reads, not a setting: with it declared (and the background not kept) the scene is cleared to nothing, so its alpha
// is how much of each pixel geometry covers and the sky is laid under it. See PostProcessPipeline::sceneCoverageWanted.
#pragma param u_sceneCoverage float default(1) range(0,1)
#pragma param u_overcast float default(0) range(0,1)
#pragma param u_haze float default(1) range(0,8)
#pragma param u_altitude float default(0.1) range(0,20)
#pragma param u_sunSize float default(1) range(0.2,8)
#pragma param u_sunBrightness float default(40) range(0,400)
#pragma param u_moon float default(1) range(0,4)
#pragma param u_stars float default(1) range(0,4)
#pragma param u_clouds float default(0.45) range(0,1)
#pragma param u_cloudBase float default(1.5) range(0.2,10)
#pragma param u_cloudThickness float default(2.5) range(0.2,8)
#pragma param u_cloudBrightness float default(1) range(0,4)
#pragma param u_windSpeed float default(0.05) range(0,2)
#pragma param u_windDirection float default(60) range(0,360)
#pragma param u_followSun float default(1) range(0,1)
#pragma param u_planetRadius float default(0) range(0,100000000)
#pragma param u_planetX float default(0) range(-100000000,100000000)
#pragma param u_planetY float default(0) range(-100000000,100000000)
#pragma param u_planetZ float default(0) range(-100000000,100000000)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(35) range(-90,90)
#pragma param u_cloudShadow float default(0) range(0,1)
#pragma param u_unitsPerKm float default(1000) range(1,100000)
#pragma param u_cloudMask texture default(black)
#pragma param u_cloudMaskTile float default(0) range(0,100)
#pragma param u_cloudMask2 texture default(black)
#pragma param u_cloudMask2Tile float default(0) range(0,100)
#pragma lights
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const float R_E = 6360.0;
const float R_A = 6420.0;
const vec3 BETA_R = vec3(0.0058, 0.0135, 0.0331);
const float BETA_M = 0.021;
const float H_R = 8.0;
const float H_M = 1.2;
const float SUN_I = 22.0;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x);
    float b = mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x);
    float c = mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x);
    float d = mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

vec3 lin(vec3 c) {
#ifdef ES_LINEAR
    return srgbToLinear(c);
#else
    return c;
#endif
}

/// Where a ray from o along d meets the sphere of radius r about the planet's centre: the two distances, or -1 for a miss.
vec2 sphereHit(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float disc = b * b - (dot(o, o) - r * r);
    if (disc < 0.0) return vec2(-1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
}

/// The turn that takes up to +Y by the shortest way: the sky is worked out where up is +Y, so on a round world it is worked out in the frame of the ground the camera stands on.
mat3 upFrame(vec3 up) {
    vec3 v = vec3(-up.z, 0.0, up.x);
    float k = 1.0 / max(1.0 + up.y, 1e-4);
    mat3 cross = mat3(0.0, v.z, -v.y, -v.z, 0.0, v.x, v.y, -v.x, 0.0);
    return mat3(1.0) + cross + cross * cross * k;
}

/// The air between p and the top of the atmosphere along d, as (Rayleigh, Mie) optical depth; z is 0 where the planet is in the way.
vec3 lightDepth(vec3 p, vec3 d) {
    vec2 ground = sphereHit(p, d, R_E);
    if (ground.y > 0.0 && ground.x > 0.0) return vec3(0.0);
    float len = sphereHit(p, d, R_A).y;
    float ds = len / 4.0;
    vec2 od = vec2(0.0);
    for (int j = 0; j < 4; ++j) {
        vec3 q = p + d * (ds * (float(j) + 0.5));
        od += exp(-(length(q) - R_E) / vec2(H_R, H_M)) * ds;
    }
    return vec3(od, 1.0);
}

/// The sky's radiance along dir, by single scattering; @p sunTrans is the sun's light by the time it reaches the viewer.
vec3 scatter(vec3 dir, vec3 sun, float alt, float haze, out vec3 sunTrans) {
    vec3 o = vec3(0.0, R_E + alt, 0.0);
    float len = sphereHit(o, dir, R_A).y;
    const int N = 16;
    float ds = len / float(N);
    float mu = dot(dir, sun);
    float g = 0.76;
    float phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    float phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec2 od = vec2(0.0);
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    for (int i = 0; i < N; ++i) {
        vec3 p = o + dir * (ds * (float(i) + 0.5));
        vec2 dens = exp(-(length(p) - R_E) / vec2(H_R, H_M)) * ds;
        od += dens;
        vec3 ol = lightDepth(p, sun);
        if (ol.z > 0.5) {
            vec3 attn = exp(-(BETA_R * (od.x + ol.x) + BETA_M * haze * 1.1 * (od.y + ol.y)));
            sumR += attn * dens.x;
            sumM += attn * dens.y;
        }
    }
    vec3 st = lightDepth(o, sun);
    sunTrans = st.z > 0.5 ? exp(-(BETA_R * st.x + BETA_M * haze * 1.1 * st.y)) : vec3(0.0);
    return (sumR * BETA_R * phaseR + sumM * BETA_M * haze * phaseM) * SUN_I;
}

/// Where a coverage texture is given, the shape of the clouds on the ground is its, and the noise erodes it. The layers are tiled in kilometres
/// of the cloud plane, the second a softer, higher one folded in.
float cloudField(vec2 xz, float noise, float h) {
    if (u_cloudMaskTile <= 0.0) return noise;
    float m = textureLod(u_cloudMask, xz / u_cloudMaskTile, 0.0).r;
    if (u_cloudMask2Tile > 0.0) m = mix(m, textureLod(u_cloudMask2, xz / u_cloudMask2Tile, 0.0).r, 0.3);
    // A mask knows nothing of height, and a column of it seen along the slab is a streak: the cloud's top stands only over the mask's core, a dome.
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

float cloudDensity(vec3 p, float coverage, float base, float thick, int octaves) {
    float h = clamp((p.y - base) / thick, 0.0, 1.0);
    float shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    vec3 q = vec3(p.x, p.y * 1.8, p.z) * 0.32;
    float n = vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28;
    if (octaves > 2) n += vnoise(q * 4.7) * 0.14;
    else n += 0.07;
    n = cloudField(p.xz, n, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}

/// How much of the sun reaches a surface at @p world through the cloud layer: 1 is all of it. The sun's ray is marched up through
/// the slab against the same density the sky draws, so a shadow falls where the cloud above it is. Ambient light is not shadowed.
float cloudShadowAt(vec3 world, vec3 cam, vec3 sun, float coverage, float overcast, vec3 drift) {
    float strength = u_cloudShadow * smoothstep(0.02, 0.14, sun.y);
    if (strength <= 0.001 || coverage <= 0.01) return 1.0;
    float k = 1.0 / max(u_unitsPerKm, 1e-3);
    float h = u_altitude + (world.y - cam.y) * k;
    float tt = (u_cloudBase + u_cloudThickness - h) / sun.y;
    if (tt <= 0.0) return 1.0;
    float tb = max(u_cloudBase - h, 0.0) / sun.y;
    const int N = 6;
    float ds = (tt - tb) / float(N);
    float sigma = 1.3 * (1.0 + overcast * 1.5);
    float tau = 0.0;
    float jitter = ign(gl_FragCoord.xy);
    for (int i = 0; i < N; ++i) {
        float t = tb + (float(i) + jitter) * ds;
        vec3 p = vec3(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau += cloudDensity(p, coverage, u_cloudBase, u_cloudThickness, 2) * sigma * ds;
    }
    return 1.0 - strength * 0.8 * (1.0 - exp(-tau));
}
/// The cloud slab along @p dir as a map of what is behind it, colour * T + L: how much of it the clouds let through, and the light they add.
/// A function of the direction alone, so it can be worked out small and read back big.
void cloudLayer(vec3 dir, vec3 sun, vec3 dome, vec3 sunTrans, float night, float overcast, vec3 windDrift, out vec3 L, out float T) {
    L = vec3(0.0);
    T = 1.0;
    float coverage = max(u_clouds, overcast * 0.95);
    if (coverage > 0.01 && dir.y > 0.01) {
        float base = u_cloudBase;
        float thick = u_cloudThickness;
        float tb = max(base - u_altitude, 0.0) / dir.y;
        float tt = (base + thick - u_altitude) / dir.y;
        const int STEPS = 16;
        float ds = (tt - tb) / float(STEPS);
        float jitter = ign(gl_FragCoord.xy);
        float sigma = 1.3 * (1.0 + overcast * 1.5);
        vec3 drift = windDrift;
        float cosS = dot(dir, sun);
        float phase = mix(0.35 + 0.65 * pow(max(cosS, 0.0), 6.0), 0.5, 0.4);
        vec3 ambient = dome * 0.7 + lin(vec3(0.55, 0.65, 0.9)) * 0.015 * night;
        vec3 sunLight = sunTrans * 1.2 * u_cloudBrightness;
        float trans = 1.0;
        vec3 lit = vec3(0.0);
        for (int i = 0; i < STEPS; ++i) {
            if (trans < 0.02) break;
            float t = tb + (float(i) + jitter) * ds;
            vec3 p = vec3(dir.x * t, u_altitude + dir.y * t, dir.z * t) + drift;
            float d = cloudDensity(p, coverage, base, thick, 3);
            if (d < 0.002) continue;
            float tau = 0.0;
            for (int k = 1; k <= 3; ++k) {
                vec3 q = p + sun * (0.35 * float(k));
                tau += cloudDensity(q, coverage, base, thick, 2) * 0.35 * sigma;
            }
            float energy = exp(-tau * 1.1) + 0.25 * exp(-tau * 0.25);
            vec3 S = sunLight * energy * phase * 2.0 + ambient;
            float ext = d * sigma * ds;
            float tr = exp(-ext);
            lit += trans * (1.0 - tr) * S;
            trans *= tr;
        }
        float fade = smoothstep(0.01, 0.14, dir.y);
        T = mix(1.0, trans, fade);
        L = lit * fade;
    }

}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1)), 0).r;
    // The scene was cleared to nothing when the background is not kept (the engine's rule, same threshold): what is left of a pixel's
    // alpha is how much the sky shows through it, and that includes a pixel whose depth says surface because one sample of it is.
    bool covered = u_panorama <= 0.001;
    bool geometry = covered ? (depth < 1.0 && src.a > 0.999) : depth < 1.0;
    // A texel stands for the pixels under it. A sky texel holds the cloud layer in front of it, colour * T + L, with T (never negative) in
    // the alpha; a surface texel holds the cloud shadow it lies in, its light in the red and minus that in the alpha.
    if (geometry && u_cloudShadow <= 0.001) { fragColor = vec4(1.0, 0.0, 0.0, -1.0); return; }

    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    vec3 dir = normalize(worldFromDepth(v_texCoord, 1.0) - entry);

    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (u_planetRadius > 0.0) {
        // Up is away from the planet's centre where the camera is: the direction and the sun are turned into the frame where that is +Y.
        mat3 frame = upFrame(normalize(entry + u_renderOrigin.xyz - vec3(u_planetX, u_planetY, u_planetZ)));
        dir = frame * dir;
        sun = frame * sun;
    }
    float se = sun.y;

    float overcast = clamp(u_overcast, 0.0, 1.0);
    float haze = u_haze * (1.0 + overcast * 2.0);

    // Clouds that cast shadows are in the world, not on the camera: the pattern is anchored to where the camera stands.
    bool shadowed = u_cloudShadow > 0.001;
    vec3 entryWorld = entry + u_renderOrigin.xyz;
    vec3 anchor = shadowed ? vec3(entryWorld.x, 0.0, entryWorld.z) / max(u_unitsPerKm, 1e-3) : vec3(0.0);
    float windAngle = radians(u_windDirection);
    vec3 windDrift = vec3(sin(windAngle), 0.0, cos(windAngle)) * (u_windSpeed * u_time.x) + anchor;
    if (geometry) {
        float lit = cloudShadowAt(worldFromDepth(v_texCoord, depth) + u_renderOrigin.xyz, entryWorld, sun, max(u_clouds, overcast * 0.95), overcast, windDrift - anchor);
        fragColor = vec4(lit, 0.0, 0.0, -lit);
        return;
    }

    // The dome. Below the horizon there is no sky: the ray is flattened onto it so a camera that looks down sees the haze there.
    vec3 sdir = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
    vec3 sunTrans;
    vec3 col = scatter(sdir, sun, u_altitude, haze, sunTrans) * 0.55 * u_intensity;
    // Below the horizon there is no sky, only the dimmer light the ground sends up.
    col *= 1.0 - 0.75 * smoothstep(0.0, -0.3, dir.y);
    // What the air keeps of the night: a faint glow so the dome is not black where there is no moon.
    float night = 1.0 - smoothstep(-0.10, 0.12, se);
    col += mix(lin(vec3(0.003, 0.006, 0.02)), lin(vec3(0.016, 0.024, 0.06)), pow(1.0 - max(dir.y, 0.0), 3.0)) * night;
    vec3 dome = col;
    vec3 L;
    float T;
    cloudLayer(dir, sun, dome, sunTrans, night, overcast, windDrift, L, T);
    fragColor = vec4(L, T);
}
#pragma end

#pragma fragment wgsl
const R_E : f32 = 6360.0;
const R_A : f32 = 6420.0;
const BETA_R : vec3f = vec3f(0.0058, 0.0135, 0.0331);
const BETA_M : f32 = 0.021;
const H_R : f32 = 8.0;
const H_M : f32 = 1.2;
const SUN_I : f32 = 22.0;

fn hash13(p0 : vec3f) -> f32 {
    var p = fract(p0 * 0.1031);
    p = p + dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn vnoise(p : vec3f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = mix(hash13(i), hash13(i + vec3f(1, 0, 0)), f.x);
    let b = mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), f.x);
    let c = mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), f.x);
    let d = mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

fn lin(c : vec3f) -> vec3f {
#ifdef ES_LINEAR
    return srgbToLinear(c);
#else
    return c;
#endif
}

fn sphereHit(o : vec3f, d : vec3f, r : f32) -> vec2f {
    let b = dot(o, d);
    let disc = b * b - (dot(o, o) - r * r);
    if (disc < 0.0) { return vec2f(-1.0); }
    let s = sqrt(disc);
    return vec2f(-b - s, -b + s);
}

fn lightDepth(p : vec3f, d : vec3f) -> vec3f {
    let ground = sphereHit(p, d, R_E);
    if (ground.y > 0.0 && ground.x > 0.0) { return vec3f(0.0); }
    let len = sphereHit(p, d, R_A).y;
    let ds = len / 4.0;
    var od = vec2f(0.0);
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let q = p + d * (ds * (f32(j) + 0.5));
        od = od + exp(-(length(q) - R_E) / vec2f(H_R, H_M)) * ds;
    }
    return vec3f(od, 1.0);
}

struct Scatter { radiance : vec3f, sunTrans : vec3f };

fn scatter(dir : vec3f, sun : vec3f, alt : f32, haze : f32) -> Scatter {
    let o = vec3f(0.0, R_E + alt, 0.0);
    let len = sphereHit(o, dir, R_A).y;
    let N = 16;
    let ds = len / f32(N);
    let mu = dot(dir, sun);
    let g = 0.76;
    let phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    let phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    var od = vec2f(0.0);
    var sumR = vec3f(0.0);
    var sumM = vec3f(0.0);
    for (var i : i32 = 0; i < N; i = i + 1) {
        let p = o + dir * (ds * (f32(i) + 0.5));
        let dens = exp(-(length(p) - R_E) / vec2f(H_R, H_M)) * ds;
        od = od + dens;
        let ol = lightDepth(p, sun);
        if (ol.z > 0.5) {
            let attn = exp(-(BETA_R * (od.x + ol.x) + BETA_M * haze * 1.1 * (od.y + ol.y)));
            sumR = sumR + attn * dens.x;
            sumM = sumM + attn * dens.y;
        }
    }
    let st = lightDepth(o, sun);
    var trans = vec3f(0.0);
    if (st.z > 0.5) { trans = exp(-(BETA_R * st.x + BETA_M * haze * 1.1 * st.y)); }
    var out : Scatter;
    out.radiance = (sumR * BETA_R * phaseR + sumM * BETA_M * haze * phaseM) * SUN_I;
    out.sunTrans = trans;
    return out;
}

fn cloudField(xz : vec2f, noise : f32, h : f32) -> f32 {
    if (mc.u_cloudMaskTile <= 0.0) { return noise; }
    var m = textureSampleLevel(u_cloudMask, u_cloudMask_s, xz / mc.u_cloudMaskTile, 0.0).r;
    if (mc.u_cloudMask2Tile > 0.0) { m = mix(m, textureSampleLevel(u_cloudMask2, u_cloudMask2_s, xz / mc.u_cloudMask2Tile, 0.0).r, 0.3); }
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

fn cloudDensity(p : vec3f, coverage : f32, base : f32, thick : f32, octaves : i32) -> f32 {
    let h = clamp((p.y - base) / thick, 0.0, 1.0);
    let shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    let q = vec3f(p.x, p.y * 1.8, p.z) * 0.32;
    var n = vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28;
    if (octaves > 2) { n = n + vnoise(q * 4.7) * 0.14; } else { n = n + 0.07; }
    n = cloudField(p.xz, n, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}

fn frame_origin() -> vec3f { return frame.renderOrigin.xyz; }

/// The turn that takes up to +Y by the shortest way: the sky is worked out where up is +Y, so on a round world in the frame of the ground the camera stands on.
fn upFrame(up : vec3f) -> mat3x3f {
    let v = vec3f(-up.z, 0.0, up.x);
    let k = 1.0 / max(1.0 + up.y, 1e-4);
    let cross = mat3x3f(vec3f(0.0, v.z, -v.y), vec3f(-v.z, 0.0, v.x), vec3f(v.y, -v.x, 0.0));
    return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0)) + cross + (cross * cross) * k;
}

fn cloudShadowAt(world : vec3f, cam : vec3f, sun : vec3f, coverage : f32, overcast : f32, drift : vec3f, px : vec2f) -> f32 {
    let strength = mc.u_cloudShadow * smoothstep(0.02, 0.14, sun.y);
    if (strength <= 0.001 || coverage <= 0.01) { return 1.0; }
    let k = 1.0 / max(mc.u_unitsPerKm, 1e-3);
    let h = mc.u_altitude + (world.y - cam.y) * k;
    let tt = (mc.u_cloudBase + mc.u_cloudThickness - h) / sun.y;
    if (tt <= 0.0) { return 1.0; }
    let tb = max(mc.u_cloudBase - h, 0.0) / sun.y;
    let N = 6;
    let ds = (tt - tb) / f32(N);
    let sigma = 1.3 * (1.0 + overcast * 1.5);
    var tau = 0.0;
    let jitter = ign(px);
    for (var i : i32 = 0; i < N; i = i + 1) {
        let t = tb + (f32(i) + jitter) * ds;
        let p = vec3f(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau = tau + cloudDensity(p, coverage, mc.u_cloudBase, mc.u_cloudThickness, 2) * sigma * ds;
    }
    return 1.0 - strength * 0.8 * (1.0 - exp(-tau));
}

struct CloudLayer { L : vec3f, T : f32 };

/// The cloud slab along dir as a map of what is behind it, colour * T + L. A function of the direction alone, so it can be worked out small and read back big.
fn cloudLayer(dir : vec3f, sun : vec3f, dome : vec3f, sunTrans : vec3f, night : f32, overcast : f32, windDrift : vec3f, px : vec2f) -> CloudLayer {
    var out : CloudLayer;
    out.L = vec3f(0.0);
    out.T = 1.0;
    let coverage = max(mc.u_clouds, overcast * 0.95);
    if (coverage > 0.01 && dir.y > 0.01) {
        let base = mc.u_cloudBase;
        let thick = mc.u_cloudThickness;
        let tb = max(base - mc.u_altitude, 0.0) / dir.y;
        let tt = (base + thick - mc.u_altitude) / dir.y;
        let STEPS = 16;
        let ds = (tt - tb) / f32(STEPS);
        let jitter = ign(px);
        let sigma = 1.3 * (1.0 + overcast * 1.5);
        let drift = windDrift;
        let cosS = dot(dir, sun);
        let phase = mix(0.35 + 0.65 * pow(max(cosS, 0.0), 6.0), 0.5, 0.4);
        let ambient = dome * 0.7 + lin(vec3f(0.55, 0.65, 0.9)) * 0.015 * night;
        let sunLight = sunTrans * 1.2 * mc.u_cloudBrightness;
        var trans = 1.0;
        var lit = vec3f(0.0);
        for (var i : i32 = 0; i < STEPS; i = i + 1) {
            if (trans < 0.02) { break; }
            let t = tb + (f32(i) + jitter) * ds;
            let p = vec3f(dir.x * t, mc.u_altitude + dir.y * t, dir.z * t) + drift;
            let d = cloudDensity(p, coverage, base, thick, 3);
            if (d < 0.002) { continue; }
            var tau = 0.0;
            for (var k : i32 = 1; k <= 3; k = k + 1) {
                let q = p + sun * (0.35 * f32(k));
                tau = tau + cloudDensity(q, coverage, base, thick, 2) * 0.35 * sigma;
            }
            let energy = exp(-tau * 1.1) + 0.25 * exp(-tau * 0.25);
            let S = sunLight * energy * phase * 2.0 + ambient;
            let ext = d * sigma * ds;
            let tr = exp(-ext);
            lit = lit + trans * (1.0 - tr) * S;
            trans = trans * tr;
        }
        let fade = smoothstep(0.01, 0.14, dir.y);
        out.T = mix(1.0, trans, fade);
        out.L = lit * fade;
    }

    return out;
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let depth = textureLoad(t7, clamp(vec2i(v.v_texCoord * vec2f(size)), vec2i(0), size - vec2i(1)), 0);
    let covered = mc.u_panorama <= 0.001;
    let geometry = (covered && depth < 1.0 && src.a > 0.999) || (!covered && depth < 1.0);
    if (geometry && mc.u_cloudShadow <= 0.001) { return vec4f(1.0, 0.0, 0.0, -1.0); }

    let entry = worldFromDepth(v.v_texCoord, 0.0);
    var dir = normalize(worldFromDepth(v.v_texCoord, 1.0) - entry);

    let found = findSun();
    let follow = mc.u_followSun > 0.5 && found.dir.w > 0.5;
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (follow) { sun = found.dir.xyz; }
    if (mc.u_planetRadius > 0.0) {
        let frame = upFrame(normalize(entry + frame_origin() - vec3f(mc.u_planetX, mc.u_planetY, mc.u_planetZ)));
        dir = frame * dir;
        sun = frame * sun;
    }
    let se = sun.y;

    let overcast = clamp(mc.u_overcast, 0.0, 1.0);
    let haze = mc.u_haze * (1.0 + overcast * 2.0);

    let entryWorld = entry + frame.renderOrigin.xyz;
    var anchor = vec3f(0.0);
    if (mc.u_cloudShadow > 0.001) { anchor = vec3f(entryWorld.x, 0.0, entryWorld.z) / max(mc.u_unitsPerKm, 1e-3); }
    let windAngle = radians(mc.u_windDirection);
    let windDrift = vec3f(sin(windAngle), 0.0, cos(windAngle)) * (mc.u_windSpeed * tc.u_time.x) + anchor;
    if (geometry) {
        let lit = cloudShadowAt(worldFromDepth(v.v_texCoord, depth) + frame.renderOrigin.xyz, entryWorld, sun, max(mc.u_clouds, overcast * 0.95), overcast, windDrift - anchor, v.pos.xy);
        return vec4f(lit, 0.0, 0.0, -lit);
    }

    let sdir = normalize(vec3f(dir.x, max(dir.y, 0.015), dir.z));
    let sc = scatter(sdir, sun, mc.u_altitude, haze);
    let sunTrans = sc.sunTrans;
    var col = sc.radiance * 0.55 * mc.u_intensity;
    col = col * (1.0 - 0.75 * smoothstep(0.0, -0.3, dir.y));
    let night = 1.0 - smoothstep(-0.10, 0.12, se);
    col = col + mix(lin(vec3f(0.003, 0.006, 0.02)), lin(vec3f(0.016, 0.024, 0.06)), pow(1.0 - max(dir.y, 0.0), 3.0)) * night;
    let dome = col;
    let cl = cloudLayer(dir, sun, dome, sunTrans, night, overcast, windDrift, v.pos.xy);
    return vec4f(cl.L, cl.T);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Exponential height fog with the atmosphere's two tells: the sun's glow in the haze and a
     * sky that thickens toward the horizon.
     *
     * Pass 2 of 2, the composite. The light the sun sends through the haze (through the shadow map, and the clouds' shafts) is the dear part
     * and smooth, so the first pass walks it at half size and this one reads it back by how near each texel's ray is to the pixel's (see
     * createHeightFogVolume); the haze itself, which is analytic, is drawn here at full size.
     */
    createHeightFog(): ShaderHandle {
        const source = `#pragma shader "PP Height Fog"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_fogColor color default(0.62,0.7,0.8,1)
#pragma param u_sunColor color default(1,0.82,0.55,1)
#pragma param u_density float default(0.0015) range(0,0.05)
#pragma param u_heightFalloff float default(0.003) range(0,0.1)
#pragma param u_baseHeight float default(0) range(-1000,5000)
#pragma param u_planetRadius float default(0) range(0,100000000)
#pragma param u_planetX float default(0) range(-100000000,100000000)
#pragma param u_planetY float default(0) range(-100000000,100000000)
#pragma param u_planetZ float default(0) range(-100000000,100000000)
#pragma param u_startDistance float default(0) range(0,3000)
#pragma param u_maxOpacity float default(1) range(0,1)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(25) range(-90,90)
#pragma param u_inscatter float default(0.6) range(0,2)
#pragma param u_sunExponent float default(8) range(1,64)
#pragma param u_skyFog float default(0.8) range(0,1)
#pragma param u_followSun float default(1) range(0,1)
#pragma param u_volumetric float default(0) range(0,1)
#pragma param u_volumeRange float default(3000) range(100,1000000)
#pragma param u_cloudShade float default(0) range(0,1)
#pragma param u_skyCover float default(0) range(0,1)
#pragma param u_skyBase float default(1.5) range(0.2,10)
#pragma param u_skyThickness float default(2.5) range(0.2,8)
#pragma param u_skyAltitude float default(0.1) range(0,20)
#pragma param u_skyUnits float default(1000) range(1,100000)
#pragma param u_skySigma float default(1.3) range(0,10)
#pragma param u_skyWindX float default(0) range(-2,2)
#pragma param u_skyWindZ float default(0) range(-2,2)
#pragma param u_cloudMask texture default(black)
#pragma param u_cloudMaskTile float default(0) range(0,100)
#pragma param u_cloudMask2 texture default(black)
#pragma param u_cloudMask2Tile float default(0) range(0,100)
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const float FAR_RAY = 100000.0;
const int VOLUME_STEPS = 24;

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// How much of a ray's light a particle scatters toward the viewer: forward, the way fog glows around the sun.
float phaseHG(float cosine) {
    const float g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}


float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x);
    float b = mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x);
    float c = mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x);
    float d = mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
/// Where a coverage texture is given, the shape of the clouds on the ground is its, and the noise erodes it. The layers are tiled in kilometres
/// of the cloud plane, the second a softer, higher one folded in.
float cloudField(vec2 xz, float noise, float h) {
    if (u_cloudMaskTile <= 0.0) return noise;
    float m = textureLod(u_cloudMask, xz / u_cloudMaskTile, 0.0).r;
    if (u_cloudMask2Tile > 0.0) m = mix(m, textureLod(u_cloudMask2, xz / u_cloudMask2Tile, 0.0).r, 0.3);
    // A mask knows nothing of height, and a column of it seen along the slab is a streak: the cloud's top stands only over the mask's core, a dome.
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

/// The sky's cloud density, the same one the dome draws (see skyAtmosphere), at a point in kilometres.
float cloudDensity(vec3 p, float coverage, float base, float thick) {
    float h = clamp((p.y - base) / thick, 0.0, 1.0);
    float shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    vec3 q = vec3(p.x, p.y * 1.8, p.z) * 0.32;
    float n = cloudField(p.xz, vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28 + 0.07, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}
/// How much of the sun reaches the air at @p world through the cloud layer, 1 being all of it: the sun's ray marched up through the slab.
float cloudLight(vec3 world, float camY, vec3 sun, vec3 drift) {
    if (u_cloudShade <= 0.001 || u_skyCover <= 0.01 || sun.y <= 0.02) return 1.0;
    float k = 1.0 / max(u_skyUnits, 1e-3);
    float h = u_skyAltitude + (world.y - camY) * k;
    float tt = (u_skyBase + u_skyThickness - h) / sun.y;
    if (tt <= 0.0) return 1.0;
    float tb = max(u_skyBase - h, 0.0) / sun.y;
    const int N = 4;
    float ds = (tt - tb) / float(N);
    float tau = 0.0;
    for (int i = 0; i < N; ++i) {
        float t = tb + (float(i) + 0.5) * ds;
        vec3 q = vec3(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau += cloudDensity(q, u_skyCover, u_skyBase, u_skyThickness) * u_skySigma * ds;
    }
    return 1.0 - u_cloudShade * (1.0 - exp(-tau));
}

/// The height of a point above the ground the fog lies on: world Y on a flat world, the distance above the sphere's surface on a planet (never below it: inside the planet the fog is the ground's, not an exponential of a depth).
float fogAltitude(vec3 p) {
    vec3 a = p + u_renderOrigin.xyz;
    return u_planetRadius > 0.0 ? max(length(a - vec3(u_planetX, u_planetY, u_planetZ)) - u_planetRadius, 0.0) : a.y;
}
/// What the exponential density integrates to along a ray: the eye's density, the length,
/// and the term for how fast the ray leaves the fog. Written so a level ray (no climb)
/// needs no division, and so a long ray downward cannot overflow.
float opticalDepth(float eyeY, float dirY, float len) {
    float k = u_heightFalloff;
    float dens = u_density * exp(clamp(-k * (eyeY - u_baseHeight), -60.0, 60.0));
    float kd = k * dirY * len;
    float span = abs(kd) < 1e-4 ? 1.0 : (1.0 - exp(clamp(-kd, -60.0, 60.0))) / kd;
    return dens * len * span;
}

/// The sun's light through the haze, where the shadow map says it gets through: the air between the camera and the surface is walked in steps,
/// and each one that stands in light adds what it scatters toward the eye. What the sky's clouds let through of the sun is in it too.
vec3 volumeLight(vec3 entry, vec3 dir, float len, bool sky, vec3 sun, vec4 lightColor, ivec2 tiles, vec3 sunTint) {
    float range = min(len, u_volumeRange);
    float span = max(range - u_startDistance, 0.0);
    float ds = span / float(VOLUME_STEPS);
    float jitter = ign(gl_FragCoord.xy);
    float transmit = 1.0;
    float lit = 0.0;
    // The clouds are as the sky draws them, fixed in the world and drifting; their light changes slowly along the ray, so every third step asks.
    vec3 drift = vec3(u_skyWindX, 0.0, u_skyWindZ) * u_time.x;
    float shade = 1.0;
    for (int i = 0; i < VOLUME_STEPS; ++i) {
        float t = u_startDistance + (float(i) + jitter) * ds;
        vec3 p = entry + dir * t;
        if (i % 3 == 0) shade = cloudLight(p + u_renderOrigin.xyz, entry.y + u_renderOrigin.y, sun, drift);
        float dens = u_density * exp(clamp(-u_heightFalloff * (fogAltitude(p) - u_baseHeight), -60.0, 60.0));
        lit += transmit * dens * ds * sunVisibility(p, tiles.x, tiles.y) * shade;
        transmit *= exp(-dens * ds);
    }
    float strength = clamp(lightColor.a, 0.0, 8.0) * 0.5;
    return sunTint * lit * phaseHG(dot(dir, sun)) * u_inscatter * u_volumetric * strength * (sky ? u_skyFog : 1.0);
}

/// The volumetric light for a pixel, read from the half-size pass: the four texels it falls between, each weighted by how near its ray's length
/// is to this pixel's, so a texel across a silhouette lends little of its light. Always an answer: a pixel that walked the air itself would
/// hold up every pixel beside it in its warp, and a leaf's edge is such a pixel.
bool upsampledVolume(float len, out vec3 add) {
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 hsize = textureSize(u_texture, 0);
    vec2 hf = v_texCoord * vec2(hsize) - 0.5;
    ivec2 base = ivec2(floor(hf));
    vec2 fr = hf - vec2(base);
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int j = 0; j < 4; ++j) {
        ivec2 o = ivec2(j & 1, j >> 1);
        ivec2 t = clamp(base + o, ivec2(0), hsize - ivec2(1));
        vec2 uv = uvOfTexel(t, hsize);
        float dj = depthAt(screenTexel(uv, dsize), dsize);
        float lj = dj >= 1.0 ? FAR_RAY : length(worldFromDepth(uv, dj) - worldFromDepth(uv, 0.0));
        float bw = (o.x == 1 ? fr.x : 1.0 - fr.x) * (o.y == 1 ? fr.y : 1.0 - fr.y);
        float rel = abs(lj - len) / max(len, 1.0);
        float w = bw / (1.0 + 400.0 * rel * rel);
        sum += texelFetch(u_texture, t, 0).rgb * w;
        wsum += w;
    }
    add = sum / wsum;
    return true;
}

void main() {
    vec4 src = texture(u_sceneTexture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1)), 0).r;
    bool sky = depth >= 1.0;

    // The ray starts on the near plane, which is the one place that is a point under a
    // perspective camera and under an orthographic one alike.
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    vec3 target = worldFromDepth(v_texCoord, sky ? 1.0 : depth);
    vec3 dir = normalize(target - entry);
    float len = sky ? FAR_RAY : length(target - entry);
    float effective = max(len - u_startDistance, 0.0);
    if (effective <= 0.0) { fragColor = src; return; }

    float eyeAlt = fogAltitude(entry + dir * u_startDistance);
    float climb = dir.y;
    if (u_planetRadius > 0.0) {
        // The ground curves away: the climb is the rise between the ray's ends, and a sky ray climbs as it points.
        vec3 up = normalize(entry + dir * u_startDistance + u_renderOrigin.xyz - vec3(u_planetX, u_planetY, u_planetZ));
        climb = sky ? dot(dir, up) : (fogAltitude(target) - eyeAlt) / effective;
    }
    float tau = opticalDepth(eyeAlt, climb, effective);
    float amount = (1.0 - exp(-tau)) * u_maxOpacity * (sky ? u_skyFog : 1.0);

    // The sun is the scene's own directional light unless the effect is told to ignore it: where it stands and
    // what colour it is come from the light block, so a sun that moves takes its haze with it.
    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    float glow = pow(max(dot(dir, sun), 0.0), u_sunExponent);
    vec3 fog = u_fogColor.rgb;
    vec3 sunTint = u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    // The light's own colour is already in the pipeline's space; only its hue is wanted, not its strength.
    if (follow) sunTint = lightColor.rgb / max(max(lightColor.r, lightColor.g), max(lightColor.b, 1e-3));
    float shaped = u_volumetric > 0.0 ? glow * (1.0 - u_volumetric) : glow;
    vec3 colour = mix(fog, sunTint, clamp(shaped * u_inscatter, 0.0, 1.0));
    vec3 result = mix(src.rgb, colour, clamp(amount, 0.0, 1.0));

    // The sun's light through the haze: read from the half-size pass, walked here only where it has nothing for this pixel.
    if (u_volumetric > 0.0 && follow) {
        vec3 add;
        if (!upsampledVolume(len, add)) add = volumeLight(entry, dir, len, sky, sun, lightColor, tiles, sunTint);
        result += add;
    }
    fragColor = vec4(result, src.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
const FAR_RAY : f32 = 100000.0;
const VOLUME_STEPS : i32 = 24;

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn phaseHG(cosine : f32) -> f32 {
    let g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}

fn hash13(p0 : vec3f) -> f32 {
    var p = fract(p0 * 0.1031);
    p = p + dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
fn vnoise(p : vec3f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = mix(hash13(i), hash13(i + vec3f(1, 0, 0)), f.x);
    let b = mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), f.x);
    let c = mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), f.x);
    let d = mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
fn cloudField(xz : vec2f, noise : f32, h : f32) -> f32 {
    if (mc.u_cloudMaskTile <= 0.0) { return noise; }
    var m = textureSampleLevel(u_cloudMask, u_cloudMask_s, xz / mc.u_cloudMaskTile, 0.0).r;
    if (mc.u_cloudMask2Tile > 0.0) { m = mix(m, textureSampleLevel(u_cloudMask2, u_cloudMask2_s, xz / mc.u_cloudMask2Tile, 0.0).r, 0.3); }
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

fn cloudDensity(p : vec3f, coverage : f32, base : f32, thick : f32) -> f32 {
    let h = clamp((p.y - base) / thick, 0.0, 1.0);
    let shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    let q = vec3f(p.x, p.y * 1.8, p.z) * 0.32;
    let n = cloudField(p.xz, vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28 + 0.07, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}
fn cloudLight(world : vec3f, camY : f32, sun : vec3f, drift : vec3f) -> f32 {
    if (mc.u_cloudShade <= 0.001 || mc.u_skyCover <= 0.01 || sun.y <= 0.02) { return 1.0; }
    let k = 1.0 / max(mc.u_skyUnits, 1e-3);
    let h = mc.u_skyAltitude + (world.y - camY) * k;
    let tt = (mc.u_skyBase + mc.u_skyThickness - h) / sun.y;
    if (tt <= 0.0) { return 1.0; }
    let tb = max(mc.u_skyBase - h, 0.0) / sun.y;
    let N = 4;
    let ds = (tt - tb) / f32(N);
    var tau = 0.0;
    for (var i : i32 = 0; i < N; i = i + 1) {
        let t = tb + (f32(i) + 0.5) * ds;
        let q = vec3f(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau = tau + cloudDensity(q, mc.u_skyCover, mc.u_skyBase, mc.u_skyThickness) * mc.u_skySigma * ds;
    }
    return 1.0 - mc.u_cloudShade * (1.0 - exp(-tau));
}

fn fogAltitude(p : vec3f) -> f32 {
    let a = p + frame.renderOrigin.xyz;
    if (mc.u_planetRadius > 0.0) { return max(length(a - vec3f(mc.u_planetX, mc.u_planetY, mc.u_planetZ)) - mc.u_planetRadius, 0.0); }
    return a.y;
}
fn opticalDepth(eyeY : f32, dirY : f32, len : f32) -> f32 {
    let k = mc.u_heightFalloff;
    let dens = mc.u_density * exp(clamp(-k * (eyeY - mc.u_baseHeight), -60.0, 60.0));
    let kd = k * dirY * len;
    var span = 1.0;
    if (abs(kd) >= 1e-4) { span = (1.0 - exp(clamp(-kd, -60.0, 60.0))) / kd; }
    return dens * len * span;
}

/// The sun's light through the haze, where the shadow map says it gets through. See the GLSL twin.
fn volumeLight(entry : vec3f, dir : vec3f, len : f32, sky : bool, sun : vec3f, found : Sun, sunTint : vec3f, px : vec2f) -> vec3f {
    let range = min(len, mc.u_volumeRange);
    let span = max(range - mc.u_startDistance, 0.0);
    let ds = span / f32(VOLUME_STEPS);
    let jitter = ign(px);
    var transmit = 1.0;
    var lit = 0.0;
    let drift = vec3f(mc.u_skyWindX, 0.0, mc.u_skyWindZ) * tc.u_time.x;
    var shade = 1.0;
    for (var i : i32 = 0; i < VOLUME_STEPS; i = i + 1) {
        let t = mc.u_startDistance + (f32(i) + jitter) * ds;
        let p = entry + dir * t;
        if (i % 3 == 0) { shade = cloudLight(p + frame.renderOrigin.xyz, entry.y + frame.renderOrigin.y, sun, drift); }
        let dens = mc.u_density * exp(clamp(-mc.u_heightFalloff * (fogAltitude(p) - mc.u_baseHeight), -60.0, 60.0));
        lit = lit + transmit * dens * ds * sunVisibility(p, found.tiles.x, found.tiles.y) * shade;
        transmit = transmit * exp(-dens * ds);
    }
    let strength = clamp(found.color.a, 0.0, 8.0) * 0.5;
    var skyShare = 1.0;
    if (sky) { skyShare = mc.u_skyFog; }
    return sunTint * lit * phaseHG(dot(dir, sun)) * mc.u_inscatter * mc.u_volumetric * strength * skyShare;
}

struct VolumeRead { ok : bool, add : vec3f };

/// The volumetric light for a pixel, read from the half-size pass. See the GLSL twin.
fn upsampledVolume(uv : vec2f, len : f32) -> VolumeRead {
    var out : VolumeRead;
    out.ok = false;
    let dsize = vec2i(textureDimensions(t7, 0));
    let hsize = vec2i(textureDimensions(t0, 0));
    let hf = uv * vec2f(hsize) - 0.5;
    let base = vec2i(floor(hf));
    let fr = hf - vec2f(base);
    var sum = vec3f(0.0);
    var wsum = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let o = vec2i(j & 1, j >> 1);
        let t = clamp(base + o, vec2i(0), hsize - vec2i(1));
        let tuv = uvOfTexel(t, hsize);
        let dj = depthAt(screenTexel(tuv, dsize), dsize);
        var lj = FAR_RAY;
        if (dj < 1.0) { lj = length(worldFromDepth(tuv, dj) - worldFromDepth(tuv, 0.0)); }
        var bx = 1.0 - fr.x;
        if (o.x == 1) { bx = fr.x; }
        var by = 1.0 - fr.y;
        if (o.y == 1) { by = fr.y; }
        let rel = abs(lj - len) / max(len, 1.0);
        let w = bx * by / (1.0 + 400.0 * rel * rel);
        sum = sum + textureLoad(t0, t, 0).rgb * w;
        wsum = wsum + w;
    }
    out.ok = true;
    out.add = sum / wsum;
    return out;
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let depth = textureLoad(t7, clamp(vec2i(v.v_texCoord * vec2f(size)), vec2i(0), size - vec2i(1)), 0);
    let sky = depth >= 1.0;

    let entry = worldFromDepth(v.v_texCoord, 0.0);
    var d = depth;
    if (sky) { d = 1.0; }
    let tgt = worldFromDepth(v.v_texCoord, d);
    let dir = normalize(tgt - entry);
    var len = length(tgt - entry);
    if (sky) { len = FAR_RAY; }
    let effective = max(len - mc.u_startDistance, 0.0);
    if (effective <= 0.0) { return src; }

    let eyeAlt = fogAltitude(entry + dir * mc.u_startDistance);
    var climb = dir.y;
    if (mc.u_planetRadius > 0.0) {
        let up = normalize(entry + dir * mc.u_startDistance + frame.renderOrigin.xyz - vec3f(mc.u_planetX, mc.u_planetY, mc.u_planetZ));
        if (sky) { climb = dot(dir, up); } else { climb = (fogAltitude(tgt) - eyeAlt) / effective; }
    }
    let tau = opticalDepth(eyeAlt, climb, effective);
    var amount = (1.0 - exp(-tau)) * mc.u_maxOpacity;
    if (sky) { amount = amount * mc.u_skyFog; }

    // See the GLSL twin: the scene's own sun unless told not to follow it.
    let found = findSun();
    let follow = mc.u_followSun > 0.5 && found.dir.w > 0.5;
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (follow) { sun = found.dir.xyz; }
    var shaped = dot(dir, sun);
    let glow = pow(max(shaped, 0.0), mc.u_sunExponent);
    var fog = mc.u_fogColor.rgb;
    var sunTint = mc.u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    if (follow) { sunTint = found.color.rgb / max(max(found.color.r, found.color.g), max(found.color.b, 1e-3)); }
    var glowShare = glow;
    if (mc.u_volumetric > 0.0) { glowShare = glow * (1.0 - mc.u_volumetric); }
    let colour = mix(fog, sunTint, clamp(glowShare * mc.u_inscatter, 0.0, 1.0));
    var result = mix(src.rgb, colour, clamp(amount, 0.0, 1.0));

    if (mc.u_volumetric > 0.0 && follow) {
        let up = upsampledVolume(v.v_texCoord, len);
        if (up.ok) {
            result = result + up.add;
        } else {
            result = result + volumeLight(entry, dir, len, sky, sun, found, sunTint, v.pos.xy);
        }
    }
    return vec4f(result, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /** The volumetric light of the height fog at half size: pass 1 of 2. A texel holds the light the sun sends toward the eye along its ray. */
    createHeightFogVolume(): ShaderHandle {
        const source = `#pragma shader "PP Height Fog Volume"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_fogColor color default(0.62,0.7,0.8,1)
#pragma param u_sunColor color default(1,0.82,0.55,1)
#pragma param u_density float default(0.0015) range(0,0.05)
#pragma param u_heightFalloff float default(0.003) range(0,0.1)
#pragma param u_baseHeight float default(0) range(-1000,5000)
#pragma param u_planetRadius float default(0) range(0,100000000)
#pragma param u_planetX float default(0) range(-100000000,100000000)
#pragma param u_planetY float default(0) range(-100000000,100000000)
#pragma param u_planetZ float default(0) range(-100000000,100000000)
#pragma param u_startDistance float default(0) range(0,3000)
#pragma param u_maxOpacity float default(1) range(0,1)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(25) range(-90,90)
#pragma param u_inscatter float default(0.6) range(0,2)
#pragma param u_sunExponent float default(8) range(1,64)
#pragma param u_skyFog float default(0.8) range(0,1)
#pragma param u_followSun float default(1) range(0,1)
#pragma param u_volumetric float default(0) range(0,1)
#pragma param u_volumeRange float default(3000) range(100,1000000)
#pragma param u_cloudShade float default(0) range(0,1)
#pragma param u_skyCover float default(0) range(0,1)
#pragma param u_skyBase float default(1.5) range(0.2,10)
#pragma param u_skyThickness float default(2.5) range(0.2,8)
#pragma param u_skyAltitude float default(0.1) range(0,20)
#pragma param u_skyUnits float default(1000) range(1,100000)
#pragma param u_skySigma float default(1.3) range(0,10)
#pragma param u_skyWindX float default(0) range(-2,2)
#pragma param u_skyWindZ float default(0) range(-2,2)
#pragma param u_cloudMask texture default(black)
#pragma param u_cloudMaskTile float default(0) range(0,100)
#pragma param u_cloudMask2 texture default(black)
#pragma param u_cloudMask2Tile float default(0) range(0,100)
#pragma lights
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const float FAR_RAY = 100000.0;
const int VOLUME_STEPS = 24;

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// How much of a ray's light a particle scatters toward the viewer: forward, the way fog glows around the sun.
float phaseHG(float cosine) {
    const float g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}


float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x);
    float b = mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x);
    float c = mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x);
    float d = mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
/// Where a coverage texture is given, the shape of the clouds on the ground is its, and the noise erodes it. The layers are tiled in kilometres
/// of the cloud plane, the second a softer, higher one folded in.
float cloudField(vec2 xz, float noise, float h) {
    if (u_cloudMaskTile <= 0.0) return noise;
    float m = textureLod(u_cloudMask, xz / u_cloudMaskTile, 0.0).r;
    if (u_cloudMask2Tile > 0.0) m = mix(m, textureLod(u_cloudMask2, xz / u_cloudMask2Tile, 0.0).r, 0.3);
    // A mask knows nothing of height, and a column of it seen along the slab is a streak: the cloud's top stands only over the mask's core, a dome.
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

/// The sky's cloud density, the same one the dome draws (see skyAtmosphere), at a point in kilometres.
float cloudDensity(vec3 p, float coverage, float base, float thick) {
    float h = clamp((p.y - base) / thick, 0.0, 1.0);
    float shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    vec3 q = vec3(p.x, p.y * 1.8, p.z) * 0.32;
    float n = cloudField(p.xz, vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28 + 0.07, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}
/// How much of the sun reaches the air at @p world through the cloud layer, 1 being all of it: the sun's ray marched up through the slab.
float cloudLight(vec3 world, float camY, vec3 sun, vec3 drift) {
    if (u_cloudShade <= 0.001 || u_skyCover <= 0.01 || sun.y <= 0.02) return 1.0;
    float k = 1.0 / max(u_skyUnits, 1e-3);
    float h = u_skyAltitude + (world.y - camY) * k;
    float tt = (u_skyBase + u_skyThickness - h) / sun.y;
    if (tt <= 0.0) return 1.0;
    float tb = max(u_skyBase - h, 0.0) / sun.y;
    const int N = 4;
    float ds = (tt - tb) / float(N);
    float tau = 0.0;
    for (int i = 0; i < N; ++i) {
        float t = tb + (float(i) + 0.5) * ds;
        vec3 q = vec3(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau += cloudDensity(q, u_skyCover, u_skyBase, u_skyThickness) * u_skySigma * ds;
    }
    return 1.0 - u_cloudShade * (1.0 - exp(-tau));
}

/// The height of a point above the ground the fog lies on: world Y on a flat world, the distance above the sphere's surface on a planet (never below it: inside the planet the fog is the ground's, not an exponential of a depth).
float fogAltitude(vec3 p) {
    vec3 a = p + u_renderOrigin.xyz;
    return u_planetRadius > 0.0 ? max(length(a - vec3(u_planetX, u_planetY, u_planetZ)) - u_planetRadius, 0.0) : a.y;
}
/// What the exponential density integrates to along a ray: the eye's density, the length,
/// and the term for how fast the ray leaves the fog. Written so a level ray (no climb)
/// needs no division, and so a long ray downward cannot overflow.
float opticalDepth(float eyeY, float dirY, float len) {
    float k = u_heightFalloff;
    float dens = u_density * exp(clamp(-k * (eyeY - u_baseHeight), -60.0, 60.0));
    float kd = k * dirY * len;
    float span = abs(kd) < 1e-4 ? 1.0 : (1.0 - exp(clamp(-kd, -60.0, 60.0))) / kd;
    return dens * len * span;
}

/// The sun's light through the haze, where the shadow map says it gets through: the air between the camera and the surface is walked in steps,
/// and each one that stands in light adds what it scatters toward the eye. What the sky's clouds let through of the sun is in it too.
vec3 volumeLight(vec3 entry, vec3 dir, float len, bool sky, vec3 sun, vec4 lightColor, ivec2 tiles, vec3 sunTint) {
    float range = min(len, u_volumeRange);
    float span = max(range - u_startDistance, 0.0);
    float ds = span / float(VOLUME_STEPS);
    float jitter = ign(gl_FragCoord.xy);
    float transmit = 1.0;
    float lit = 0.0;
    // The clouds are as the sky draws them, fixed in the world and drifting; their light changes slowly along the ray, so every third step asks.
    vec3 drift = vec3(u_skyWindX, 0.0, u_skyWindZ) * u_time.x;
    float shade = 1.0;
    for (int i = 0; i < VOLUME_STEPS; ++i) {
        float t = u_startDistance + (float(i) + jitter) * ds;
        vec3 p = entry + dir * t;
        if (i % 3 == 0) shade = cloudLight(p + u_renderOrigin.xyz, entry.y + u_renderOrigin.y, sun, drift);
        float dens = u_density * exp(clamp(-u_heightFalloff * (fogAltitude(p) - u_baseHeight), -60.0, 60.0));
        lit += transmit * dens * ds * sunVisibility(p, tiles.x, tiles.y) * shade;
        transmit *= exp(-dens * ds);
    }
    float strength = clamp(lightColor.a, 0.0, 8.0) * 0.5;
    return sunTint * lit * phaseHG(dot(dir, sun)) * u_inscatter * u_volumetric * strength * (sky ? u_skyFog : 1.0);
}

void main() {
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1)), 0).r;
    bool sky = depth >= 1.0;

    // The ray starts on the near plane, which is the one place that is a point under a
    // perspective camera and under an orthographic one alike.
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    vec3 target = worldFromDepth(v_texCoord, sky ? 1.0 : depth);
    vec3 dir = normalize(target - entry);
    float len = sky ? FAR_RAY : length(target - entry);
    float effective = max(len - u_startDistance, 0.0);
    


    if (u_volumetric <= 0.0 || effective <= 0.0) { fragColor = vec4(0.0); return; }

    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (!follow) { fragColor = vec4(0.0); return; }
    vec3 fog = u_fogColor.rgb;
    vec3 sunTint = u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    // The light's own colour is already in the pipeline's space; only its hue is wanted, not its strength.
    if (follow) sunTint = lightColor.rgb / max(max(lightColor.r, lightColor.g), max(lightColor.b, 1e-3));
    fragColor = vec4(volumeLight(entry, dir, len, sky, sun, lightColor, tiles, sunTint), 1.0);
}
#pragma end

#pragma fragment wgsl
const FAR_RAY : f32 = 100000.0;
const VOLUME_STEPS : i32 = 24;

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn phaseHG(cosine : f32) -> f32 {
    let g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}

fn hash13(p0 : vec3f) -> f32 {
    var p = fract(p0 * 0.1031);
    p = p + dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
fn vnoise(p : vec3f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = mix(hash13(i), hash13(i + vec3f(1, 0, 0)), f.x);
    let b = mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), f.x);
    let c = mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), f.x);
    let d = mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
fn cloudField(xz : vec2f, noise : f32, h : f32) -> f32 {
    if (mc.u_cloudMaskTile <= 0.0) { return noise; }
    var m = textureSampleLevel(u_cloudMask, u_cloudMask_s, xz / mc.u_cloudMaskTile, 0.0).r;
    if (mc.u_cloudMask2Tile > 0.0) { m = mix(m, textureSampleLevel(u_cloudMask2, u_cloudMask2_s, xz / mc.u_cloudMask2Tile, 0.0).r, 0.3); }
    return mix(m, noise, 0.5) - 0.35 * (h - 0.35);
}

fn cloudDensity(p : vec3f, coverage : f32, base : f32, thick : f32) -> f32 {
    let h = clamp((p.y - base) / thick, 0.0, 1.0);
    let shape = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
    let q = vec3f(p.x, p.y * 1.8, p.z) * 0.32;
    let n = cloudField(p.xz, vnoise(q) * 0.58 + vnoise(q * 2.13) * 0.28 + 0.07, h);
    return smoothstep(1.0 - coverage, 1.0 - coverage + 0.22, n) * shape;
}
fn cloudLight(world : vec3f, camY : f32, sun : vec3f, drift : vec3f) -> f32 {
    if (mc.u_cloudShade <= 0.001 || mc.u_skyCover <= 0.01 || sun.y <= 0.02) { return 1.0; }
    let k = 1.0 / max(mc.u_skyUnits, 1e-3);
    let h = mc.u_skyAltitude + (world.y - camY) * k;
    let tt = (mc.u_skyBase + mc.u_skyThickness - h) / sun.y;
    if (tt <= 0.0) { return 1.0; }
    let tb = max(mc.u_skyBase - h, 0.0) / sun.y;
    let N = 4;
    let ds = (tt - tb) / f32(N);
    var tau = 0.0;
    for (var i : i32 = 0; i < N; i = i + 1) {
        let t = tb + (f32(i) + 0.5) * ds;
        let q = vec3f(world.x * k + sun.x * t, h + sun.y * t, world.z * k + sun.z * t) + drift;
        tau = tau + cloudDensity(q, mc.u_skyCover, mc.u_skyBase, mc.u_skyThickness) * mc.u_skySigma * ds;
    }
    return 1.0 - mc.u_cloudShade * (1.0 - exp(-tau));
}

fn fogAltitude(p : vec3f) -> f32 {
    let a = p + frame.renderOrigin.xyz;
    if (mc.u_planetRadius > 0.0) { return max(length(a - vec3f(mc.u_planetX, mc.u_planetY, mc.u_planetZ)) - mc.u_planetRadius, 0.0); }
    return a.y;
}
fn opticalDepth(eyeY : f32, dirY : f32, len : f32) -> f32 {
    let k = mc.u_heightFalloff;
    let dens = mc.u_density * exp(clamp(-k * (eyeY - mc.u_baseHeight), -60.0, 60.0));
    let kd = k * dirY * len;
    var span = 1.0;
    if (abs(kd) >= 1e-4) { span = (1.0 - exp(clamp(-kd, -60.0, 60.0))) / kd; }
    return dens * len * span;
}

/// The sun's light through the haze, where the shadow map says it gets through. See the GLSL twin.
fn volumeLight(entry : vec3f, dir : vec3f, len : f32, sky : bool, sun : vec3f, found : Sun, sunTint : vec3f, px : vec2f) -> vec3f {
    let range = min(len, mc.u_volumeRange);
    let span = max(range - mc.u_startDistance, 0.0);
    let ds = span / f32(VOLUME_STEPS);
    let jitter = ign(px);
    var transmit = 1.0;
    var lit = 0.0;
    let drift = vec3f(mc.u_skyWindX, 0.0, mc.u_skyWindZ) * tc.u_time.x;
    var shade = 1.0;
    for (var i : i32 = 0; i < VOLUME_STEPS; i = i + 1) {
        let t = mc.u_startDistance + (f32(i) + jitter) * ds;
        let p = entry + dir * t;
        if (i % 3 == 0) { shade = cloudLight(p + frame.renderOrigin.xyz, entry.y + frame.renderOrigin.y, sun, drift); }
        let dens = mc.u_density * exp(clamp(-mc.u_heightFalloff * (fogAltitude(p) - mc.u_baseHeight), -60.0, 60.0));
        lit = lit + transmit * dens * ds * sunVisibility(p, found.tiles.x, found.tiles.y) * shade;
        transmit = transmit * exp(-dens * ds);
    }
    let strength = clamp(found.color.a, 0.0, 8.0) * 0.5;
    var skyShare = 1.0;
    if (sky) { skyShare = mc.u_skyFog; }
    return sunTint * lit * phaseHG(dot(dir, sun)) * mc.u_inscatter * mc.u_volumetric * strength * skyShare;
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t7, 0));
    let depth = textureLoad(t7, clamp(vec2i(v.v_texCoord * vec2f(size)), vec2i(0), size - vec2i(1)), 0);
    let sky = depth >= 1.0;

    let entry = worldFromDepth(v.v_texCoord, 0.0);
    var d = depth;
    if (sky) { d = 1.0; }
    let tgt = worldFromDepth(v.v_texCoord, d);
    let dir = normalize(tgt - entry);
    var len = length(tgt - entry);
    if (sky) { len = FAR_RAY; }
    let effective = max(len - mc.u_startDistance, 0.0);
    


    if (mc.u_volumetric <= 0.0 || effective <= 0.0) { return vec4f(0.0); }

    let found = findSun();
    let follow = mc.u_followSun > 0.5 && found.dir.w > 0.5;
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (follow) { sun = found.dir.xyz; }
    if (!follow) { return vec4f(0.0); }
    var fog = mc.u_fogColor.rgb;
    var sunTint = mc.u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    if (follow) { sunTint = found.color.rgb / max(max(found.color.r, found.color.g), max(found.color.b, 1e-3)); }
    return vec4f(volumeLight(entry, dir, len, sky, sun, found, sunTint, v.pos.xy), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /**
     * Rain, in two parts that a real storm has. Falling streaks: three layers of thin slanted lines
     * scrolling down the screen, each standing at a different distance, so a streak is hidden by a
     * surface nearer than the layer it belongs to and drawn over one farther away — the sky counts as
     * infinitely far. And a wet ground: a surface that faces up is darkened, and rings spread over it
     */
    createRain(): ShaderHandle {
        const GLSL = `
float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/// One layer of streaks: columns across the screen, one streak per cell at most, scrolling down.
float streaks(vec2 uv, float aspect, float cols, float speed, float seed, float T) {
    vec2 q = vec2(uv.x * aspect - uv.y * u_wind, uv.y);
    float cx = floor(q.x * cols);
    float fx = fract(q.x * cols);
    float h1 = hash11(cx + seed);
    float h2 = hash11(cx * 1.7 + seed * 3.1);
    // GL rows run up the screen, so a pattern that falls moves toward lower rows.
    float y = q.y * 4.0 + T * speed * (0.8 + 0.4 * h1) + h2 * 17.0;
    float cell = floor(y);
    float fy = fract(y);
    float here = hash11(cx * 31.0 + cell + seed);
    if (here > u_intensity * 0.5) return 0.0;
    float dx = abs(fx - 0.5 - (hash11(cell + cx) - 0.5) * 0.6);
    float across = 1.0 - smoothstep(0.0, 0.06, dx);
    float along = (1.0 - fy / u_streakLength) * step(fy, u_streakLength);
    return across * along;
}`;
        const WGSL = `
fn hash11(n : f32) -> f32 { return fract(sin(n * 127.1) * 43758.5453); }
fn hash21(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

fn streaks(uv : vec2f, aspect : f32, cols : f32, speed : f32, seed : f32, T : f32) -> f32 {
    let q = vec2f(uv.x * aspect - (1.0 - uv.y) * mc.u_wind, 1.0 - uv.y);
    let cx = floor(q.x * cols);
    let fx = fract(q.x * cols);
    let h1 = hash11(cx + seed);
    let h2 = hash11(cx * 1.7 + seed * 3.1);
    // Here uv runs DOWN the screen and q is flipped back to run up, as in GL, so the same
    // falling motion is the same sign.
    let y = q.y * 4.0 + T * speed * (0.8 + 0.4 * h1) + h2 * 17.0;
    let cell = floor(y);
    let fy = fract(y);
    let here = hash11(cx * 31.0 + cell + seed);
    if (here > mc.u_intensity * 0.5) { return 0.0; }
    let dx = abs(fx - 0.5 - (hash11(cell + cx) - 0.5) * 0.6);
    let across = 1.0 - smoothstep(0.0, 0.06, dx);
    var along = 0.0;
    if (fy <= mc.u_streakLength) { along = 1.0 - fy / mc.u_streakLength; }
    return across * along;
}`;
        const source = `#pragma shader "PP Rain"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_wetness float default(1) range(0,1)
#pragma param u_wind float default(0.15) range(-1,1)
#pragma param u_speed float default(1.6) range(0.2,6)
#pragma param u_streakLength float default(0.3) range(0.05,0.9)
#pragma param u_rippleScale float default(60) range(5,400)
#pragma param u_puddles float default(0.3) range(0,1)
#pragma param u_puddleScale float default(350) range(40,2000)
#pragma param u_streakColor color default(0.78,0.82,0.9,1)
#pragma param u_timeScale float default(1) range(0,1)
#pragma param u_phase float default(0) range(0,100000)
#pragma param u_shelterRange float default(3000) range(100,30000)
#pragma param u_shelterBias float default(40) range(1,500)
#pragma param u_coverActive float default(0) range(0,1)
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
${GLSL}

/// 1 where something stands over a point, as the map of the scene seen from straight above says — an awning, a roof,
/// a tree — and 0 in the open. The map stores the depth the shadow maps do, so a point on the surface itself is not over it.
float shelteredAt(vec3 W) {
    if (u_coverActive < 0.5) return 0.0;
    vec4 c = mat4(u_coverMatrix0, u_coverMatrix1, u_coverMatrix2, u_coverMatrix3) * vec4(W, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    float stored = dot(texture(u_rainCover, uv).rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    float here = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
    return stored < here - u_shelterBias / (4.0 * u_shelterRange) ? 1.0 : 0.0;
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 sz = vec2(textureSize(u_texture, 0));
    float aspect = sz.x / sz.y;
    float T = u_time.x * u_timeScale + u_phase;
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    // How far the surface here is, measured along the same ray as the streak layers are.
    float dist = d >= 1.0 ? 1e9 : length(worldFromDepth(uvOfTexel(c, size), d) - entry);

    vec3 tint = u_streakColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    vec3 col = src.rgb;

    // Water is the surface here, not the ground the depth found under it: the water takes the rain in its own ripples, and a wet
    // floor and its puddles drawn over it were the bed of the lake showing through.
    Surface surface = readSurface(c);
    if (d < 1.0 && u_wetness > 0.0 && !surface.water) {
        vec3 P = worldFromDepth(uvOfTexel(c, size), d);
        float dl = depthAt(c + ivec2(-1, 0), size);
        float dr = depthAt(c + ivec2( 1, 0), size);
        float dd = depthAt(c + ivec2(0, -1), size);
        float du = depthAt(c + ivec2(0,  1), size);
        vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P
                                            : P - worldAt(c + ivec2(-1, 0), size);
        vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P
                                            : P - worldAt(c + ivec2(0, -1), size);
        vec3 N = normalize(cross(ax, ay));
        if (dot(N, viewDirection(P)) < 0.0) N = -N;
        float up = smoothstep(0.86, 0.95, N.y);
        // A wet surface is darker, standing water darker still. What stands over it keeps it dry: rain does not reach
        // ground under an awning, and the awning, open to the sky, is wet in its turn.
        float shelter = shelteredAt(P + vec3(0.0, 1.0, 0.0));
        float wet = u_wetness * (1.0 - 0.9 * shelter);
        // Standing water on what is sealed (a street, a flagstone); ground as rough as soil or grass soaks it up, and is only darker.
        float soaks = surface.known ? smoothstep(0.82, 0.95, surface.roughness) : 0.0;
        float puddle = puddleMask(P.xz, basinCoverage(c, size, P, u_puddles, u_puddleScale), u_puddleScale) * up * wet * (1.0 - soaks);
        // Rain darkens a slope and a leaf as it does the flat, a little less where it faces away from the sky: darkening only what
        // faced straight up cut a hillside into pale wedges at one slope and left every plant light on dark ground. The surface's
        // own normal where it wrote one (a leaf's), the depth's elsewhere.
        vec3 Ns = surface.known ? surface.normal : N;
        if (dot(Ns, viewDirection(P)) < 0.0) Ns = -Ns;
        float exposed = mix(0.6, 1.0, smoothstep(0.0, 0.9, Ns.y));
        col *= 1.0 - 0.32 * wet * exposed;
        col *= 1.0 - 0.35 * puddle;
        // Drops landing need drops falling: wet ground under no rain is still.
        float falling = clamp(u_intensity, 0.0, 1.0) * (1.0 - shelter);
        float near = 1.0 - smoothstep(1200.0, 3500.0, dist);
        // Rings where drops land, on a grid in the world; they are denser and clearer on standing water.
        vec2 g = P.xz / u_rippleScale;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float h = hash21(id);
        vec2 centre = (vec2(hash21(id + 7.0), hash21(id + 13.0)) - 0.5) * 0.5;
        float phase = fract(T * 0.9 + h);
        float ring = (1.0 - smoothstep(0.0, 0.035, abs(length(f - centre) - phase * 0.5)))
                   * (1.0 - phase) * (1.0 - phase) * step(hash21(id + 3.0), mix(0.55, 0.9, puddle));
        col += tint * ring * mix(0.4, 0.9, puddle) * u_wetness * up * near * falling;
        // Splashes: the small, quick crown of a drop that lands on ground that is not water.
        vec2 g2 = P.xz / (u_rippleScale * 0.3);
        vec2 id2 = floor(g2);
        vec2 f2 = fract(g2) - 0.5;
        float ph2 = fract(T * 2.4 + hash21(id2 + 29.0));
        vec2 c2 = (vec2(hash21(id2 + 5.0), hash21(id2 + 11.0)) - 0.5) * 0.4;
        float splash = (1.0 - smoothstep(0.0, 0.06, abs(length(f2 - c2) - ph2 * 0.3)))
                     * (1.0 - ph2) * (1.0 - ph2) * (1.0 - ph2) * step(hash21(id2 + 2.0), 0.5);
        col += tint * splash * 0.55 * u_wetness * up * near * falling * (1.0 - puddle);
    }

    // Three layers, nearest last: a layer is drawn only over what is farther than it.
    // And a layer's drops fall where the layer stands: under a roof there are none.
    vec3 along = normalize(worldFromDepth(v_texCoord, d < 1.0 ? d : 1.0) - entry);
    float rain = 0.0;
    if (dist > 120.0)  rain += streaks(v_texCoord, aspect,  70.0, u_speed * 1.0, 1.0, T) * 0.35 * (1.0 - shelteredAt(entry + along * 120.0));
    if (dist > 450.0)  rain += streaks(v_texCoord, aspect, 130.0, u_speed * 1.4, 2.0, T) * 0.28 * (1.0 - shelteredAt(entry + along * 450.0));
    if (dist > 1400.0) rain += streaks(v_texCoord, aspect, 230.0, u_speed * 1.9, 3.0, T) * 0.22 * (1.0 - shelteredAt(entry + along * 1400.0));
    col += tint * rain * u_intensity;
    fragColor = vec4(col, src.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${PUDDLE_WGSL}
${BASIN_WGSL}
${GBUFFER_WGSL}
${WGSL}

fn shelteredAt(W : vec3f) -> f32 {
    if (mc.u_coverActive < 0.5) { return 0.0; }
    let m = mat4x4f(mc.u_coverMatrix0, mc.u_coverMatrix1, mc.u_coverMatrix2, mc.u_coverMatrix3);
    let c = m * vec4f(W, 1.0);
    let uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
    // This device's texture rows run the other way from the clip space the map was drawn in.
    let stored = dot(textureSampleLevel(u_rainCover, u_rainCover_s, vec2f(uv.x, 1.0 - uv.y), 0.0).rgb,
                     vec3f(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    let here = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
    return select(0.0, 1.0, stored < here - mc.u_shelterBias / (4.0 * mc.u_shelterRange));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let sz = vec2f(vec2i(textureDimensions(t0, 0)));
    let aspect = sz.x / sz.y;
    let T = tc.u_time.x * mc.u_timeScale + mc.u_phase;
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    let entry = worldFromDepth(v.v_texCoord, 0.0);
    var dist = 1e9;
    if (d < 1.0) { dist = length(worldFromDepth(uvOfTexel(c, size), d) - entry); }

    var tint = mc.u_streakColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    var col = src.rgb;

    let surface = readSurface(c);
    if (d < 1.0 && mc.u_wetness > 0.0 && !surface.water) {
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
        let up = smoothstep(0.86, 0.95, N.y);
        let shelter = shelteredAt(P + vec3f(0.0, 1.0, 0.0));
        let wet = mc.u_wetness * (1.0 - 0.9 * shelter);
        var soaks = 0.0;
        if (surface.known) { soaks = smoothstep(0.82, 0.95, surface.roughness); }
        let puddle = puddleMask(P.xz, basinCoverage(c, size, P, mc.u_puddles, mc.u_puddleScale), mc.u_puddleScale) * up * wet * (1.0 - soaks);
        // See the GLSL: rain darkens what does not face straight up too.
        var Ns = N;
        if (surface.known) { Ns = surface.normal; }
        if (dot(Ns, viewDirection(P)) < 0.0) { Ns = -Ns; }
        let exposed = mix(0.6, 1.0, smoothstep(0.0, 0.9, Ns.y));
        col = col * (1.0 - 0.32 * wet * exposed);
        col = col * (1.0 - 0.35 * puddle);
        let falling = clamp(mc.u_intensity, 0.0, 1.0) * (1.0 - shelter);
        let near = 1.0 - smoothstep(1200.0, 3500.0, dist);
        let g = P.xz / mc.u_rippleScale;
        let id = floor(g);
        let f = fract(g) - 0.5;
        let h = hash21(id);
        let centre = (vec2f(hash21(id + 7.0), hash21(id + 13.0)) - 0.5) * 0.5;
        let phase = fract(T * 0.9 + h);
        var ring = (1.0 - smoothstep(0.0, 0.035, abs(length(f - centre) - phase * 0.5)))
                 * (1.0 - phase) * (1.0 - phase);
        if (hash21(id + 3.0) > mix(0.55, 0.9, puddle)) { ring = 0.0; }
        col = col + tint * ring * mix(0.4, 0.9, puddle) * mc.u_wetness * up * near * falling;
        let g2 = P.xz / (mc.u_rippleScale * 0.3);
        let id2 = floor(g2);
        let f2 = fract(g2) - 0.5;
        let ph2 = fract(T * 2.4 + hash21(id2 + 29.0));
        let c2 = (vec2f(hash21(id2 + 5.0), hash21(id2 + 11.0)) - 0.5) * 0.4;
        var splash = (1.0 - smoothstep(0.0, 0.06, abs(length(f2 - c2) - ph2 * 0.3)))
                   * (1.0 - ph2) * (1.0 - ph2) * (1.0 - ph2);
        if (hash21(id2 + 2.0) > 0.5) { splash = 0.0; }
        col = col + tint * splash * 0.55 * mc.u_wetness * up * near * falling * (1.0 - puddle);
    }

    var dd1 = d;
    if (d >= 1.0) { dd1 = 1.0; }
    let along = normalize(worldFromDepth(v.v_texCoord, dd1) - entry);
    var rain = 0.0;
    if (dist > 120.0)  { rain = rain + streaks(v.v_texCoord, aspect,  70.0, mc.u_speed * 1.0, 1.0, T) * 0.35 * (1.0 - shelteredAt(entry + along * 120.0)); }
    if (dist > 450.0)  { rain = rain + streaks(v.v_texCoord, aspect, 130.0, mc.u_speed * 1.4, 2.0, T) * 0.28 * (1.0 - shelteredAt(entry + along * 450.0)); }
    if (dist > 1400.0) { rain = rain + streaks(v.v_texCoord, aspect, 230.0, mc.u_speed * 1.9, 3.0, T) * 0.22 * (1.0 - shelteredAt(entry + along * 1400.0)); }
    col = col + tint * rain * mc.u_intensity;
    return vec4f(col, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createMist2d(): ShaderHandle {
        // Fog that does not ask the depth buffer, because a 2D scene has none: sprites are blended, they write no depth, so the
        // fogs that measure a distance see nothing to fog. This one is a layer of drifting noise laid over the ground in WORLD
        // units, found from the screen by un-projecting at the near plane, which for an orthographic eye is the world's x and y.
        // It sits over the finished picture, so what is lit shows through it: `u_glow` lets a lamp's light scatter in the haze.
        const GLSL = `
float mistHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mistNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mistHash(i), mistHash(i + vec2(1.0, 0.0)), f.x), mix(mistHash(i + vec2(0.0, 1.0)), mistHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float mistFbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int k = 0; k < 3; k++) { s += a * mistNoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
    return s / 0.875;
}`;
        const WGSL = `
fn mistHash(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn mistNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mistHash(i), mistHash(i + vec2f(1.0, 0.0)), f.x), mix(mistHash(i + vec2f(0.0, 1.0)), mistHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn mistFbm(q : vec2f) -> f32 {
    var p = q;
    var a = 0.5;
    var s = 0.0;
    for (var k = 0; k < 3; k = k + 1) { s = s + a * mistNoise(p); p = p * 2.03 + vec2f(17.3, 9.1); a = a * 0.5; }
    return s / 0.875;
}`;
        const source = `#pragma shader "PP Mist 2D"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_fogColor color default(0.62,0.72,0.76,1)
#pragma param u_density float default(0.55) range(0,1)
#pragma param u_coverage float default(0.6) range(0,1)
#pragma param u_scale float default(520) range(40,4000)
#pragma param u_speed float default(18) range(0,400)
#pragma param u_direction float default(25) range(0,360)
#pragma param u_glow float default(0.6) range(0,2)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;
${GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 world = worldFromDepth(v_texCoord, 0.0).xy + u_renderOrigin.xy;
    float angle = radians(u_direction);
    vec2 p = (world - vec2(cos(angle), sin(angle)) * (u_speed * u_time.x)) / max(u_scale, 1.0);
    // Warped by a slower noise of its own, so the banks fold into one another and do not just slide.
    float n = mistFbm(p + 0.4 * vec2(mistFbm(p * 0.6 + 3.1), mistFbm(p * 0.6 + 8.4)));
    float lo = 1.0 - u_coverage * 0.9;
    float t = smoothstep(lo, lo + 0.35, n) * u_density;
    vec3 fog = u_fogColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
#endif
    vec3 col = mix(src.rgb, fog, t) + src.rgb * (t * u_glow);
    fragColor = vec4(col, src.a);
}
#pragma end

#pragma fragment wgsl
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let world = worldFromDepth(v.v_texCoord, 0.0).xy + frame.renderOrigin.xy;
    let angle = radians(mc.u_direction);
    let p = (world - vec2f(cos(angle), sin(angle)) * (mc.u_speed * tc.u_time.x)) / max(mc.u_scale, 1.0);
    let n = mistFbm(p + 0.4 * vec2f(mistFbm(p * 0.6 + 3.1), mistFbm(p * 0.6 + 8.4)));
    let lo = 1.0 - mc.u_coverage * 0.9;
    let t = smoothstep(lo, lo + 0.35, n) * mc.u_density;
    var fog = mc.u_fogColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
#endif
    let col = mix(src.rgb, fog, vec3f(t)) + src.rgb * (t * mc.u_glow);
    return vec4f(col, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createDistanceFog(): ShaderHandle {
        // Fog is a DISTANCE and a depth sample is not one: the same 0.9 is a
        // metre away up close and a hundred out. `worldFromDepth` (injected with
        // FrameConstants) puts the sample back in the world, so one setting holds.

        // The cleared far plane is not a surface — it is the absence of one, and
        // fogging it to full would paint the sky the fog colour at any range.
        const source = `#pragma shader "PP Distance Fog"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_fogColor color default(0.6,0.68,0.78,1)
#pragma param u_fogNear float default(10) range(0,500)
#pragma param u_fogFar float default(60) range(0,500)
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    float depth = texelFetch(u_sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
    if (depth >= 1.0) { fragColor = src; return; }

    // Un-projected twice, at the sample and at the near plane along the SAME ray.
    // An orthographic eye has no point to measure from, and this needs none: the
    // near plane is one, per pixel, and it is where fog should start anyway.
    vec3 world = worldFromDepth(v_texCoord, depth);
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    float dist = length(world - entry);
    float t = clamp((dist - u_fogNear) / max(u_fogFar - u_fogNear, 1e-4), 0.0, 1.0);
    // Authored as sRGB, like every colour: a linear frame takes it as light, not as a code.
    vec3 fog = u_fogColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
#endif
    fragColor = vec4(mix(src.rgb, fog, t * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let depth = textureLoad(t7, vec2i(v.pos.xy), 0);
    if (depth >= 1.0) { return src; }

    let world = worldFromDepth(v.v_texCoord, depth);
    let entry = worldFromDepth(v.v_texCoord, 0.0);
    let dist = length(world - entry);
    let t = clamp((dist - mc.u_fogNear) / max(mc.u_fogFar - mc.u_fogNear, 1e-4), 0.0, 1.0);
    var fog = mc.u_fogColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
#endif
    return vec4f(mix(src.rgb, fog, vec3f(t * mc.u_intensity)), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};

export function registerAtmosphereEffectSources(): void {
    registerEffectSources(atmosphereEffects);
}
