// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  terrainShader.ts
 * @brief The Terrain built-in shader: four texture layers weighted by the Terrain component.
 *
 * The shader source lives with the module that installs it, not in the core's list of built-in shaders: a package that does not install the module carries none of it.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';


// The ground's vertices from its pages (pages.ts), shared by both terrain shaders: a node's patch placed and sized by its instance, its
// heights read from the atlas, and each vertex slid onto the coarser level's grid toward the end of its range.
const TERRAIN_VERTEX = `#pragma vertexoffset
// The node's page (pages.ts): its height decoded texel by texel and blended (a filtered pair of bytes is no number).
float tnPageHeight(vec2 texel) {
    vec2 f = texel - 0.5;
    ivec2 i = ivec2(floor(f));
    vec2 t = f - vec2(i);
    vec4 a = texelFetch(u_heightPages, i, 0), b = texelFetch(u_heightPages, i + ivec2(1, 0), 0);
    vec4 c = texelFetch(u_heightPages, i + ivec2(0, 1), 0), d = texelFetch(u_heightPages, i + ivec2(1, 1), 0);
    vec4 hs = vec4(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    return u_terrainOrigin.y + u_heightRange.x + mix(mix(hs.x, hs.y, t.x), mix(hs.z, hs.w, t.x), t.y) * u_heightRange.y;
}
// A node is the shared patch (0 to 1 in x and z) placed and sized by its instance: its model is its square (x and z) and its box
// (y, from its page's least height to its most), and its tint names its page (x and y, the page's corner in the atlas) and level (z).
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    if (u_terrainPages < 0.5) return;
    vec4 tint = esInstanceTint();
    mat4 model = esInstanceModel();
    float size = model[0][0], rise = max(model[1][1], 1e-6);
    vec3 corner = model[3].xyz;
    float level = floor(tint.z * 64.0 + 0.5) - 1.0;
    // The tint holds the page's corner plus half a texel (so it is never zero); its first sample is one texel in, past the border.
    vec2 page = tint.xy * u_atlasTexels + 0.5;
    // Toward the end of its level's range a vertex slides onto the grid of the level above, so where two levels meet they share an edge.
    vec2 g = uv * u_patchCells;
    float h0 = tnPageHeight(page + uv * u_pageTexels + 0.5);
    float range = u_lodRange0 * exp2(level);
    float dist = distance(u_terrainEye.xyz, vec3(corner.x + uv.x * size, h0, corner.z + uv.y * size));
    float k = clamp((dist - range * 0.7) / (range * 0.3), 0.0, 1.0);
    g -= fract(g * 0.5) * 2.0 * k;
    vec2 at = g / u_patchCells;
    vec2 texel = page + at * u_pageTexels + 0.5;
    float h = tnPageHeight(texel);
    local = vec3(at.x, (h - corner.y) / rise, at.y);
    vec2 nxz = textureLod(u_heightPages, texel / u_atlasTexels, 0.0).ba * 2.0 - 1.0;
    vec3 n = vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
    // The normal goes through the inverse transpose of the node's scale: put in what comes out as n.
    localNormal = vec3(n.x * size, n.y * rise, n.z * size);
    // The fragment reads the page where the vertex is: the colour carries it, divided by the tint it is multiplied by on the way.
    es_vertexColor = vec4(texel / u_atlasTexels, 1.0, 1.0) / tint;
}
#pragma end

#pragma vertexoffset wgsl
fn tnPageHeight(texel : vec2f) -> f32 {
    let f = texel - vec2f(0.5);
    let i = vec2i(floor(f));
    let t = f - vec2f(i);
    let a = textureLoad(u_heightPages, i, 0);
    let b = textureLoad(u_heightPages, i + vec2i(1, 0), 0);
    let c = textureLoad(u_heightPages, i + vec2i(0, 1), 0);
    let d = textureLoad(u_heightPages, i + vec2i(1, 1), 0);
    let hs = vec4f(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    return mc.u_terrainOrigin.y + mc.u_heightRange.x + mix(mix(hs.x, hs.y, t.x), mix(hs.z, hs.w, t.x), t.y) * mc.u_heightRange.y;
}
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    if (mc.u_terrainPages < 0.5) { return; }
    let tint = esInstanceTint();
    let model = esInstanceModel();
    let size = model[0][0];
    let rise = max(model[1][1], 1e-6);
    let corner = model[3].xyz;
    let level = floor(tint.z * 64.0 + 0.5) - 1.0;
    let page = tint.xy * mc.u_atlasTexels + vec2f(0.5);
    var g = uv * mc.u_patchCells;
    let h0 = tnPageHeight(page + uv * mc.u_pageTexels + vec2f(0.5));
    let range = mc.u_lodRange0 * exp2(level);
    let dist = distance(mc.u_terrainEye.xyz, vec3f(corner.x + uv.x * size, h0, corner.z + uv.y * size));
    let k = clamp((dist - range * 0.7) / (range * 0.3), 0.0, 1.0);
    g = g - fract(g * 0.5) * 2.0 * k;
    let at = g / mc.u_patchCells;
    let texel = page + at * mc.u_pageTexels + vec2f(0.5);
    let h = tnPageHeight(texel);
    *local = vec3f(at.x, (h - corner.y) / rise, at.y);
    let nxz = textureSampleLevel(u_heightPages, u_heightPages_s, texel / mc.u_atlasTexels, 0.0).ba * 2.0 - vec2f(1.0);
    let n = vec3f(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
    *localNormal = vec3f(n.x * size, n.y * rise, n.z * size);
    es_vertexColor = vec4f(texel / mc.u_atlasTexels, 1.0, 1.0) / tint;
}
#pragma end

`;

