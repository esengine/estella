// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lensEffects.ts
 * @brief   The effects that belong to a camera rather than a world: motion blur, film grain, lens flare.
 * @details Same seam as postProcessEffects.ts — fragment-only `.esshader` sources with a WGSL twin each — kept apart
 *          because none of them reads a surface's material: they read the picture, and (for motion blur) where
 *          each pixel was a frame ago.
 */
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { SSAO_GLSL, SSAO_WGSL } from './sources/shared';

export const lensEffects = {
    /**
     * Motion blur: each pixel is smeared along the way it moved since the last frame.
     *
     * Where a pixel was comes from two places, as it does for temporal anti-aliasing. The camera's own move is
     * exact for everything the camera moves past: un-project the pixel with the depth buffer and project it again
     * with last frame's camera. A surface that moved by itself is not explained by that, so the frame's motion
     * pass (`u_velocity`) is read where what it drew is the surface the scene shows. The streak is `u_intensity`
     * of that distance — the shutter: 1 is a whole frame's exposure, 0.5 the half most cameras use — and never
     * longer than `u_maxBlur` of the picture, so a cut or a teleport smears a little instead of the whole image.
     * Taps are spread over the streak and shifted by a per-pixel noise, which turns the stepping into grain a
     * temporal pass then averages away.
     */
    createMotionBlur(): ShaderHandle {
        const source = `#pragma shader "PP MotionBlur"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.5) range(0,2)
#pragma param u_maxBlur float default(0.05) range(0.002,0.25)
#pragma param u_objectMotion float default(1) range(0,1)
#pragma param u_prevViewProjection0 color default(1,0,0,0)
#pragma param u_prevViewProjection1 color default(0,1,0,0)
#pragma param u_prevViewProjection2 color default(0,0,1,0)
#pragma param u_prevViewProjection3 color default(0,0,0,1)
#pragma param u_velocity texture default(black)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec4 cur = texture(u_texture, v_texCoord);
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    float d = depthAt(screenTexel(v_texCoord, dsize), dsize);
    // How far this pixel is from where it was, in uv: the camera's move first...
    vec2 m = vec2(0.0);
    vec3 world = worldFromDepth(v_texCoord, d);
    vec4 prev = mat4(u_prevViewProjection0, u_prevViewProjection1,
                     u_prevViewProjection2, u_prevViewProjection3) * vec4(world, 1.0);
    if (prev.w > 1e-6) m = prev.xy / prev.w * 0.5 + 0.5 - v_texCoord;
    // ...and, where a surface moved by itself, its own.
    ivec2 vsize = textureSize(u_velocity, 0);
    vec4 vel = texelFetch(u_velocity, screenTexel(v_texCoord, vsize), 0);
    if (u_objectMotion > 0.5 && vel.a > 0.5 && abs(vel.b - d) <= 2e-5 + (1.0 - d) * 0.02) m = vel.xy;
    m *= u_intensity;
    float reach = length(m);
    if (reach > u_maxBlur) m *= u_maxBlur / reach;
    vec2 pixels = m * u_viewport.xy;
    if (dot(pixels, pixels) < 1.0) { fragColor = cur; return; }

    const int TAPS = 16;
    float noise = ign(gl_FragCoord.xy) - 0.5;
    vec3 sum = cur.rgb;
    float weight = 1.0;
    for (int i = 0; i < TAPS; ++i) {
        float t = (float(i) + 0.5 + noise) / float(TAPS) - 0.5;
        vec2 uv = v_texCoord + m * t;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
        sum += texture(u_texture, uv).rgb;
        weight += 1.0;
    }
    fragColor = vec4(sum / weight, cur.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let cur = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let dsize = vec2i(textureDimensions(t7, 0));
    let d = depthAt(screenTexel(v.v_texCoord, dsize), dsize);
    var m = vec2f(0.0);
    let world = worldFromDepth(v.v_texCoord, d);
    let vp = mat4x4f(mc.u_prevViewProjection0, mc.u_prevViewProjection1,
                     mc.u_prevViewProjection2, mc.u_prevViewProjection3);
    let prev = vp * vec4f(world, 1.0);
    // This device's uv runs down the rows, so clip y is flipped on the way back (as the temporal effect does).
    if (prev.w > 1e-6) { m = vec2f(prev.x / prev.w * 0.5 + 0.5, 0.5 - prev.y / prev.w * 0.5) - v.v_texCoord; }
    let vsize = vec2i(textureDimensions(u_velocity, 0));
    let vel = textureLoad(u_velocity, screenTexel(v.v_texCoord, vsize), 0);
    if (mc.u_objectMotion > 0.5 && vel.a > 0.5 && abs(vel.b - d) <= 2e-5 + (1.0 - d) * 0.02) {
        m = vec2f(vel.x, -vel.y);
    }
    m = m * mc.u_intensity;
    let reach = length(m);
    if (reach > mc.u_maxBlur) { m = m * (mc.u_maxBlur / reach); }
    let pixels = m * tc.u_viewport.xy;
    if (dot(pixels, pixels) < 1.0) { return cur; }

    let noise = ign(v.v_texCoord * tc.u_viewport.xy) - 0.5;
    var sum = cur.rgb;
    var weight = 1.0;
    for (var i : i32 = 0; i < 16; i = i + 1) {
        let t = (f32(i) + 0.5 + noise) / 16.0 - 0.5;
        let uv = v.v_texCoord + m * t;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { continue; }
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).rgb;
        weight = weight + 1.0;
    }
    return vec4f(sum / weight, cur.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Film grain: noise the size of a film crystal, strongest in the mid-tones and absent from true black and from
     * clipped white, which is where film has none. The pattern is a hash of the grain cell and the frame clock, so it
     * crawls the way a projected film does instead of sitting on the screen as a texture.
     */
    createFilmGrain(): ShaderHandle {
        const source = `#pragma shader "PP FilmGrain"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.15) range(0,1)
#pragma param u_size float default(1.6) range(1,6)
#pragma param u_response float default(0.8) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

float hash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec2 cell = floor(v_texCoord * u_viewport.xy / u_size);
    // Two hashes averaged: the sum of two uniforms is triangular, so grain is mostly small with the odd large speck.
    float n = hash(vec3(cell, floor(u_time.x * 24.0))) + hash(vec3(cell + 71.0, floor(u_time.x * 24.0))) - 1.0;
    float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float mid = 4.0 * clamp(luma, 0.0, 1.0) * (1.0 - clamp(luma, 0.0, 1.0));
    float weight = mix(1.0, mid, u_response);
    fragColor = vec4(max(color.rgb * (1.0 + n * u_intensity * weight * 2.0), vec3(0.0)), color.a);
}
#pragma end

#pragma fragment wgsl
fn hash(p0 : vec3f) -> f32 {
    var p = fract(p0 * vec3f(0.1031, 0.1030, 0.0973));
    p = p + dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let cell = floor(v.v_texCoord * tc.u_viewport.xy / mc.u_size);
    let frameIndex = floor(tc.u_time.x * 24.0);
    let n = hash(vec3f(cell, frameIndex)) + hash(vec3f(cell + 71.0, frameIndex)) - 1.0;
    let luma = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let mid = 4.0 * clamp(luma, 0.0, 1.0) * (1.0 - clamp(luma, 0.0, 1.0));
    let weight = mix(1.0, mid, mc.u_response);
    return vec4f(max(color.rgb * (1.0 + n * mc.u_intensity * weight * 2.0), vec3f(0.0)), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Lens flare: what bright things do inside a lens. Ghosts are reflections between the elements, mirrored through
     * the centre of the picture and walking along the line from the light to it; the halo is the ring a wide-angle
     * lens throws round the centre. Only what is brighter than `u_threshold` takes part, and each ghost is taken
     * with a little chromatic spread, since a lens does not bend every colour the same. Added over the picture.
     */
    createLensFlare(): ShaderHandle {
        const source = `#pragma shader "PP LensFlare"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.4) range(0,4)
#pragma param u_threshold float default(1.2) range(0,8)
#pragma param u_ghosts float default(5) range(1,8)
#pragma param u_dispersal float default(0.35) range(0.05,1)
#pragma param u_haloWidth float default(0.45) range(0,1)
#pragma param u_chromatic float default(0.012) range(0,0.05)
#pragma param u_tint color default(1,0.85,0.7,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec3 bright(vec2 uv, vec2 spread) {
    // A small cross of taps, since a single one of a point light is a speck.
    vec3 c = max(texture(u_texture, uv).rgb - u_threshold, 0.0) * 0.4;
    c += max(texture(u_texture, uv + vec2(spread.x, 0.0)).rgb - u_threshold, 0.0) * 0.15;
    c += max(texture(u_texture, uv - vec2(spread.x, 0.0)).rgb - u_threshold, 0.0) * 0.15;
    c += max(texture(u_texture, uv + vec2(0.0, spread.y)).rgb - u_threshold, 0.0) * 0.15;
    c += max(texture(u_texture, uv - vec2(0.0, spread.y)).rgb - u_threshold, 0.0) * 0.15;
    return c;
}
vec3 fringed(vec2 uv, vec2 dir, vec2 spread) {
    return vec3(bright(uv + dir * u_chromatic, spread).r, bright(uv, spread).g, bright(uv - dir * u_chromatic, spread).b);
}

void main() {
    vec2 uv = vec2(1.0) - v_texCoord;
    vec2 toCentre = vec2(0.5) - uv;
    vec2 ghostStep = toCentre * u_dispersal;
    vec2 spread = 2.0 * u_viewport.zw;
    vec3 flare = vec3(0.0);
    for (int i = 0; i < 8; ++i) {
        if (float(i) >= u_ghosts) break;
        vec2 at = fract(uv + ghostStep * float(i));
        float edge = 1.0 - clamp(length(vec2(0.5) - at) / 0.7071, 0.0, 1.0);
        flare += fringed(at, normalize(toCentre + 1e-5), spread) * (edge * edge * edge);
    }
    vec2 haloDir = normalize(toCentre + 1e-5) * u_haloWidth;
    float haloEdge = 1.0 - clamp(length(vec2(0.5) - (uv + haloDir)) / 0.7071, 0.0, 1.0);
    flare += fringed(uv + haloDir, haloDir, spread) * pow(haloEdge, 4.0) * 2.0;
    fragColor = vec4(flare * u_tint.rgb * u_intensity, 1.0);
}
#pragma end

#pragma fragment wgsl
fn bright(uv : vec2f, spread : vec2f) -> vec3f {
    var c = max(textureSampleLevel(t0, s0, uv, 0.0).rgb - vec3f(mc.u_threshold), vec3f(0.0)) * 0.4;
    c = c + max(textureSampleLevel(t0, s0, uv + vec2f(spread.x, 0.0), 0.0).rgb - vec3f(mc.u_threshold), vec3f(0.0)) * 0.15;
    c = c + max(textureSampleLevel(t0, s0, uv - vec2f(spread.x, 0.0), 0.0).rgb - vec3f(mc.u_threshold), vec3f(0.0)) * 0.15;
    c = c + max(textureSampleLevel(t0, s0, uv + vec2f(0.0, spread.y), 0.0).rgb - vec3f(mc.u_threshold), vec3f(0.0)) * 0.15;
    c = c + max(textureSampleLevel(t0, s0, uv - vec2f(0.0, spread.y), 0.0).rgb - vec3f(mc.u_threshold), vec3f(0.0)) * 0.15;
    return c;
}
fn fringed(uv : vec2f, dir : vec2f, spread : vec2f) -> vec3f {
    return vec3f(bright(uv + dir * mc.u_chromatic, spread).r, bright(uv, spread).g, bright(uv - dir * mc.u_chromatic, spread).b);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = vec2f(1.0) - v.v_texCoord;
    let toCentre = vec2f(0.5) - uv;
    let ghostStep = toCentre * mc.u_dispersal;
    let spread = 2.0 * tc.u_viewport.zw;
    let dir = normalize(toCentre + vec2f(1e-5));
    var flare = vec3f(0.0);
    for (var i : i32 = 0; i < 8; i = i + 1) {
        if (f32(i) >= mc.u_ghosts) { break; }
        let at = fract(uv + ghostStep * f32(i));
        let edge = 1.0 - clamp(length(vec2f(0.5) - at) / 0.7071, 0.0, 1.0);
        flare = flare + fringed(at, dir, spread) * (edge * edge * edge);
    }
    let haloDir = dir * mc.u_haloWidth;
    let haloEdge = 1.0 - clamp(length(vec2f(0.5) - (uv + haloDir)) / 0.7071, 0.0, 1.0);
    flare = flare + fringed(uv + haloDir, haloDir, spread) * pow(haloEdge, 4.0) * 2.0;
    return vec4f(flare * mc.u_tint.rgb * mc.u_intensity, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    /** The second pass of the lens flare: the flare, worked out at half size, laid over the picture it came from. */
    createLensFlareComposite(): ShaderHandle {
        const source = `#pragma shader "PP LensFlare Composite"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
out vec4 fragColor;

void main() {
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    fragColor = vec4(scene.rgb + texture(u_texture, v_texCoord).rgb, scene.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    return vec4f(scene.rgb + textureSampleLevel(t0, s0, v.v_texCoord, 0.0).rgb, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};
