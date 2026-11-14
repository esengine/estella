// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  layerSurfaceShader.ts
 * @brief The ground's layers as one piece of shader code, shared by every shader that draws ground from layer files (Terrain Layers, Planet).
 *
 * What a pixel of ground is made of, from its paint: each layer's weight (broken up by noise of its own and sharpened), the layers read
 * without repeat near the eye and on a wider tile far off, projected on the planes the ground faces, then blended by the layers' heights.
 * Only the four layers with the most weight at a pixel are read: past four the rest are a sliver of the blend, and reading all eight cost
 * every pixel of ground the textures of all eight, as Unreal's landscape caps the layers a component weighs.
 *
 * A shader that uses it declares the params `layerParams` writes (its own defaults keep its own look), puts `LAYER_SURFACE_GLSL` /
 * `LAYER_SURFACE_WGSL` in its fragment, and calls `tnLayers`. The vertex stage and the lighting stay the shader's own.
 */

/** The defaults a shader gives the shared params: how a ground drawn with it looks before a material says otherwise. */
export interface LayerParamDefaults {
    sharpness: number;
    heightBlend: number;
    blendNoise: number;
    antiTile: number;
}

/** The `#pragma param` lines of the layers, with this shader's defaults. */
export function layerParams(d: LayerParamDefaults): string {
    return `#pragma param u_albedoLayers textureArray default(white)
#pragma param u_normalLayers textureArray default(flatnormal) texel(data)
#pragma param u_maskLayers textureArray default(white) texel(data)
// How many layers there are, and how many world units one repeat of each covers (layers 1 to 4, then 5 to 8).
#pragma param u_layerCount float default(0) range(0,8) ui(slider)
#pragma param u_tiles0 vec4 default(4,4,4,4)
#pragma param u_tiles1 vec4 default(4,4,4,4)
// Each layer's own height blend (below zero: the material's u_heightBlend), written from the layer files.
#pragma param u_heightBlends0 vec4 default(-1,-1,-1,-1)
#pragma param u_heightBlends1 vec4 default(-1,-1,-1,-1)
// How much a layer with more weight takes over from the others at the seam: 1 is a plain blend, higher a harder edge.
#pragma param u_sharpness float default(${d.sharpness}) range(1,8) ui(slider)
// How much the seams follow the layers' heights (their masks' blue): rock shows through the gaps in the grass before the grass gives
// way, and sand fills the low places between stones. 0 is a plain blend of the weights.
#pragma param u_heightBlend float default(${d.heightBlend}) range(0,1) ui(slider)
// How much each layer's weight is broken up by slow noise of its own before the strongest wins.
#pragma param u_blendNoise float default(${d.blendNoise}) range(0,1) ui(slider)
// From the middle distance on, each layer is also read on a tile u_farScale times as wide and mixed in, so its repeat is lost far off.
#pragma param u_farScale float default(4.3) range(1,32) ui(slider)
// How strongly each layer is read without repeat near the eye (hex tiling), so no tile is seen.
#pragma param u_antiTile float default(${d.antiTile}) range(0,1) ui(slider)
// How far round a cell may be turned (1 any way, 0 shifted only): a layer with a grain, sand in ripples or rock in beds, turned cell by
// cell is lit cell by cell, and shows the hexagons.
#pragma param u_antiTileTurn float default(1) range(0,1) ui(slider)
// How much of a wall is read on the wider tile even close to. The ground at your feet is seen a few tiles at a time; a cliff is seen
// whole, a hundred tiles of it at once, and its sides are read plain (no hex tiling, which would turn a rock's beds), so the same tile
// stands in rows and columns up a face unless a second, wider reading breaks it. 0 leaves a wall one tile repeated.
#pragma param u_wallBreak float default(0.4) range(0,1) ui(slider)
`;
}