// Ground painted by four layers (grass, dirt, snow, rock), their weights read from the Terrain's paint pages (or, on a plain mesh, its
// vertex colour). Each layer is a texture laid by world position without repeat, and the rock is projected from three sides on a cliff.
const TERRAIN = `#pragma shader "Terrain"
#pragma version 300 es
#pragma domain Lit
#pragma param u_layer0 texture default(white)
#pragma param u_layer1 texture default(white)
#pragma param u_layer2 texture default(white)
#pragma param u_layer3 texture default(white)
// Each layer's colour, which multiplies its texture, and how many world units one repeat of it covers.
#pragma param u_tint0 color default(0.28,0.46,0.2,1)
#pragma param u_tint1 color default(0.45,0.36,0.24,1)
#pragma param u_tint2 color default(0.93,0.95,0.98,1)
#pragma param u_tint3 color default(0.4,0.38,0.36,1)
#pragma param u_tile0 float default(2400) range(100,80000) ui(slider) unit(length)
#pragma param u_tile1 float default(2400) range(100,80000) ui(slider) unit(length)
#pragma param u_tile2 float default(2400) range(100,80000) ui(slider) unit(length)
#pragma param u_tile3 float default(4000) range(100,80000) ui(slider) unit(length)
// How much a layer with more weight takes over from the others at the seam: 1 is a plain blend, higher a harder edge.
#pragma param u_sharpness float default(1.6) range(1,8) ui(slider)
// How much the seams follow the layers' own relief (their brightness): rock shows through the gaps in the grass before the grass gives way,
// and sand fills the low places between stones. 0 is a plain blend of the weights.
#pragma param u_heightBlend float default(0.7) range(0,1) ui(slider)
// How much each layer's weight is broken up by slow noise of its own before the strongest wins: the line where grass meets sand wanders
// instead of following the paint's smooth gradient.
#pragma param u_blendNoise float default(0.5) range(0,1) ui(slider)
// From the middle distance on, each layer is also read on a tile u_farScale times as wide and mixed in, so its repeat is lost far off.
#pragma param u_farScale float default(4.3) range(1,32) ui(slider)
// How strongly each layer is read without repeat near the eye (hex tiling: every hexagonal cell shifted and turned at random), so no tile is seen.
#pragma param u_antiTile float default(0.6) range(0,1) ui(slider)
// The wide, slow variation in brightness laid over every layer so a big meadow is not one colour.
#pragma param u_macroVariation float default(0.35) range(0,1) ui(slider)
// How deep, in world units, the layers' relief is drawn into the light (their brightness taken as height); 0 leaves the ground smooth.
#pragma param u_relief float default(5) range(0,10000000) ui(slider) unit(length)
// Ground at the water: below u_wetLevel + u_wetBand (world heights) it darkens and shines, most at the waterline. A band of 0 draws none.
#pragma param u_wetLevel float default(0) range(-100000,100000) ui(slider) unit(length)
#pragma param u_wetBand float default(0) range(0,100000) ui(slider) unit(length)
// A picture laid over the whole ground and mixed into its colour by the picture's alpha: where it lies (its corner and its size on the
// terrain's own x and z) and how much of it.
#pragma param u_colorMap texture default(white)
#pragma param u_colorMapStrength float default(0) range(0,1) ui(slider)
#pragma param u_colorMapArea vec4 default(0,0,1,1)
// How much of the sky reaches the ground, baked over the same area: its red dims the light that comes from all round (a gully, the foot
// of a cliff), and leaves the sun's own to the shadows.
#pragma param u_occlusionMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(0) range(0,1) ui(slider)
#pragma param u_roughness float default(0.92) range(0,1) ui(slider)
// The ground in pages (pages.ts; the Terrain component writes these): heights and normals, and the paint, in two atlases; heights over
// u_heightRange above u_terrainOrigin; level 0 drawn out to u_lodRange0, each level twice as far; nothing off u_terrainBounds.
// u_terrainEye is the eye the nodes were chosen for: every pass (a shadow's too) slides the vertices by it, so all draw one ground.
#pragma param u_terrainPages float default(0) range(0,1) ui(slider)
#pragma param u_heightPages texture default(white) texel(data)
#pragma param u_paintPages texture default(white) texel(data)
#pragma param u_atlasTexels float default(2048) range(1,16384) ui(slider)
#pragma param u_pageTexels float default(64) range(1,1024) ui(slider)
#pragma param u_patchCells float default(32) range(1,512) ui(slider)
#pragma param u_heightRange vec2 default(0,1)
#pragma param u_lodRange0 float default(100) range(0,1000000) ui(slider)
#pragma param u_terrainOrigin vec4 default(0,0,0,0)
#pragma param u_terrainEye vec4 default(0,0,0,0)
#pragma param u_terrainBounds vec4 default(-1000000000,-1000000000,1000000000,1000000000)

${TERRAIN_VERTEX}#pragma fragment
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
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

float tnHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float tnNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(tnHash(i), tnHash(i + vec2(1.0, 0.0)), f.x), mix(tnHash(i + vec2(0.0, 1.0)), tnHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The second reading of a layer: turned, on a tile 1.37 times as wide, offset.
vec2 tnTurned(vec2 p, float tile) { return mat2(0.8, -0.6, 0.6, 0.8) * p / (tile * 1.37) + vec2(0.37, 0.71); }
float tnLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// A layer at p on its tile, with the second turned reading mixed in by t. The gradients are the ones taken where every lane runs,
// so a layer can be read only where it is used.
vec2 tnHash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
// One reading of a layer in a hex cell: shifted and turned by the cell's own random numbers (the gradients turn with it).
vec3 tnHexTap(sampler2D layer, vec2 uv, vec2 cell, vec2 gx, vec2 gy) {
    vec2 r = tnHash2(cell);
    float a = r.x * 6.2831853;
    mat2 turn = mat2(cos(a), -sin(a), sin(a), cos(a));
    return textureGrad(layer, turn * uv + r, turn * gx, turn * gy).rgb;
}
// A layer read without repeat (hex tiling, Mikkelsen 2022): the plane is cut into hexagons, each takes the layer shifted and turned
// at random, and the three cells about a point are blended by how near it is to each, the brighter reading winning where they meet.
vec3 tnHex(sampler2D layer, vec2 uv, vec2 gx, vec2 gy, float strength) {
    vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
    vec2 base = floor(skewed);
    vec3 f = vec3(fract(skewed), 0.0);
    f.z = 1.0 - f.x - f.y;
    float s = step(0.0, -f.z), s2 = 2.0 * s - 1.0;
    vec3 w = vec3(-f.z * s2, s - f.y * s2, s - f.x * s2);
    vec3 c1 = tnHexTap(layer, uv, base + vec2(s, s), gx, gy);
    vec3 c2 = tnHexTap(layer, uv, base + vec2(s, 1.0 - s), gx, gy);
    vec3 c3 = tnHexTap(layer, uv, base + vec2(1.0 - s, s), gx, gy);
    vec3 lum = vec3(tnLuma(c1), tnLuma(c2), tnLuma(c3));
    w = pow(max(w * mix(vec3(1.0), 0.4 + lum, strength), vec3(1e-4)), vec3(7.0));
    w /= dot(w, vec3(1.0));
    return c1 * w.x + c2 * w.y + c3 * w.z;
}
vec3 tnRead(sampler2D layer, vec2 p, float tile, float t, float far, vec2 gx, vec2 gy) {
    vec3 c = t > 0.01 ? tnHex(layer, p / tile, gx / tile, gy / tile, t) : textureGrad(layer, p / tile, gx / tile, gy / tile).rgb;
    if (far > 0.01) {
        float big = tile * u_farScale;
        c = mix(c, textureGrad(layer, p / big + 0.21, gx / big, gy / big).rgb, far);
    }
    return c;
}

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 N = normalize(v_worldNormal);
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
    highp vec3 N = vec3(0.0, 1.0, 0.0);
#endif
    // Where the ground is in the world, for what is laid on it by position (the layers' tiles, the noise, the bounds): the draw's own P is from the render origin.
    highp vec3 Pw = P + u_renderOrigin.xyz;
    // A paged ground reads its paint and its normal where the vertex said it lies in the page, filtered; off its area there is none.
    vec4 paint = v_color;
    if (u_terrainPages > 0.5) {
        vec2 lp = Pw.xz - u_terrainOrigin.xz;
        if (lp.x < u_terrainBounds.x || lp.y < u_terrainBounds.y || lp.x > u_terrainBounds.z || lp.y > u_terrainBounds.w) discard;
        paint = texture(u_paintPages, v_color.xy);
        vec2 nxz = texture(u_heightPages, v_color.xy).ba * 2.0 - 1.0;
        N = normalize(vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y));
    }
    vec4 w = max(paint, vec4(0.0));
    w /= max(dot(w, vec4(1.0)), 1e-4);
    // Each layer's say wanders by slow noise of its own, so where two meet the edge is ragged, not the paint's gradient.
    vec4 wander = vec4(tnNoise(Pw.xz / (u_tile0 * 2.3) + 3.0), tnNoise(Pw.xz / (u_tile1 * 2.3) + 11.0),
                       tnNoise(Pw.xz / (u_tile2 * 2.3) + 23.0), tnNoise(Pw.xz / (u_tile3 * 2.3) + 37.0));
    w *= mix(vec4(1.0), 0.35 + 1.3 * wander, u_blendNoise);
    w /= max(dot(w, vec4(1.0)), 1e-4);
    // The strongest layer wins its seam more cleanly the higher the sharpness.
    w = pow(w, vec4(u_sharpness));
    w /= max(dot(w, vec4(1.0)), 1e-4);

    // Only the layers the ground has are read, from gradients taken here, where every lane runs. Near the eye each is read a second time
    // and blended by slow noise of its own tile's scale, so no repeat is seen; far off, where a repeat is too small to see, it is not.
    vec3 dpx = dFdx(P), dpy = dFdy(P);
    float eye = u_camera.w > 0.5 ? length(P - u_camera.xyz) : 0.0;
    float near = (1.0 - smoothstep(u_tile0 * 20.0, u_tile0 * 45.0, eye)) * u_antiTile;
    float far = smoothstep(u_tile0 * 6.0, u_tile0 * 40.0, eye) * 0.65;
    vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
    if (w.x > 1e-3) s0 = tnRead(u_layer0, Pw.xz, u_tile0, near, far, dpx.xz, dpy.xz);
    if (w.y > 1e-3) s1 = tnRead(u_layer1, Pw.xz, u_tile1, near, far, dpx.xz, dpy.xz);
    if (w.z > 1e-3) s2 = tnRead(u_layer2, Pw.xz, u_tile2, near, far, dpx.xz, dpy.xz);
    if (w.w > 1e-3) {
        // Rock is seen from three sides, in proportion to how the ground faces them, so a sheer face is not stretched; a side that
        // carries almost none of it is not read.
        vec3 axis = pow(abs(N), vec3(4.0));
        axis /= dot(axis, vec3(1.0));
        s3 = tnRead(u_layer3, Pw.xz, u_tile3, near, far, dpx.xz, dpy.xz) * axis.y;
        if (axis.x > 0.02) s3 += textureGrad(u_layer3, Pw.zy / u_tile3, dpx.zy / u_tile3, dpy.zy / u_tile3).rgb * axis.x;
        if (axis.z > 0.02) s3 += textureGrad(u_layer3, Pw.xy / u_tile3, dpx.xy / u_tile3, dpy.xy / u_tile3).rgb * axis.z;
    }
    // Then by relief: each layer stands as high as it is bright, and where two meet the higher one shows.
    vec4 heights = vec4(tnLuma(s0), tnLuma(s1), tnLuma(s2), tnLuma(s3));
    vec4 stand = heights + w * 1.5;
    float top = max(max(stand.x, stand.y), max(stand.z, stand.w)) - 0.35;
    vec4 hw = max(stand - top, vec4(0.0)) * step(vec4(1e-3), w);
    hw /= max(dot(hw, vec4(1.0)), 1e-4);
    w = mix(w, hw, u_heightBlend);

    vec3 albedo = s0 * u_tint0.rgb * w.x + s1 * u_tint1.rgb * w.y + s2 * u_tint2.rgb * w.z + s3 * u_tint3.rgb * w.w;
    float broad = tnNoise(Pw.xz / (u_tile0 * 7.3)) * 0.6 + tnNoise(Pw.xz / (u_tile0 * 29.0) + 5.0) * 0.4;
    albedo *= mix(1.0, 0.7 + 0.6 * broad, u_macroVariation);

    // The relief, as a bump from the screen-space change of its height, faded out before it is finer than a pixel.
    float relief = dot(heights, w) * u_relief;
    float dhx = dFdx(relief), dhy = dFdy(relief);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 surfGrad = sign(det) * (dhx * r1 + dhy * r2);
    float fine = 1.0 - smoothstep(0.02, 0.2, length(dpx) / max(u_tile0, 1e-4));
    vec3 Nb = normalize(abs(det) * N - surfGrad * fine);
    // Not on a face that stands upright: a bump drawn there from the ground's derivatives lights it as a bright streak.
    bool upright = abs(normalize(cross(dpx, dpy)).y) > 0.5;
    if (abs(det) > 1e-12 && u_relief > 0.0 && upright) N = Nb;

    if (u_colorMapStrength > 0.0) {
        vec2 over = (Pw.xz - u_terrainOrigin.xz - u_colorMapArea.xy) / max(u_colorMapArea.zw, vec2(1e-4));
        vec4 wash = texture(u_colorMap, over);
        bool on = all(greaterThanEqual(over, vec2(0.0))) && all(lessThanEqual(over, vec2(1.0)));
        albedo = mix(albedo, wash.rgb, on ? wash.a * u_colorMapStrength : 0.0);
    }
    // Wet at the water: darker, and smooth enough to shine.
    float wet = u_wetBand > 0.0 ? 1.0 - smoothstep(u_wetLevel, u_wetLevel + u_wetBand, P.y) : 0.0;
    albedo *= mix(1.0, 0.55, wet);
    float roughness = mix(u_roughness, 0.3, wet);

    SurfaceExt ext = surfaceExtNone(N);
    vec3 viewDir = viewDirection(P);
    float open = 1.0;
    if (u_occlusionStrength > 0.0) {
        vec2 under = (Pw.xz - u_terrainOrigin.xz - u_colorMapArea.xy) / max(u_colorMapArea.zw, vec2(1e-4));
        if (all(greaterThanEqual(under, vec2(0.0))) && all(lessThanEqual(under, vec2(1.0)))) open = mix(1.0, textureLod(u_occlusionMap, under, 0.0).r, u_occlusionStrength);
    }
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 0.5, open, ext);
    fragColor = vec4(lit, 1.0);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(N), roughness, 0.75);
    fragAlbedo = vec4(albedo, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
fn tnHash(p0 : vec2f) -> f32 {
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
fn tnTurned(p : vec2f, tile : f32) -> vec2f { return mat2x2f(0.8, -0.6, 0.6, 0.8) * p / (tile * 1.37) + vec2f(0.37, 0.71); }
fn tnLuma(c : vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
fn tnHash2(p : vec2f) -> vec2f {
    return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
}
fn tnHexTap(layer : texture_2d<f32>, smp : sampler, uv : vec2f, cell : vec2f, gx : vec2f, gy : vec2f) -> vec3f {
    let r = tnHash2(cell);
    let a = r.x * 6.2831853;
    let turn = mat2x2f(cos(a), -sin(a), sin(a), cos(a));
    return textureSampleGrad(layer, smp, turn * uv + r, turn * gx, turn * gy).rgb;
}
fn tnHex(layer : texture_2d<f32>, smp : sampler, uv : vec2f, gx : vec2f, gy : vec2f, strength : f32) -> vec3f {
    let skewed = mat2x2f(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
    let base = floor(skewed);
    let fr = fract(skewed);
    let fz = 1.0 - fr.x - fr.y;
    let s = step(0.0, -fz);
    let s2 = 2.0 * s - 1.0;
    var w = vec3f(-fz * s2, s - fr.y * s2, s - fr.x * s2);
    let c1 = tnHexTap(layer, smp, uv, base + vec2f(s, s), gx, gy);
    let c2 = tnHexTap(layer, smp, uv, base + vec2f(s, 1.0 - s), gx, gy);
    let c3 = tnHexTap(layer, smp, uv, base + vec2f(1.0 - s, s), gx, gy);
    let lum = vec3f(tnLuma(c1), tnLuma(c2), tnLuma(c3));
    w = pow(max(w * mix(vec3f(1.0), vec3f(0.4) + lum, vec3f(strength)), vec3f(1e-4)), vec3f(7.0));
    w = w / dot(w, vec3f(1.0));
    return c1 * w.x + c2 * w.y + c3 * w.z;
}
fn tnRead(layer : texture_2d<f32>, smp : sampler, p : vec2f, tile : f32, t : f32, far : f32, gx : vec2f, gy : vec2f) -> vec3f {
    var c = vec3f(0.0);
    if (t > 0.01) { c = tnHex(layer, smp, p / tile, gx / tile, gy / tile, t); }
    else { c = textureSampleGrad(layer, smp, p / tile, gx / tile, gy / tile).rgb; }
    if (far > 0.01) {
        let big = tile * mc.u_farScale;
        c = mix(c, textureSampleGrad(layer, smp, p / big + vec2f(0.21), gx / big, gy / big).rgb, vec3f(far));
    }
    return c;
}

#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
    @location(2) albedo : vec4f,
};

fn packNormal(n : vec3f) -> vec2f {
    let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
    let sgn = vec2f(select(-1.0, 1.0, a.x >= 0.0), select(-1.0, 1.0, a.y >= 0.0));
    var e = a.xy;
    if (a.z < 0.0) { e = (vec2f(1.0) - abs(a.yx)) * sgn; }
    return e * 0.5 + 0.5;
}

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
    let Pw = P + frame.renderOrigin.xyz;
    let pagePaint = textureSample(u_paintPages, u_paintPages_s, v.v_color.xy);
    let pageNormal = textureSample(u_heightPages, u_heightPages_s, v.v_color.xy).ba * 2.0 - vec2f(1.0);
    var paint = v.v_color;
    if (mc.u_terrainPages > 0.5) {
        let lp = Pw.xz - mc.u_terrainOrigin.xz;
        if (lp.x < mc.u_terrainBounds.x || lp.y < mc.u_terrainBounds.y || lp.x > mc.u_terrainBounds.z || lp.y > mc.u_terrainBounds.w) { discard; }
        paint = pagePaint;
        N = normalize(vec3f(pageNormal.x, sqrt(max(1.0 - dot(pageNormal, pageNormal), 0.0)), pageNormal.y));
    }
    var w = max(paint, vec4f(0.0));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);
    let wander = vec4f(tnNoise(Pw.xz / (mc.u_tile0 * 2.3) + 3.0), tnNoise(Pw.xz / (mc.u_tile1 * 2.3) + 11.0),
                       tnNoise(Pw.xz / (mc.u_tile2 * 2.3) + 23.0), tnNoise(Pw.xz / (mc.u_tile3 * 2.3) + 37.0));
    w = w * mix(vec4f(1.0), vec4f(0.35) + 1.3 * wander, vec4f(mc.u_blendNoise));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);
    w = pow(w, vec4f(mc.u_sharpness));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);

    // Derivatives taken here, in uniform control flow; the layers are read only where the ground has them.
    let dpx = dpdx(P);
    let dpy = dpdy(P);
    var eye = 0.0;
    if (frame.camera.w > 0.5) { eye = length(P - frame.camera.xyz); }
    let near = (1.0 - smoothstep(mc.u_tile0 * 20.0, mc.u_tile0 * 45.0, eye)) * mc.u_antiTile;
    let far = smoothstep(mc.u_tile0 * 6.0, mc.u_tile0 * 40.0, eye) * 0.65;
    var s0 = vec3f(0.0);
    var s1 = vec3f(0.0);
    var s2 = vec3f(0.0);
    var s3 = vec3f(0.0);
    if (w.x > 1e-3) { s0 = tnRead(u_layer0, u_layer0_s, Pw.xz, mc.u_tile0, near, far, dpx.xz, dpy.xz); }
    if (w.y > 1e-3) { s1 = tnRead(u_layer1, u_layer1_s, Pw.xz, mc.u_tile1, near, far, dpx.xz, dpy.xz); }
    if (w.z > 1e-3) { s2 = tnRead(u_layer2, u_layer2_s, Pw.xz, mc.u_tile2, near, far, dpx.xz, dpy.xz); }
    if (w.w > 1e-3) {
        var axis = pow(abs(N), vec3f(4.0));
        axis = axis / dot(axis, vec3f(1.0));
        s3 = tnRead(u_layer3, u_layer3_s, Pw.xz, mc.u_tile3, near, far, dpx.xz, dpy.xz) * axis.y;
        if (axis.x > 0.02) { s3 = s3 + textureSampleGrad(u_layer3, u_layer3_s, Pw.zy / mc.u_tile3, dpx.zy / mc.u_tile3, dpy.zy / mc.u_tile3).rgb * axis.x; }
        if (axis.z > 0.02) { s3 = s3 + textureSampleGrad(u_layer3, u_layer3_s, Pw.xy / mc.u_tile3, dpx.xy / mc.u_tile3, dpy.xy / mc.u_tile3).rgb * axis.z; }
    }
    let heights = vec4f(tnLuma(s0), tnLuma(s1), tnLuma(s2), tnLuma(s3));
    let stand = heights + w * 1.5;
    let top = max(max(stand.x, stand.y), max(stand.z, stand.w)) - 0.35;
    var hw = max(stand - vec4f(top), vec4f(0.0)) * step(vec4f(1e-3), w);
    hw = hw / max(dot(hw, vec4f(1.0)), 1e-4);
    w = mix(w, hw, vec4f(mc.u_heightBlend));

    var albedo = s0 * mc.u_tint0.rgb * w.x + s1 * mc.u_tint1.rgb * w.y + s2 * mc.u_tint2.rgb * w.z + s3 * mc.u_tint3.rgb * w.w;
    let broad = tnNoise(Pw.xz / (mc.u_tile0 * 7.3)) * 0.6 + tnNoise(Pw.xz / (mc.u_tile0 * 29.0) + 5.0) * 0.4;
    albedo = albedo * mix(1.0, 0.7 + 0.6 * broad, mc.u_macroVariation);

    let relief = dot(heights, w) * mc.u_relief;
    let dhx = dpdx(relief);
    let dhy = dpdy(relief);
    let r1 = cross(dpy, N);
    let r2 = cross(N, dpx);
    let det = dot(dpx, r1);
    let surfGrad = sign(det) * (dhx * r1 + dhy * r2);
    let fine = 1.0 - smoothstep(0.02, 0.2, length(dpx) / max(mc.u_tile0, 1e-4));
    let Nb = normalize(abs(det) * N - surfGrad * fine);
    var Ns = N;
    let upright = abs(normalize(cross(dpx, dpy)).y) > 0.5;
    if (abs(det) > 1e-12 && mc.u_relief > 0.0 && upright) { Ns = Nb; }

    if (mc.u_colorMapStrength > 0.0) {
        let over = (Pw.xz - mc.u_terrainOrigin.xz - mc.u_colorMapArea.xy) / max(mc.u_colorMapArea.zw, vec2f(1e-4));
        let wash = textureSampleLevel(u_colorMap, u_colorMap_s, over, 0.0);
        if (all(over >= vec2f(0.0)) && all(over <= vec2f(1.0))) { albedo = mix(albedo, wash.rgb, vec3f(wash.a * mc.u_colorMapStrength)); }
    }
    var wet = 0.0;
    if (mc.u_wetBand > 0.0) { wet = 1.0 - smoothstep(mc.u_wetLevel, mc.u_wetLevel + mc.u_wetBand, P.y); }
    albedo = albedo * mix(1.0, 0.55, wet);
    let roughness = mix(mc.u_roughness, 0.3, wet);

    let ext = surfaceExtNone(Ns);
    let viewDir = viewDirection(P);
    var open = 1.0;
    if (mc.u_occlusionStrength > 0.0) {
        let under = (Pw.xz - mc.u_terrainOrigin.xz - mc.u_colorMapArea.xy) / max(mc.u_colorMapArea.zw, vec2f(1e-4));
        if (all(under >= vec2f(0.0)) && all(under <= vec2f(1.0))) { open = mix(1.0, textureSampleLevel(u_occlusionMap, u_occlusionMap_s, under, 0.0).r, mc.u_occlusionStrength); }
    }
    let lit = applyLightingSurface(albedo, Ns, P, viewDir, 0.0, roughness, 0.5, open, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, 1.0);
    frag.surface = vec4f(packNormal(Ns), roughness, 0.75);
    frag.albedo = vec4f(albedo, 1.0);
    return frag;
#else
    return vec4f(lit, 1.0);
#endif
}
#pragma end
`;

