// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rain2d.ts
 * @brief   Rain for a scene with no depth: rings and puddles on the ground plane, and ground that stays dry under a roof.
 *
 * @details The 3D rain finds the ground by its depth and its shelter by a map of the scene seen from above. A 2D scene has neither: its sprites
 *          are blended and write no depth, and there is no "above" to look from. This rain lays its rings and puddles on the ground plane in
 *          WORLD units (found from the screen as the 2D mist finds them) and reads where it is dry from a mask: a small texture the rain-shelter
 *          system paints each frame over the view, a shelter's dryness in its alpha, however many shelters there are. A shelter's dryness is how
 *          much of the ground under it can be seen, so an opaque roof (which shows the roof, and the rain falls on that) is not dry, and one faded
 *          to show the room is.
 *
 *          It cannot tell a character from the ground it stands on by itself, so a sprite marked `RainUpright` is painted into the red channel of the
 *          same mask, and the rings, splashes, puddles and wet darkening are left off it. The falling streaks cross it: rain does fall on people.
 */
import type { ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';


const GLSL = `
float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float puddleNoise(vec2 p) {
    return vnoise(p) * 0.5 + vnoise(p * 2.07 + vec2(11.0, 5.0)) * 0.3 + vnoise(p * 4.3 + vec2(3.0, 17.0)) * 0.2;
}
/// The mask at a point: its alpha is how dry the ground is, its red how much of the point is something standing on it. The mask covers the view from (u_maskL, u_maskB) by (u_maskW, u_maskH) world units.
vec2 maskAt(vec2 w) {
    if (u_maskW <= 0.0 || u_maskH <= 0.0) return vec2(0.0);
    vec2 uv = (w - vec2(u_maskL, u_maskB)) / vec2(u_maskW, u_maskH);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec2(0.0);
    vec4 m = textureLod(u_shelterMask, uv, 0.0);
    return vec2(m.a, m.r);
}
/// One layer of streaks: columns across the screen, one streak per cell at most, scrolling down.
float streaks(vec2 uv, float aspect, float cols, float speed, float seed, float T) {
    vec2 q = vec2(uv.x * aspect - uv.y * u_wind, uv.y);
    float cx = floor(q.x * cols);
    float fx = fract(q.x * cols);
    float h1 = hash11(cx + seed);
    float h2 = hash11(cx * 1.7 + seed * 3.1);
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
fn vnoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), f.x), mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn puddleNoise(p : vec2f) -> f32 {
    return vnoise(p) * 0.5 + vnoise(p * 2.07 + vec2f(11.0, 5.0)) * 0.3 + vnoise(p * 4.3 + vec2f(3.0, 17.0)) * 0.2;
}
fn maskAt(w : vec2f) -> vec2f {
    if (mc.u_maskW <= 0.0 || mc.u_maskH <= 0.0) { return vec2f(0.0); }
    let uv = (w - vec2f(mc.u_maskL, mc.u_maskB)) / vec2f(mc.u_maskW, mc.u_maskH);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return vec2f(0.0); }
    // This device's texture rows run the other way from the clip space the mask was drawn in.
    let m = textureSampleLevel(u_shelterMask, u_shelterMask_s, vec2f(uv.x, 1.0 - uv.y), 0.0);
    return vec2f(m.a, m.r);
}
fn streaks(uv : vec2f, aspect : f32, cols : f32, speed : f32, seed : f32, T : f32) -> f32 {
    let q = vec2f(uv.x * aspect - (1.0 - uv.y) * mc.u_wind, 1.0 - uv.y);
    let cx = floor(q.x * cols);
    let fx = fract(q.x * cols);
    let h1 = hash11(cx + seed);
    let h2 = hash11(cx * 1.7 + seed * 3.1);
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

const SOURCE = `#pragma shader "PP Rain 2D"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_wetness float default(1) range(0,1)
#pragma param u_puddles float default(0.4) range(0,1)
#pragma param u_puddleScale float default(220) range(20,4000)
#pragma param u_rippleScale float default(36) range(6,400)
#pragma param u_wind float default(0.15) range(-1,1)
#pragma param u_speed float default(1.6) range(0.2,6)
#pragma param u_streakLength float default(0.3) range(0.05,0.9)
#pragma param u_streakColor color default(0.78,0.82,0.9,1)
#pragma param u_maskSize float default(512) range(64,2048)
#pragma param u_maskL float default(0) range(-1000000000,1000000000)
#pragma param u_maskB float default(0) range(-1000000000,1000000000)
#pragma param u_maskW float default(0) range(0,1000000000)
#pragma param u_maskH float default(0) range(0,1000000000)
#pragma param u_shelterMask texture default(black)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;
${GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 sz = vec2(textureSize(u_texture, 0));
    float aspect = sz.x / sz.y;
    float T = u_time.x;
    vec2 w = worldFromDepth(v_texCoord, 0.0).xy + u_renderOrigin.xy;
    vec3 tint = u_streakColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    // Where a roof or a crown shows the ground under it, that ground is dry and nothing falls on it.
    vec2 m = maskAt(w);
    float dry = min(m.x * 1.15, 1.0);
    // Ground only: where a character or a trunk stands, the floor is not what is seen, so no rings, puddles or wet darkening are drawn on it.
    float ground = 1.0 - min(m.y * 1.15, 1.0);
    float wet = u_wetness * (1.0 - dry) * ground;
    float falling = clamp(u_intensity, 0.0, 1.0) * (1.0 - dry) * ground;
    vec3 col = src.rgb;

    // Standing water where a slow noise of the ground passes a threshold; the rest of the ground is only darker.
    float lo = 1.0 - u_puddles;
    float puddle = u_puddles > 0.001 ? smoothstep(lo, lo + 0.1, puddleNoise(w / u_puddleScale)) * wet : 0.0;
    col *= 1.0 - 0.3 * wet;
    col *= 1.0 - 0.3 * puddle;
    col += tint * 0.04 * puddle;

    // Rings where drops land, on a grid in the world; denser and clearer on standing water.
    vec2 g = w / u_rippleScale;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    vec2 centre = (vec2(hash21(id + 7.0), hash21(id + 13.0)) - 0.5) * 0.5;
    float phase = fract(T * 0.9 + h);
    float ring = (1.0 - smoothstep(0.0, 0.05, abs(length(f - centre) - phase * 0.5)))
               * (1.0 - phase) * (1.0 - phase) * step(hash21(id + 3.0), mix(0.4, 0.9, puddle));
    col += tint * ring * mix(0.18, 0.6, puddle) * u_wetness * falling;
    // Splashes: the small quick crown of a drop that lands on ground that is not water.
    vec2 g2 = w / (u_rippleScale * 0.3);
    vec2 id2 = floor(g2);
    vec2 f2 = fract(g2) - 0.5;
    float ph2 = fract(T * 2.4 + hash21(id2 + 29.0));
    vec2 c2 = (vec2(hash21(id2 + 5.0), hash21(id2 + 11.0)) - 0.5) * 0.4;
    float splash = (1.0 - smoothstep(0.0, 0.08, abs(length(f2 - c2) - ph2 * 0.3)))
                 * (1.0 - ph2) * (1.0 - ph2) * (1.0 - ph2) * step(hash21(id2 + 2.0), 0.4);
    col += tint * splash * 0.35 * u_wetness * falling * (1.0 - puddle);

    // Three layers of falling streaks; none where the ground under them is dry.
    float rain = streaks(v_texCoord, aspect, 70.0, u_speed * 1.0, 1.0, T) * 0.35
               + streaks(v_texCoord, aspect, 130.0, u_speed * 1.4, 2.0, T) * 0.28
               + streaks(v_texCoord, aspect, 230.0, u_speed * 1.9, 3.0, T) * 0.22;
    col += tint * rain * u_intensity * (1.0 - dry);
    fragColor = vec4(col, src.a);
}
#pragma end

#pragma fragment wgsl
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let sz = vec2f(vec2i(textureDimensions(t0, 0)));
    let aspect = sz.x / sz.y;
    let T = tc.u_time.x;
    let w = worldFromDepth(v.v_texCoord, 0.0).xy + frame.renderOrigin.xy;
    var tint = mc.u_streakColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    let m = maskAt(w);
    let dry = min(m.x * 1.15, 1.0);
    let ground = 1.0 - min(m.y * 1.15, 1.0);
    let wet = mc.u_wetness * (1.0 - dry) * ground;
    let falling = clamp(mc.u_intensity, 0.0, 1.0) * (1.0 - dry) * ground;
    var col = src.rgb;

    let lo = 1.0 - mc.u_puddles;
    var puddle = 0.0;
    if (mc.u_puddles > 0.001) { puddle = smoothstep(lo, lo + 0.1, puddleNoise(w / mc.u_puddleScale)) * wet; }
    col = col * (1.0 - 0.3 * wet);
    col = col * (1.0 - 0.3 * puddle);
    col = col + tint * 0.04 * puddle;

    let g = w / mc.u_rippleScale;
    let id = floor(g);
    let f = fract(g) - 0.5;
    let h = hash21(id);
    let centre = (vec2f(hash21(id + 7.0), hash21(id + 13.0)) - 0.5) * 0.5;
    let phase = fract(T * 0.9 + h);
    let ring = (1.0 - smoothstep(0.0, 0.05, abs(length(f - centre) - phase * 0.5)))
             * (1.0 - phase) * (1.0 - phase) * step(hash21(id + 3.0), mix(0.4, 0.9, puddle));
    col = col + tint * ring * mix(0.18, 0.6, puddle) * mc.u_wetness * falling;
    let g2 = w / (mc.u_rippleScale * 0.3);
    let id2 = floor(g2);
    let f2 = fract(g2) - 0.5;
    let ph2 = fract(T * 2.4 + hash21(id2 + 29.0));
    let c2 = (vec2f(hash21(id2 + 5.0), hash21(id2 + 11.0)) - 0.5) * 0.4;
    let splash = (1.0 - smoothstep(0.0, 0.08, abs(length(f2 - c2) - ph2 * 0.3)))
               * (1.0 - ph2) * (1.0 - ph2) * (1.0 - ph2) * step(hash21(id2 + 2.0), 0.4);
    col = col + tint * splash * 0.35 * mc.u_wetness * falling * (1.0 - puddle);

    let rain = streaks(v.v_texCoord, aspect, 70.0, mc.u_speed * 1.0, 1.0, T) * 0.35
             + streaks(v.v_texCoord, aspect, 130.0, mc.u_speed * 1.4, 2.0, T) * 0.28
             + streaks(v.v_texCoord, aspect, 230.0, mc.u_speed * 1.9, 3.0, T) * 0.22;
    col = col + tint * rain * mc.u_intensity * (1.0 - dry);
    return vec4f(col, src.a);
}
#pragma end
`;

export const rain2dEffects = {
    createRain2d(): ShaderHandle {
        return Material.compileShader(SOURCE);
    },
};