/** The layers in GLSL: helpers, then `tnLayers`. Needs `precision highp sampler2DArray`. */
export const LAYER_SURFACE_GLSL = `float tnHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float tnNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(tnHash(i), tnHash(i + vec2(1.0, 0.0)), f.x), mix(tnHash(i + vec2(0.0, 1.0)), tnHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 tnHash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float tnTile(int i) { return i < 4 ? u_tiles0[i] : u_tiles1[i - 4]; }
float tnHeightBlend(int i) { float b = i < 4 ? u_heightBlends0[i] : u_heightBlends1[i - 4]; return b < 0.0 ? u_heightBlend : b; }

// One layer read at uv (in repeats) on one plane: its albedo, its tangent normal's slope (x, y) and its mask, from the gradients given.
struct TnTap { vec3 albedo; vec2 slope; vec3 mask; };
TnTap tnPlain(vec2 uv, float layer, vec2 gx, vec2 gy) {
    vec3 at = vec3(uv, layer);
    TnTap t;
    t.albedo = textureGrad(u_albedoLayers, at, gx, gy).rgb;
    t.slope = textureGrad(u_normalLayers, at, gx, gy).rg * 2.0 - 1.0;
    t.mask = textureGrad(u_maskLayers, at, gx, gy).rgb;
    return t;
}
// The same in one hex cell: shifted and turned by the cell's random numbers; the normal's slope turned back with it.
TnTap tnHexTap(vec2 uv, float layer, vec2 cell, vec2 gx, vec2 gy) {
    vec2 r = tnHash2(cell);
    float a = r.x * 6.2831853 * u_antiTileTurn;
    mat2 turn = mat2(cos(a), -sin(a), sin(a), cos(a));
    TnTap t = tnPlain(turn * uv + r, layer, turn * gx, turn * gy);
    t.slope = t.slope * turn;
    return t;
}
// A layer read without repeat (hex tiling, Mikkelsen 2022): three cells about a point blended by nearness, the higher reading winning.
TnTap tnHex(vec2 uv, float layer, vec2 gx, vec2 gy, float strength) {
    vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
    vec2 base = floor(skewed);
    vec3 f = vec3(fract(skewed), 0.0);
    f.z = 1.0 - f.x - f.y;
    float s = step(0.0, -f.z), s2 = 2.0 * s - 1.0;
    vec3 w = vec3(-f.z * s2, s - f.y * s2, s - f.x * s2);
    TnTap c1 = tnHexTap(uv, layer, base + vec2(s, s), gx, gy);
    TnTap c2 = tnHexTap(uv, layer, base + vec2(s, 1.0 - s), gx, gy);
    TnTap c3 = tnHexTap(uv, layer, base + vec2(1.0 - s, s), gx, gy);
    vec3 h = vec3(c1.mask.b, c2.mask.b, c3.mask.b);
    w = pow(max(w * mix(vec3(1.0), 0.4 + h, strength), vec3(1e-4)), vec3(7.0));
    w /= dot(w, vec3(1.0));
    TnTap t;
    t.albedo = c1.albedo * w.x + c2.albedo * w.y + c3.albedo * w.z;
    t.slope = c1.slope * w.x + c2.slope * w.y + c3.slope * w.z;
    t.mask = c1.mask * w.x + c2.mask * w.y + c3.mask * w.z;
    return t;
}
// A tangent normal's slope laid on a plane whose texture runs along T and B, about the surface's normal N.
vec3 tnBend(vec2 slope, vec3 T, vec3 B, vec3 N) {
    T = normalize(T - N * dot(N, T));
    B = normalize(B - N * dot(N, B));
    return slope.x * T + slope.y * B;
}
// How strongly the layers are read without repeat (x) and how much of the wide tile is mixed in (y), at this distance from the eye.
vec2 tnNearFar(float eye) {
    float scale = tnTile(0);
    return vec2((1.0 - smoothstep(scale * 20.0, scale * 45.0, eye)) * u_antiTile, smoothstep(scale * 6.0, scale * 40.0, eye) * 0.65);
}

// What the layers make of a pixel: its colour, the slope its normal maps add, and its mask (occlusion, roughness, height).
struct TnSurface { vec3 albedo; vec3 slope; vec3 mask; };
// paintA / paintB: the weights of layers 1 to 4 and 5 to 8. at: where the ground is, as its layers are laid (the top plane reads at.xz,
// the sides (at.z, at.y) and (at.x, at.y)); dpx / dpy its gradients across the screen. N: the ground's normal. planes: how much of each
// plane is read (x, top, z). nearFar: tnNearFar.
TnSurface tnLayers(vec4 paintA, vec4 paintB, vec3 at, vec3 dpx, vec3 dpy, vec3 N, vec3 planes, vec2 nearFar) {
    int count = int(u_layerCount + 0.5);
    // Each painted layer's say, broken up by noise of its own so where two meet the edge is ragged, not the paint's gradient. Three
    // octaves: the slow one moves where the edge runs, the two finer break it up at the size of a paint texel and below. The four with
    // the most say are kept, heaviest first.
    vec4 wt = vec4(0.0);
    ivec4 id = ivec4(0);
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
        if (i >= count) break;
        float raw = i < 4 ? paintA[i] : paintB[i - 4];
        if (raw <= 0.0) continue;
        float tileSize = tnTile(i);
        float wander = tnNoise(at.xz / (tileSize * 2.3) + float(i) * 11.0 + 3.0) * 0.5
                     + tnNoise(at.xz / (tileSize * 0.45) + float(i) * 7.0 + 17.0) * 0.3
                     + tnNoise(at.xz / (tileSize * 0.11) + float(i) * 5.0 + 29.0) * 0.2;
        float v = raw * mix(1.0, 0.35 + 1.3 * wander, u_blendNoise);
        sum += v;
        if (v > wt.w) {
            if (v > wt.x) { wt = vec4(v, wt.xyz); id = ivec4(i, id.xyz); }
            else if (v > wt.y) { wt = vec4(wt.x, v, wt.yz); id = ivec4(id.x, i, id.yz); }
            else if (v > wt.z) { wt = vec4(wt.xy, v, wt.z); id = ivec4(id.xy, i, id.z); }
            else { wt.w = v; id.w = i; }
        }
    }
    // Ground no layer here has a say in (paint that names only layers that are not packed yet, or none at all) is the first
    // layer's: it is drawn as ground, where with no weight at all it was black.
    if (sum <= 0.0) { wt = vec4(1.0, 0.0, 0.0, 0.0); id = ivec4(0); sum = 1.0; }
    wt = pow(wt / max(sum, 1e-4), vec4(u_sharpness));
    wt /= max(dot(wt, vec4(1.0)), 1e-4);

    vec3 albedo[4];
    vec3 bend[4];
    vec3 mask[4];
    for (int k = 0; k < 4; k++) {
        albedo[k] = vec3(0.0); bend[k] = vec3(0.0); mask[k] = vec3(1.0, 1.0, 0.0);
        if (wt[k] <= 1e-3) continue;
        int i = id[k];
        float layer = float(i), tile = tnTile(i);
        if (planes.y > 0.0) {
            // WebGL takes no ?: between structures.
            TnTap top;
            if (nearFar.x > 0.01) top = tnHex(at.xz / tile, layer, dpx.xz / tile, dpy.xz / tile, nearFar.x);
            else top = tnPlain(at.xz / tile, layer, dpx.xz / tile, dpy.xz / tile);
            if (nearFar.y > 0.01) {
                float big = tile * u_farScale;
                TnTap wide = tnPlain(at.xz / big + 0.21, layer, dpx.xz / big, dpy.xz / big);
                top.albedo = mix(top.albedo, wide.albedo, nearFar.y);
                top.mask = mix(top.mask, wide.mask, nearFar.y);
            }
            albedo[k] = top.albedo * planes.y;
            mask[k] = top.mask * planes.y;
            bend[k] = tnBend(top.slope, vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), N) * planes.y;
        } else {
            mask[k] = vec3(0.0);
        }
        // A wall's second reading: the wider tile, by as much as the distance asks for or u_wallBreak, whichever is more.
        float wallWide = max(nearFar.y, u_wallBreak);
        float wallTile = tile * u_farScale;
        if (planes.x > 0.02) {
            TnTap x = tnPlain(at.zy / tile, layer, dpx.zy / tile, dpy.zy / tile);
            if (wallWide > 0.01) {
                TnTap wide = tnPlain(at.zy / wallTile + 0.37, layer, dpx.zy / wallTile, dpy.zy / wallTile);
                x.albedo = mix(x.albedo, wide.albedo, wallWide);
                x.mask = mix(x.mask, wide.mask, wallWide);
            }
            albedo[k] += x.albedo * planes.x; mask[k] += x.mask * planes.x;
            bend[k] += tnBend(x.slope, vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), N) * planes.x;
        }
        if (planes.z > 0.02) {
            TnTap z = tnPlain(at.xy / tile, layer, dpx.xy / tile, dpy.xy / tile);
            if (wallWide > 0.01) {
                TnTap wide = tnPlain(at.xy / wallTile + 0.61, layer, dpx.xy / wallTile, dpy.xy / wallTile);
                z.albedo = mix(z.albedo, wide.albedo, wallWide);
                z.mask = mix(z.mask, wide.mask, wallWide);
            }
            albedo[k] += z.albedo * planes.z; mask[k] += z.mask * planes.z;
            bend[k] += tnBend(z.slope, vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), N) * planes.z;
        }
    }
    // Then by height: each layer stands as high as its mask says, and where two meet the higher one shows. How much height decides is
    // each layer's own say, weighted by how much of that layer is here, so grass into sand blends by the paint and stones standing
    // through grass by their heights, with no one number for the whole ground.
    float top = -1.0;
    for (int k = 0; k < 4; k++) if (wt[k] > 1e-3) top = max(top, mask[k].b + wt[k] * 1.5);
    float hsum = 0.0, byHeight = 0.0;
    vec4 hw = vec4(0.0);
    for (int k = 0; k < 4; k++) {
        if (wt[k] <= 1e-3) continue;
        hw[k] = max(mask[k].b + wt[k] * 1.5 - (top - 0.35), 0.0);
        hsum += hw[k];
        byHeight += wt[k] * tnHeightBlend(id[k]);
    }
    TnSurface s;
    s.albedo = vec3(0.0); s.slope = vec3(0.0); s.mask = vec3(0.0);
    for (int k = 0; k < 4; k++) {
        float f = mix(wt[k], hw[k] / max(hsum, 1e-4), byHeight);
        s.albedo += albedo[k] * f; s.slope += bend[k] * f; s.mask += mask[k] * f;
    }
    return s;
}
`;