export const TERRAIN_SHADER_TEMPLATE = makeBuiltinShaderTemplate('terrain', 'Terrain',
    'Four texture layers (grass, dirt, snow, rock) weighted by the Terrain component, tiled by world position.', TERRAIN);

// Ground painted by up to eight layers (layers.ts), each an albedo, a normal map and a mask (occlusion, roughness, height) in three
// texture arrays, their weights read from the Terrain's two paint atlases. Where layers meet the higher one shows; near the eye each is
// read without repeat; on a slope it is projected from the sides as well, so a cliff is not stretched.
const TERRAIN_LAYERS = `#pragma shader "Terrain Layers"
#pragma version 300 es
#pragma domain Lit
#pragma param u_albedoLayers textureArray default(white)
#pragma param u_normalLayers textureArray default(white) texel(data)
#pragma param u_maskLayers textureArray default(white) texel(data)
// How many layers there are, and how many world units one repeat of each covers (layers 1 to 4, then 5 to 8).
#pragma param u_layerCount float default(0) range(0,8) ui(slider)
#pragma param u_tiles0 vec4 default(4,4,4,4)
#pragma param u_tiles1 vec4 default(4,4,4,4)
// Each layer's own height blend (below zero: the material's u_heightBlend), written by the Terrain from the layer files.
#pragma param u_heightBlends0 vec4 default(-1,-1,-1,-1)
#pragma param u_heightBlends1 vec4 default(-1,-1,-1,-1)
// How much a layer with more weight takes over from the others at the seam: 1 is a plain blend, higher a harder edge.
#pragma param u_sharpness float default(1.6) range(1,8) ui(slider)
// How much the seams follow the layers' heights (their masks' blue): rock shows through the gaps in the grass before the grass gives
// way, and sand fills the low places between stones. 0 is a plain blend of the weights.
#pragma param u_heightBlend float default(0.8) range(0,1) ui(slider)
// How much each layer's weight is broken up by slow noise of its own before the strongest wins.
#pragma param u_blendNoise float default(0.5) range(0,1) ui(slider)
// From the middle distance on, each layer is also read on a tile u_farScale times as wide and mixed in, so its repeat is lost far off.
#pragma param u_farScale float default(4.3) range(1,32) ui(slider)
// How strongly each layer is read without repeat near the eye (hex tiling), so no tile is seen.
#pragma param u_antiTile float default(0.6) range(0,1) ui(slider)
// The wide, slow variation in brightness laid over every layer so a big meadow is not one colour.
#pragma param u_macroVariation float default(0.25) range(0,1) ui(slider)
// How steep the ground must be (1 minus its normal's up) before the layers are also projected from the sides.
#pragma param u_triplanarFrom float default(0.15) range(0,1) ui(slider)
// Ground at the water: below u_wetLevel + u_wetBand (world heights) it darkens and shines, most at the waterline. A band of 0 draws none.
#pragma param u_wetLevel float default(0) range(-100000,100000) ui(slider) unit(length)
#pragma param u_wetBand float default(0) range(0,100000) ui(slider) unit(length)
// A picture laid over the whole ground and mixed into its colour by the picture's alpha: where it lies (its corner and its size on the
// terrain's own x and z) and how much of it.
#pragma param u_colorMap texture default(white)
#pragma param u_colorMapStrength float default(0) range(0,1) ui(slider)
#pragma param u_colorMapArea vec4 default(0,0,1,1)
// How much of the sky reaches the ground, baked over the same area: its red dims the light that comes from all round (a gully, the foot
// of a cliff), and leaves the sun's own to the shadows.
#pragma param u_occlusionMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(0) range(0,1) ui(slider)
// The ground in pages, as the Terrain shader has them, with the paint of layers 5 to 8 in an atlas of its own.
#pragma param u_terrainPages float default(0) range(0,1) ui(slider)
#pragma param u_heightPages texture default(white) texel(data)
#pragma param u_paintPages texture default(white) texel(data)
#pragma param u_paintPages2 texture default(black) texel(data)
#pragma param u_atlasTexels float default(2048) range(1,16384) ui(slider)
#pragma param u_pageTexels float default(64) range(1,1024) ui(slider)
#pragma param u_patchCells float default(32) range(1,512) ui(slider)
#pragma param u_heightRange vec2 default(0,1)
#pragma param u_lodRange0 float default(100) range(0,1000000) ui(slider)
#pragma param u_terrainOrigin vec4 default(0,0,0,0)
#pragma param u_terrainEye vec4 default(0,0,0,0)
#pragma param u_terrainBounds vec4 default(-1000000000,-1000000000,1000000000,1000000000)

${TERRAIN_VERTEX}#pragma fragment
precision highp float;
precision highp sampler2DArray;

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
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

float tnHash(vec2 p) {
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
    float a = r.x * 6.2831853;
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

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 N = normalize(v_worldNormal);
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
    highp vec3 N = vec3(0.0, 1.0, 0.0);
#endif
    // Where the ground is in the world, for what is laid on it by position (the layers' tiles, the noise, the bounds): the draw's own P is from the render origin.
    highp vec3 Pw = P + u_renderOrigin.xyz;
    vec4 paintA = v_color, paintB = vec4(0.0);
    if (u_terrainPages > 0.5) {
        vec2 lp = Pw.xz - u_terrainOrigin.xz;
        if (lp.x < u_terrainBounds.x || lp.y < u_terrainBounds.y || lp.x > u_terrainBounds.z || lp.y > u_terrainBounds.w) discard;
        paintA = texture(u_paintPages, v_color.xy);
        paintB = texture(u_paintPages2, v_color.xy);
        vec2 nxz = texture(u_heightPages, v_color.xy).ba * 2.0 - 1.0;
        N = normalize(vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y));
    }
    int count = int(u_layerCount + 0.5);
    float w[8];
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
        float raw = i < 4 ? paintA[i] : paintB[i - 4];
        // Each layer's say wanders by noise of its own, so where two meet the edge is ragged, not the paint's gradient. Three octaves: the slow one
        // moves where the edge runs, the two finer break it up at the size of a paint texel and below, where a sharpened bilinear paint
        // would otherwise follow the texel grid in steps.
        float tileSize = tnTile(i);
        float wander = tnNoise(Pw.xz / (tileSize * 2.3) + float(i) * 11.0 + 3.0) * 0.5
                     + tnNoise(Pw.xz / (tileSize * 0.45) + float(i) * 7.0 + 17.0) * 0.3
                     + tnNoise(Pw.xz / (tileSize * 0.11) + float(i) * 5.0 + 29.0) * 0.2;
        w[i] = i < count ? max(raw, 0.0) * mix(1.0, 0.35 + 1.3 * wander, u_blendNoise) : 0.0;
        sum += w[i];
    }
    float sharp = 0.0;
    for (int i = 0; i < 8; i++) { w[i] = pow(w[i] / max(sum, 1e-4), u_sharpness); sharp += w[i]; }
    for (int i = 0; i < 8; i++) w[i] /= max(sharp, 1e-4);

    // Gradients taken here, where every lane runs. Near the eye a layer is read without repeat, far off a wider tile is mixed in.
    vec3 dpx = dFdx(P), dpy = dFdy(P);
    float eye = u_camera.w > 0.5 ? length(P - u_camera.xyz) : 0.0;
    float scale = tnTile(0);
    float near = (1.0 - smoothstep(scale * 20.0, scale * 45.0, eye)) * u_antiTile;
    float far = smoothstep(scale * 6.0, scale * 40.0, eye) * 0.65;
    // How much of each plane a slope is seen from: the top alone on gentle ground, the sides too from u_triplanarFrom.
    vec3 axis = pow(abs(N), vec3(4.0));
    axis /= dot(axis, vec3(1.0));
    float side = smoothstep(u_triplanarFrom, u_triplanarFrom + 0.15, 1.0 - abs(N.y));
    vec3 planes = mix(vec3(0.0, 1.0, 0.0), axis, side);

    vec3 albedo[8];
    vec3 bend[8];
    vec3 mask[8];
    for (int i = 0; i < 8; i++) {
        albedo[i] = vec3(0.0); bend[i] = vec3(0.0); mask[i] = vec3(1.0, 1.0, 0.0);
        if (w[i] <= 1e-3) continue;
        float layer = float(i), tile = tnTile(i);
        // WebGL takes no ?: between structures.
        TnTap top;
        if (near > 0.01) top = tnHex(Pw.xz / tile, layer, dpx.xz / tile, dpy.xz / tile, near);
        else top = tnPlain(Pw.xz / tile, layer, dpx.xz / tile, dpy.xz / tile);
        if (far > 0.01) {
            float big = tile * u_farScale;
            TnTap wide = tnPlain(Pw.xz / big + 0.21, layer, dpx.xz / big, dpy.xz / big);
            top.albedo = mix(top.albedo, wide.albedo, far);
            top.mask = mix(top.mask, wide.mask, far);
        }
        albedo[i] = top.albedo * planes.y;
        mask[i] = top.mask * planes.y;
        bend[i] = tnBend(top.slope, vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), N) * planes.y;
        if (planes.x > 0.02) {
            TnTap x = tnPlain(Pw.zy / tile, layer, dpx.zy / tile, dpy.zy / tile);
            albedo[i] += x.albedo * planes.x; mask[i] += x.mask * planes.x;
            bend[i] += tnBend(x.slope, vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), N) * planes.x;
        }
        if (planes.z > 0.02) {
            TnTap z = tnPlain(Pw.xy / tile, layer, dpx.xy / tile, dpy.xy / tile);
            albedo[i] += z.albedo * planes.z; mask[i] += z.mask * planes.z;
            bend[i] += tnBend(z.slope, vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), N) * planes.z;
        }
    }
    // Then by height: each layer stands as high as its mask says, and where two meet the higher one shows.
    float top = -1.0;
    for (int i = 0; i < 8; i++) if (w[i] > 1e-3) top = max(top, mask[i].b + w[i] * 1.5);
    float hsum = 0.0;
    float hw[8];
    for (int i = 0; i < 8; i++) { hw[i] = w[i] > 1e-3 ? max(mask[i].b + w[i] * 1.5 - (top - 0.35), 0.0) : 0.0; hsum += hw[i]; }
    // How much height decides here: each layer's own say, weighted by how much of that layer is here, so grass into sand blends by the paint and stones
    // standing through grass by their heights, with no one number for the whole ground.
    float byHeight = 0.0;
    for (int i = 0; i < 8; i++) byHeight += w[i] * tnHeightBlend(i);
    vec3 colour = vec3(0.0), slope = vec3(0.0), surface = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float k = mix(w[i], hw[i] / max(hsum, 1e-4), byHeight);
        colour += albedo[i] * k; slope += bend[i] * k; surface += mask[i] * k;
    }
    float broad = tnNoise(Pw.xz / (scale * 7.3)) * 0.6 + tnNoise(Pw.xz / (scale * 29.0) + 5.0) * 0.4;
    colour *= mix(1.0, 0.7 + 0.6 * broad, u_macroVariation);
    N = normalize(N + slope);

    if (u_colorMapStrength > 0.0) {
        vec2 over = (Pw.xz - u_terrainOrigin.xz - u_colorMapArea.xy) / max(u_colorMapArea.zw, vec2(1e-4));
        vec4 wash = texture(u_colorMap, over);
        bool on = all(greaterThanEqual(over, vec2(0.0))) && all(lessThanEqual(over, vec2(1.0)));
        colour = mix(colour, wash.rgb, on ? wash.a * u_colorMapStrength : 0.0);
    }
    // Wet at the water: darker, and smooth enough to shine.
    float wet = u_wetBand > 0.0 ? 1.0 - smoothstep(u_wetLevel, u_wetLevel + u_wetBand, P.y) : 0.0;
    colour *= mix(1.0, 0.55, wet);
    float roughness = mix(surface.g, 0.3, wet);

    SurfaceExt ext = surfaceExtNone(N);
    vec3 viewDir = viewDirection(P);
    float open = 1.0;
    if (u_occlusionStrength > 0.0) {
        vec2 under = (Pw.xz - u_terrainOrigin.xz - u_colorMapArea.xy) / max(u_colorMapArea.zw, vec2(1e-4));
        if (all(greaterThanEqual(under, vec2(0.0))) && all(lessThanEqual(under, vec2(1.0)))) open = mix(1.0, textureLod(u_occlusionMap, under, 0.0).r, u_occlusionStrength);
    }
    vec3 lit = applyLightingSurface(colour, N, P, viewDir, 0.0, roughness, 0.5, surface.r * open, ext);
    fragColor = vec4(lit, 1.0);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(N), roughness, 0.75);
    fragAlbedo = vec4(colour, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
fn tnHash(p0 : vec2f) -> f32 {
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
    let a = r.x * 6.2831853;
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

#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
    @location(2) albedo : vec4f,
};

fn packNormal(n : vec3f) -> vec2f {
    let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
    let sgn = vec2f(select(-1.0, 1.0, a.x >= 0.0), select(-1.0, 1.0, a.y >= 0.0));
    var e = a.xy;
    if (a.z < 0.0) { e = (vec2f(1.0) - abs(a.yx)) * sgn; }
    return e * 0.5 + 0.5;
}

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
    let Pw = P + frame.renderOrigin.xyz;
    let pageA = textureSample(u_paintPages, u_paintPages_s, v.v_color.xy);
    let pageB = textureSample(u_paintPages2, u_paintPages2_s, v.v_color.xy);
    let pageNormal = textureSample(u_heightPages, u_heightPages_s, v.v_color.xy).ba * 2.0 - vec2f(1.0);
    var paintA = v.v_color;
    var paintB = vec4f(0.0);
    if (mc.u_terrainPages > 0.5) {
        let lp = Pw.xz - mc.u_terrainOrigin.xz;
        if (lp.x < mc.u_terrainBounds.x || lp.y < mc.u_terrainBounds.y || lp.x > mc.u_terrainBounds.z || lp.y > mc.u_terrainBounds.w) { discard; }
        paintA = pageA;
        paintB = pageB;
        N = normalize(vec3f(pageNormal.x, sqrt(max(1.0 - dot(pageNormal, pageNormal), 0.0)), pageNormal.y));
    }
    let count = i32(mc.u_layerCount + 0.5);
    var w : array<f32, 8>;
    var sum = 0.0;
    for (var i = 0; i < 8; i = i + 1) {
        var raw = 0.0;
        if (i < 4) { raw = paintA[i]; } else { raw = paintB[i - 4]; }
        // Three octaves: the slow one moves where the edge runs, the two finer break it up at the size of a paint texel and below.
        let tileSize = tnTile(i);
        let wander = tnNoise(Pw.xz / (tileSize * 2.3) + vec2f(f32(i) * 11.0 + 3.0)) * 0.5
                   + tnNoise(Pw.xz / (tileSize * 0.45) + vec2f(f32(i) * 7.0 + 17.0)) * 0.3
                   + tnNoise(Pw.xz / (tileSize * 0.11) + vec2f(f32(i) * 5.0 + 29.0)) * 0.2;
        w[i] = 0.0;
        if (i < count) { w[i] = max(raw, 0.0) * mix(1.0, 0.35 + 1.3 * wander, mc.u_blendNoise); }
        sum = sum + w[i];
    }
    var sharp = 0.0;
    for (var i = 0; i < 8; i = i + 1) { w[i] = pow(w[i] / max(sum, 1e-4), mc.u_sharpness); sharp = sharp + w[i]; }
    for (var i = 0; i < 8; i = i + 1) { w[i] = w[i] / max(sharp, 1e-4); }

    let dpx = dpdx(P);
    let dpy = dpdy(P);
    var eye = 0.0;
    if (frame.camera.w > 0.5) { eye = length(P - frame.camera.xyz); }
    let scale = tnTile(0);
    let near = (1.0 - smoothstep(scale * 20.0, scale * 45.0, eye)) * mc.u_antiTile;
    let far = smoothstep(scale * 6.0, scale * 40.0, eye) * 0.65;
    var axis = pow(abs(N), vec3f(4.0));
    axis = axis / dot(axis, vec3f(1.0));
    let side = smoothstep(mc.u_triplanarFrom, mc.u_triplanarFrom + 0.15, 1.0 - abs(N.y));
    let planes = mix(vec3f(0.0, 1.0, 0.0), axis, vec3f(side));

    var albedo : array<vec3f, 8>;
    var bend : array<vec3f, 8>;
    var mask : array<vec3f, 8>;
    for (var i = 0; i < 8; i = i + 1) {
        albedo[i] = vec3f(0.0);
        bend[i] = vec3f(0.0);
        mask[i] = vec3f(1.0, 1.0, 0.0);
        if (w[i] <= 1e-3) { continue; }
        let tile = tnTile(i);
        var top : TnTap;
        if (near > 0.01) { top = tnHex(Pw.xz / tile, i, dpx.xz / tile, dpy.xz / tile, near); }
        else { top = tnPlain(Pw.xz / tile, i, dpx.xz / tile, dpy.xz / tile); }
        if (far > 0.01) {
            let big = tile * mc.u_farScale;
            let wide = tnPlain(Pw.xz / big + vec2f(0.21), i, dpx.xz / big, dpy.xz / big);
            top.albedo = mix(top.albedo, wide.albedo, vec3f(far));
            top.mask = mix(top.mask, wide.mask, vec3f(far));
        }
        albedo[i] = top.albedo * planes.y;
        mask[i] = top.mask * planes.y;
        bend[i] = tnBend(top.slope, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), N) * planes.y;
        if (planes.x > 0.02) {
            let x = tnPlain(Pw.zy / tile, i, dpx.zy / tile, dpy.zy / tile);
            albedo[i] = albedo[i] + x.albedo * planes.x;
            mask[i] = mask[i] + x.mask * planes.x;
            bend[i] = bend[i] + tnBend(x.slope, vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), N) * planes.x;
        }
        if (planes.z > 0.02) {
            let z = tnPlain(Pw.xy / tile, i, dpx.xy / tile, dpy.xy / tile);
            albedo[i] = albedo[i] + z.albedo * planes.z;
            mask[i] = mask[i] + z.mask * planes.z;
            bend[i] = bend[i] + tnBend(z.slope, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), N) * planes.z;
        }
    }
    var top = -1.0;
    for (var i = 0; i < 8; i = i + 1) { if (w[i] > 1e-3) { top = max(top, mask[i].b + w[i] * 1.5); } }
    var hsum = 0.0;
    var hw : array<f32, 8>;
    for (var i = 0; i < 8; i = i + 1) {
        hw[i] = 0.0;
        if (w[i] > 1e-3) { hw[i] = max(mask[i].b + w[i] * 1.5 - (top - 0.35), 0.0); }
        hsum = hsum + hw[i];
    }
    // How much height decides here: each layer's own say, weighted by how much of that layer is here.
    var byHeight = 0.0;
    for (var i = 0; i < 8; i = i + 1) { byHeight = byHeight + w[i] * tnHeightBlend(i); }
    var colour = vec3f(0.0);
    var slope = vec3f(0.0);
    var surface = vec3f(0.0);
    for (var i = 0; i < 8; i = i + 1) {
        let k = mix(w[i], hw[i] / max(hsum, 1e-4), byHeight);
        colour = colour + albedo[i] * k;
        slope = slope + bend[i] * k;
        surface = surface + mask[i] * k;
    }
    let broad = tnNoise(Pw.xz / (scale * 7.3)) * 0.6 + tnNoise(Pw.xz / (scale * 29.0) + vec2f(5.0)) * 0.4;
    colour = colour * mix(1.0, 0.7 + 0.6 * broad, mc.u_macroVariation);
    N = normalize(N + slope);

    if (mc.u_colorMapStrength > 0.0) {
        let over = (Pw.xz - mc.u_terrainOrigin.xz - mc.u_colorMapArea.xy) / max(mc.u_colorMapArea.zw, vec2f(1e-4));
        let wash = textureSampleLevel(u_colorMap, u_colorMap_s, over, 0.0);
        if (all(over >= vec2f(0.0)) && all(over <= vec2f(1.0))) { colour = mix(colour, wash.rgb, vec3f(wash.a * mc.u_colorMapStrength)); }
    }
    var wet = 0.0;
    if (mc.u_wetBand > 0.0) { wet = 1.0 - smoothstep(mc.u_wetLevel, mc.u_wetLevel + mc.u_wetBand, P.y); }
    colour = colour * mix(1.0, 0.55, wet);
    let roughness = mix(surface.g, 0.3, wet);

    let ext = surfaceExtNone(N);
    let viewDir = viewDirection(P);
    var open = 1.0;
    if (mc.u_occlusionStrength > 0.0) {
        let under = (Pw.xz - mc.u_terrainOrigin.xz - mc.u_colorMapArea.xy) / max(mc.u_colorMapArea.zw, vec2f(1e-4));
        if (all(under >= vec2f(0.0)) && all(under <= vec2f(1.0))) { open = mix(1.0, textureSampleLevel(u_occlusionMap, u_occlusionMap_s, under, 0.0).r, mc.u_occlusionStrength); }
    }
    let lit = applyLightingSurface(colour, N, P, viewDir, 0.0, roughness, 0.5, surface.r * open, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, 1.0);
    frag.surface = vec4f(packNormal(N), roughness, 0.75);
    frag.albedo = vec4f(colour, 1.0);
    return frag;
#else
    return vec4f(lit, 1.0);
#endif
}
#pragma end
`;

export const TERRAIN_LAYERS_SHADER_TEMPLATE = makeBuiltinShaderTemplate('terrain-layers', 'Terrain Layers',
    'Up to eight terrain layers (albedo, normal and mask arrays) weighted by the Terrain component, blended by height, projected on slopes.',
    TERRAIN_LAYERS);