/** The same in WGSL, under the engine's conventions (params as `mc.<name>`, textures with their `_s` samplers). */
export const LAYER_SURFACE_WGSL = `fn tnHash(p0 : vec2f) -> f32 {
    var p = fract(p0 * vec2f(0.1031, 0.1030));
    p = p + dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
fn tnNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(tnHash(i), tnHash(i + vec2f(1.0, 0.0)), f.x), mix(tnHash(i + vec2f(0.0, 1.0)), tnHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn tnHash2(p : vec2f) -> vec2f {
    return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
}
fn tnTile(i : i32) -> f32 {
    if (i < 4) { return mc.u_tiles0[i]; }
    return mc.u_tiles1[i - 4];
}
fn tnHeightBlend(i : i32) -> f32 {
    var b = 0.0;
    if (i < 4) { b = mc.u_heightBlends0[i]; } else { b = mc.u_heightBlends1[i - 4]; }
    if (b < 0.0) { return mc.u_heightBlend; }
    return b;
}
struct TnTap { albedo : vec3f, slope : vec2f, mask : vec3f };
fn tnPlain(uv : vec2f, layer : i32, gx : vec2f, gy : vec2f) -> TnTap {
    var t : TnTap;
    t.albedo = textureSampleGrad(u_albedoLayers, u_albedoLayers_s, uv, layer, gx, gy).rgb;
    t.slope = textureSampleGrad(u_normalLayers, u_normalLayers_s, uv, layer, gx, gy).rg * 2.0 - vec2f(1.0);
    t.mask = textureSampleGrad(u_maskLayers, u_maskLayers_s, uv, layer, gx, gy).rgb;
    return t;
}
fn tnHexTap(uv : vec2f, layer : i32, cell : vec2f, gx : vec2f, gy : vec2f) -> TnTap {
    let r = tnHash2(cell);
    let a = r.x * 6.2831853 * mc.u_antiTileTurn;
    let turn = mat2x2f(cos(a), -sin(a), sin(a), cos(a));
    var t = tnPlain(turn * uv + r, layer, turn * gx, turn * gy);
    t.slope = t.slope * turn;
    return t;
}
fn tnHex(uv : vec2f, layer : i32, gx : vec2f, gy : vec2f, strength : f32) -> TnTap {
    let skewed = mat2x2f(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
    let base = floor(skewed);
    let fr = fract(skewed);
    let fz = 1.0 - fr.x - fr.y;
    let s = step(0.0, -fz);
    let s2 = 2.0 * s - 1.0;
    var w = vec3f(-fz * s2, s - fr.y * s2, s - fr.x * s2);
    let c1 = tnHexTap(uv, layer, base + vec2f(s, s), gx, gy);
    let c2 = tnHexTap(uv, layer, base + vec2f(s, 1.0 - s), gx, gy);
    let c3 = tnHexTap(uv, layer, base + vec2f(1.0 - s, s), gx, gy);
    let h = vec3f(c1.mask.b, c2.mask.b, c3.mask.b);
    w = pow(max(w * mix(vec3f(1.0), vec3f(0.4) + h, vec3f(strength)), vec3f(1e-4)), vec3f(7.0));
    w = w / dot(w, vec3f(1.0));
    var t : TnTap;
    t.albedo = c1.albedo * w.x + c2.albedo * w.y + c3.albedo * w.z;
    t.slope = c1.slope * w.x + c2.slope * w.y + c3.slope * w.z;
    t.mask = c1.mask * w.x + c2.mask * w.y + c3.mask * w.z;
    return t;
}
fn tnBend(slope : vec2f, T0 : vec3f, B0 : vec3f, N : vec3f) -> vec3f {
    let T = normalize(T0 - N * dot(N, T0));
    let B = normalize(B0 - N * dot(N, B0));
    return slope.x * T + slope.y * B;
}
fn tnNearFar(eye : f32) -> vec2f {
    let scale = tnTile(0);
    return vec2f((1.0 - smoothstep(scale * 20.0, scale * 45.0, eye)) * mc.u_antiTile, smoothstep(scale * 6.0, scale * 40.0, eye) * 0.65);
}
struct TnSurface { albedo : vec3f, slope : vec3f, mask : vec3f };
fn tnLayers(paintA : vec4f, paintB : vec4f, at : vec3f, dpx : vec3f, dpy : vec3f, N : vec3f, planes : vec3f, nearFar : vec2f) -> TnSurface {
    let count = i32(mc.u_layerCount + 0.5);
    var wt = vec4f(0.0);
    var id = vec4i(0);
    var sum = 0.0;
    for (var i = 0; i < 8; i = i + 1) {
        if (i >= count) { break; }
        var raw = 0.0;
        if (i < 4) { raw = paintA[i]; } else { raw = paintB[i - 4]; }
        if (raw <= 0.0) { continue; }
        let tileSize = tnTile(i);
        let wander = tnNoise(at.xz / (tileSize * 2.3) + vec2f(f32(i) * 11.0 + 3.0)) * 0.5
                   + tnNoise(at.xz / (tileSize * 0.45) + vec2f(f32(i) * 7.0 + 17.0)) * 0.3
                   + tnNoise(at.xz / (tileSize * 0.11) + vec2f(f32(i) * 5.0 + 29.0)) * 0.2;
        let v = raw * mix(1.0, 0.35 + 1.3 * wander, mc.u_blendNoise);
        sum = sum + v;
        if (v > wt.w) {
            if (v > wt.x) { wt = vec4f(v, wt.xyz); id = vec4i(i, id.xyz); }
            else if (v > wt.y) { wt = vec4f(wt.x, v, wt.yz); id = vec4i(id.x, i, id.yz); }
            else if (v > wt.z) { wt = vec4f(wt.xy, v, wt.z); id = vec4i(id.xy, i, id.z); }
            else { wt.w = v; id.w = i; }
        }
    }
    // See the GLSL twin: ground no layer has a say in is the first layer's.
    if (sum <= 0.0) { wt = vec4f(1.0, 0.0, 0.0, 0.0); id = vec4i(0); sum = 1.0; }
    wt = pow(wt / max(sum, 1e-4), vec4f(mc.u_sharpness));
    wt = wt / max(dot(wt, vec4f(1.0)), 1e-4);

    var albedo : array<vec3f, 4>;
    var bend : array<vec3f, 4>;
    var mask : array<vec3f, 4>;
    for (var k = 0; k < 4; k = k + 1) {
        albedo[k] = vec3f(0.0);
        bend[k] = vec3f(0.0);
        mask[k] = vec3f(1.0, 1.0, 0.0);
        if (wt[k] <= 1e-3) { continue; }
        let i = id[k];
        let tile = tnTile(i);
        if (planes.y > 0.0) {
            var top : TnTap;
            if (nearFar.x > 0.01) { top = tnHex(at.xz / tile, i, dpx.xz / tile, dpy.xz / tile, nearFar.x); }
            else { top = tnPlain(at.xz / tile, i, dpx.xz / tile, dpy.xz / tile); }
            if (nearFar.y > 0.01) {
                let big = tile * mc.u_farScale;
                let wide = tnPlain(at.xz / big + vec2f(0.21), i, dpx.xz / big, dpy.xz / big);
                top.albedo = mix(top.albedo, wide.albedo, vec3f(nearFar.y));
                top.mask = mix(top.mask, wide.mask, vec3f(nearFar.y));
            }
            albedo[k] = top.albedo * planes.y;
            mask[k] = top.mask * planes.y;
            bend[k] = tnBend(top.slope, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), N) * planes.y;
        } else {
            mask[k] = vec3f(0.0);
        }
        let wallWide = max(nearFar.y, mc.u_wallBreak);
        let wallTile = tile * mc.u_farScale;
        if (planes.x > 0.02) {
            var x = tnPlain(at.zy / tile, i, dpx.zy / tile, dpy.zy / tile);
            if (wallWide > 0.01) {
                let wide = tnPlain(at.zy / wallTile + vec2f(0.37), i, dpx.zy / wallTile, dpy.zy / wallTile);
                x.albedo = mix(x.albedo, wide.albedo, vec3f(wallWide));
                x.mask = mix(x.mask, wide.mask, vec3f(wallWide));
            }
            albedo[k] = albedo[k] + x.albedo * planes.x;
            mask[k] = mask[k] + x.mask * planes.x;
            bend[k] = bend[k] + tnBend(x.slope, vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), N) * planes.x;
        }
        if (planes.z > 0.02) {
            var z = tnPlain(at.xy / tile, i, dpx.xy / tile, dpy.xy / tile);
            if (wallWide > 0.01) {
                let wide = tnPlain(at.xy / wallTile + vec2f(0.61), i, dpx.xy / wallTile, dpy.xy / wallTile);
                z.albedo = mix(z.albedo, wide.albedo, vec3f(wallWide));
                z.mask = mix(z.mask, wide.mask, vec3f(wallWide));
            }
            albedo[k] = albedo[k] + z.albedo * planes.z;
            mask[k] = mask[k] + z.mask * planes.z;
            bend[k] = bend[k] + tnBend(z.slope, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), N) * planes.z;
        }
    }
    var top = -1.0;
    for (var k = 0; k < 4; k = k + 1) { if (wt[k] > 1e-3) { top = max(top, mask[k].b + wt[k] * 1.5); } }
    var hsum = 0.0;
    var byHeight = 0.0;
    var hw = vec4f(0.0);
    for (var k = 0; k < 4; k = k + 1) {
        if (wt[k] <= 1e-3) { continue; }
        hw[k] = max(mask[k].b + wt[k] * 1.5 - (top - 0.35), 0.0);
        hsum = hsum + hw[k];
        byHeight = byHeight + wt[k] * tnHeightBlend(id[k]);
    }
    var s : TnSurface;
    s.albedo = vec3f(0.0);
    s.slope = vec3f(0.0);
    s.mask = vec3f(0.0);
    for (var k = 0; k < 4; k = k + 1) {
        let f = mix(wt[k], hw[k] / max(hsum, 1e-4), byHeight);
        s.albedo = s.albedo + albedo[k] * f;
        s.slope = s.slope + bend[k] * f;
        s.mask = s.mask + mask[k] * f;
    }
    return s;
}
`;
