// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  planetShader.ts
 * @brief The Planet built-in shader: ground on a sphere, from the pages of its quadtree nodes, painted by four layer colours.
 *
 * Every node is the one shared patch (terrain/patch.ts) as flat ground is, and its instance says which node it is: the tint holds the page's corner in the
 * atlas (x and y), the level and the face (z: level + 1 + 16 * face), and the node's place on its face (w: ix * 2048 + iz + 1, exact in a float for up to eleven levels
 * a side). The model is the node's box in the planet's space, which is only what culling reads. The vertex stage works the point out from that: the direction
 * on the cube face, pushed out to the radius plus the page's height; it hands the fragment stage the page and the face to find its normal and paint by.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';
import { layerParams, LAYER_SURFACE_GLSL, LAYER_SURFACE_WGSL } from './layerSurfaceShader';

const PLANET = `#pragma shader "Planet"
#pragma version 300 es
#pragma domain Lit
// The four layers' colours: grass, dirt, snow, rock.
#pragma param u_tint0 color default(0.28,0.46,0.2,1)
#pragma param u_tint1 color default(0.45,0.36,0.24,1)
#pragma param u_tint2 color default(0.93,0.95,0.98,1)
#pragma param u_tint3 color default(0.4,0.38,0.36,1)
// The ground's own wander in brightness, in metres a feature, and how strong it is.
#pragma param u_macroScale float default(90) range(1,100000) ui(slider)
#pragma param u_macroVariation float default(0.35) range(0,1) ui(slider)
// The layers' textures, when the planet has any (the Planet component packs them: layerArrays.ts), each read on the planes of the world's
// axes by how much the ground faces them: the same layer code as the Terrain Layers shader (layerSurfaceShader.ts). Without any, the
// layers are their colours.
${layerParams({ sharpness: 1.6, heightBlend: 0, blendNoise: 0, antiTile: 0 })}#pragma param u_roughness float default(0.92) range(0,1) ui(slider)
// The ground in pages (pages.ts; the Planet component writes these): heights and normals, and the paint, in two atlases; the planet's radius, its centre
// in the world, how many levels its tree has; level 0 drawn out to u_lodRange0, each level twice as far; u_terrainEye is the eye the nodes were chosen for,
// in the planet's space, so every pass (a shadow's too) slides the vertices by it and all draw one ground.
#pragma param u_planetPages float default(0) range(0,1) ui(slider)
#pragma param u_heightPages texture default(white) texel(data)
#pragma param u_paintPages texture default(white) texel(data)
#pragma param u_atlasTexels float default(2048) range(1,16384) ui(slider)
#pragma param u_pageTexels float default(64) range(1,1024) ui(slider)
#pragma param u_patchCells float default(32) range(1,512) ui(slider)
#pragma param u_planetRadius float default(4000) range(1,100000000) ui(slider)
#pragma param u_planetLevels float default(8) range(1,16) ui(slider)
#pragma param u_heightRange vec2 default(0,1)
#pragma param u_lodRange0 float default(100) range(0,1000000) ui(slider)
#pragma param u_planetCenter vec4 default(0,0,0,0)
#pragma param u_terrainEye vec4 default(0,0,0,0)

#pragma vertexoffset
// The three directions that make a cube face's frame: its normal, and where u and v grow (terrain/sphere.ts, FACES).
vec3 pnN(int f) {
    if (f == 0) return vec3(1.0, 0.0, 0.0);
    if (f == 1) return vec3(-1.0, 0.0, 0.0);
    if (f == 2) return vec3(0.0, 1.0, 0.0);
    if (f == 3) return vec3(0.0, -1.0, 0.0);
    if (f == 4) return vec3(0.0, 0.0, 1.0);
    return vec3(0.0, 0.0, -1.0);
}
vec3 pnA(int f) {
    if (f == 0) return vec3(0.0, 0.0, -1.0);
    if (f == 1) return vec3(0.0, 0.0, 1.0);
    if (f == 2 || f == 3 || f == 4) return vec3(1.0, 0.0, 0.0);
    return vec3(-1.0, 0.0, 0.0);
}
vec3 pnB(int f) {
    if (f == 2) return vec3(0.0, 0.0, -1.0);
    if (f == 3) return vec3(0.0, 0.0, 1.0);
    return vec3(0.0, 1.0, 0.0);
}
// The direction from the planet's centre to the point (u, v) of a face: the cube point, its coordinates spread by tangent, normalised.
vec3 pnDirection(int f, float u, float v) {
    return normalize(pnN(f) + tan(u * 0.78539816) * pnA(f) + tan(v * 0.78539816) * pnB(f));
}
// The face's u and v directions made perpendicular to up: the frame a page's normal is stored in.
vec3 pnEu(int f, vec3 up) { vec3 a = pnA(f); return normalize(a - up * dot(a, up)); }
vec3 pnEv(int f, vec3 up) { vec3 b = pnB(f); return normalize(b - up * dot(b, up)); }
// The node's page: its height decoded texel by texel and blended (a filtered pair of bytes is no number).
float pnPageHeight(vec2 texel) {
    vec2 f = texel - 0.5;
    ivec2 i = ivec2(floor(f));
    vec2 t = f - vec2(i);
    vec4 a = texelFetch(u_heightPages, i, 0), b = texelFetch(u_heightPages, i + ivec2(1, 0), 0);
    vec4 c = texelFetch(u_heightPages, i + ivec2(0, 1), 0), d = texelFetch(u_heightPages, i + ivec2(1, 1), 0);
    vec4 hs = vec4(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    return u_heightRange.x + mix(mix(hs.x, hs.y, t.x), mix(hs.z, hs.w, t.x), t.y) * u_heightRange.y;
}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    if (u_planetPages < 0.5) return;
    vec4 tint = esInstanceTint();
    mat4 model = esInstanceModel();
    vec3 boxMin = model[3].xyz;
    vec3 boxSize = vec3(max(model[0][0], 1e-6), max(model[1][1], 1e-6), max(model[2][2], 1e-6));
    float face = floor((tint.z - 1.0) / 16.0);
    float level = tint.z - 1.0 - face * 16.0;
    float at = tint.w - 1.0;
    float ix = floor(at / 2048.0);
    float iz = at - ix * 2048.0;
    float span = 2.0 / exp2(u_planetLevels - 1.0 - level);
    float u0 = -1.0 + ix * span, v0 = -1.0 + iz * span;
    int f = int(face + 0.5);
    // The tint holds the page's corner plus half a texel (so it is never zero); its first sample is one texel in, past the border.
    vec2 page = tint.xy * u_atlasTexels + 0.5;
    vec2 g = uv * u_patchCells;
    // Toward the end of its level's range a vertex slides onto the grid of the level above, so where two levels meet they share an edge.
    float h0 = pnPageHeight(page + uv * u_pageTexels + 0.5);
    vec3 p0 = pnDirection(f, u0 + uv.x * span, v0 + uv.y * span) * (u_planetRadius + h0);
    float range = u_lodRange0 * exp2(level);
    float k = clamp((distance(u_terrainEye.xyz, p0) - range * 0.7) / (range * 0.3), 0.0, 1.0);
    g -= fract(g * 0.5) * 2.0 * k;
    vec2 q = g / u_patchCells;
    vec2 texel = page + q * u_pageTexels + 0.5;
    float h = pnPageHeight(texel);
    vec3 dir = pnDirection(f, u0 + q.x * span, v0 + q.y * span);
    vec3 P = dir * (u_planetRadius + h);
    // The model is the node's box in the world, which includes where the planet stands: the point is the planet's, so its centre is added.
    local = (u_planetCenter.xyz + P - boxMin) / boxSize;
    vec2 nxz = textureLod(u_heightPages, texel / u_atlasTexels, 0.0).ba * 2.0 - 1.0;
    vec3 nl = vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
    vec3 n = nl.x * pnEu(f, dir) + nl.y * dir + nl.z * pnEv(f, dir);
    // The normal goes through the inverse transpose of the node's scale: put in what comes out as n.
    localNormal = n * boxSize;
    // The fragment reads the page where the vertex is, and the face: the colour carries them, divided by the tint it is multiplied by on the way.
    es_vertexColor = vec4(texel / u_atlasTexels, face, 1.0) / tint;
}
#pragma end

#pragma vertexoffset wgsl
fn pnN(f : i32) -> vec3f {
    if (f == 0) { return vec3f(1.0, 0.0, 0.0); }
    if (f == 1) { return vec3f(-1.0, 0.0, 0.0); }
    if (f == 2) { return vec3f(0.0, 1.0, 0.0); }
    if (f == 3) { return vec3f(0.0, -1.0, 0.0); }
    if (f == 4) { return vec3f(0.0, 0.0, 1.0); }
    return vec3f(0.0, 0.0, -1.0);
}
fn pnA(f : i32) -> vec3f {
    if (f == 0) { return vec3f(0.0, 0.0, -1.0); }
    if (f == 1) { return vec3f(0.0, 0.0, 1.0); }
    if (f == 2 || f == 3 || f == 4) { return vec3f(1.0, 0.0, 0.0); }
    return vec3f(-1.0, 0.0, 0.0);
}
fn pnB(f : i32) -> vec3f {
    if (f == 2) { return vec3f(0.0, 0.0, -1.0); }
    if (f == 3) { return vec3f(0.0, 0.0, 1.0); }
    return vec3f(0.0, 1.0, 0.0);
}
fn pnDirection(f : i32, u : f32, v : f32) -> vec3f {
    return normalize(pnN(f) + tan(u * 0.78539816) * pnA(f) + tan(v * 0.78539816) * pnB(f));
}
fn pnEu(f : i32, up : vec3f) -> vec3f { let a = pnA(f); return normalize(a - up * dot(a, up)); }
fn pnEv(f : i32, up : vec3f) -> vec3f { let b = pnB(f); return normalize(b - up * dot(b, up)); }
fn pnPageHeight(texel : vec2f) -> f32 {
    let f = texel - vec2f(0.5);
    let i = vec2i(floor(f));
    let t = f - vec2f(i);
    let a = textureLoad(u_heightPages, i, 0);
    let b = textureLoad(u_heightPages, i + vec2i(1, 0), 0);
    let c = textureLoad(u_heightPages, i + vec2i(0, 1), 0);
    let d = textureLoad(u_heightPages, i + vec2i(1, 1), 0);
    let hs = vec4f(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    return mc.u_heightRange.x + mix(mix(hs.x, hs.y, t.x), mix(hs.z, hs.w, t.x), t.y) * mc.u_heightRange.y;
}
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    if (mc.u_planetPages < 0.5) { return; }
    let tint = esInstanceTint();
    let model = esInstanceModel();
    let boxMin = model[3].xyz;
    let boxSize = vec3f(max(model[0][0], 1e-6), max(model[1][1], 1e-6), max(model[2][2], 1e-6));
    let face = floor((tint.z - 1.0) / 16.0);
    let level = tint.z - 1.0 - face * 16.0;
    let at = tint.w - 1.0;
    let ix = floor(at / 2048.0);
    let iz = at - ix * 2048.0;
    let span = 2.0 / exp2(mc.u_planetLevels - 1.0 - level);
    let u0 = -1.0 + ix * span;
    let v0 = -1.0 + iz * span;
    let f = i32(face + 0.5);
    let page = tint.xy * mc.u_atlasTexels + vec2f(0.5);
    var g = uv * mc.u_patchCells;
    let h0 = pnPageHeight(page + uv * mc.u_pageTexels + vec2f(0.5));
    let p0 = pnDirection(f, u0 + uv.x * span, v0 + uv.y * span) * (mc.u_planetRadius + h0);
    let range = mc.u_lodRange0 * exp2(level);
    let k = clamp((distance(mc.u_terrainEye.xyz, p0) - range * 0.7) / (range * 0.3), 0.0, 1.0);
    g = g - fract(g * 0.5) * 2.0 * k;
    let q = g / mc.u_patchCells;
    let texel = page + q * mc.u_pageTexels + vec2f(0.5);
    let h = pnPageHeight(texel);
    let dir = pnDirection(f, u0 + q.x * span, v0 + q.y * span);
    let P = dir * (mc.u_planetRadius + h);
    *local = (mc.u_planetCenter.xyz + P - boxMin) / boxSize;
    let nxz = textureSampleLevel(u_heightPages, u_heightPages_s, texel / mc.u_atlasTexels, 0.0).ba * 2.0 - vec2f(1.0);
    let nl = vec3f(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
    let n = nl.x * pnEu(f, dir) + nl.y * dir + nl.z * pnEv(f, dir);
    *localNormal = n * boxSize;
    es_vertexColor = vec4f(texel / mc.u_atlasTexels, face, 1.0) / tint;
}
#pragma end

#pragma fragment
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

vec3 pnA(int f) {
    if (f == 0) return vec3(0.0, 0.0, -1.0);
    if (f == 1) return vec3(0.0, 0.0, 1.0);
    if (f == 2 || f == 3 || f == 4) return vec3(1.0, 0.0, 0.0);
    return vec3(-1.0, 0.0, 0.0);
}
vec3 pnB(int f) {
    if (f == 2) return vec3(0.0, 0.0, -1.0);
    if (f == 3) return vec3(0.0, 0.0, 1.0);
    return vec3(0.0, 1.0, 0.0);
}
${LAYER_SURFACE_GLSL}
// Value noise in three dimensions: a planet has no plane to lay a flat noise on.
float pnHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}
float pnNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(pnHash(i), pnHash(i + vec3(1, 0, 0)), f.x), mix(pnHash(i + vec3(0, 1, 0)), pnHash(i + vec3(1, 1, 0)), f.x), f.y);
    float b = mix(mix(pnHash(i + vec3(0, 0, 1)), pnHash(i + vec3(1, 0, 1)), f.x), mix(pnHash(i + vec3(0, 1, 1)), pnHash(i + vec3(1, 1, 1)), f.x), f.y);
    return mix(a, b, f.z);
}

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
#endif
    vec3 up = normalize(P - u_planetCenter.xyz);
    int f = int(v_color.z + 0.5);
    vec4 paint = texture(u_paintPages, v_color.xy);
    vec2 nxz = texture(u_heightPages, v_color.xy).ba * 2.0 - 1.0;
    vec3 nl = vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
    vec3 a = pnA(f), b = pnB(f);
    vec3 eu = normalize(a - up * dot(a, up)), ev = normalize(b - up * dot(b, up));
    vec3 N = normalize(nl.x * eu + nl.y * up + nl.z * ev);

    vec4 w = max(paint, vec4(0.0));
    w /= max(dot(w, vec4(1.0)), 1e-4);
    w = pow(w, vec4(u_sharpness));
    w /= max(dot(w, vec4(1.0)), 1e-4);
    vec3 albedo = u_tint0.rgb * w.x + u_tint1.rgb * w.y + u_tint2.rgb * w.z + u_tint3.rgb * w.w;
    vec3 rel = P - u_planetCenter.xyz;
    float open = 1.0;
    if (u_layerCount > 0.5) {
        // Each layer on the three planes of the world's axes, those the ground faces by how much it does.
        vec3 axis = pow(abs(N), vec3(6.0));
        axis *= step(0.04 * dot(axis, vec3(1.0)), axis);
        axis /= max(dot(axis, vec3(1.0)), 1e-4);
        TnSurface layers = tnLayers(paint, vec4(0.0), rel, dFdx(rel), dFdy(rel), N, axis, tnNearFar(length(rel - u_terrainEye.xyz)));
        albedo = layers.albedo;
        N = normalize(N + layers.slope);
        open = layers.mask.r;
    }
    vec3 q = rel / u_macroScale;
    float broad = pnNoise(q) * 0.6 + pnNoise(q * 4.1 + 7.0) * 0.4;
    albedo *= mix(1.0, 0.7 + 0.6 * broad, u_macroVariation);

    float roughness = u_roughness;
    SurfaceExt ext = surfaceExtNone(N);
    vec3 viewDir = viewDirection(P);
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 0.5, open, ext);
    fragColor = vec4(lit, 1.0);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(N), roughness, 0.75);
    fragAlbedo = vec4(albedo, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
fn pnA(f : i32) -> vec3f {
    if (f == 0) { return vec3f(0.0, 0.0, -1.0); }
    if (f == 1) { return vec3f(0.0, 0.0, 1.0); }
    if (f == 2 || f == 3 || f == 4) { return vec3f(1.0, 0.0, 0.0); }
    return vec3f(-1.0, 0.0, 0.0);
}
fn pnB(f : i32) -> vec3f {
    if (f == 2) { return vec3f(0.0, 0.0, -1.0); }
    if (f == 3) { return vec3f(0.0, 0.0, 1.0); }
    return vec3f(0.0, 1.0, 0.0);
}
${LAYER_SURFACE_WGSL}
fn pnHash(p0 : vec3f) -> f32 {
    var p = fract(p0 * vec3f(0.1031, 0.1030, 0.0973));
    p = p + dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}
fn pnNoise(p : vec3f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = mix(mix(pnHash(i), pnHash(i + vec3f(1.0, 0.0, 0.0)), f.x), mix(pnHash(i + vec3f(0.0, 1.0, 0.0)), pnHash(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y);
    let b = mix(mix(pnHash(i + vec3f(0.0, 0.0, 1.0)), pnHash(i + vec3f(1.0, 0.0, 1.0)), f.x), mix(pnHash(i + vec3f(0.0, 1.0, 1.0)), pnHash(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y);
    return mix(a, b, f.z);
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
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
#endif
    let up = normalize(P - mc.u_planetCenter.xyz);
    let f = i32(v.v_color.z + 0.5);
    let paint = textureSample(u_paintPages, u_paintPages_s, v.v_color.xy);
    let nxz = textureSample(u_heightPages, u_heightPages_s, v.v_color.xy).ba * 2.0 - vec2f(1.0);
    let nl = vec3f(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
    let a = pnA(f);
    let b = pnB(f);
    let eu = normalize(a - up * dot(a, up));
    let ev = normalize(b - up * dot(b, up));
    let N0 = normalize(nl.x * eu + nl.y * up + nl.z * ev);

    var w = max(paint, vec4f(0.0));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);
    w = pow(w, vec4f(mc.u_sharpness));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);
    var albedo = mc.u_tint0.rgb * w.x + mc.u_tint1.rgb * w.y + mc.u_tint2.rgb * w.z + mc.u_tint3.rgb * w.w;
    let rel = P - mc.u_planetCenter.xyz;
    var N = N0;
    var open = 1.0;
    let dpx = dpdx(rel);
    let dpy = dpdy(rel);
    if (mc.u_layerCount > 0.5) {
        var axis = pow(abs(N0), vec3f(6.0));
        axis = axis * step(vec3f(0.04 * dot(axis, vec3f(1.0))), axis);
        axis = axis / max(dot(axis, vec3f(1.0)), 1e-4);
        let layers = tnLayers(paint, vec4f(0.0), rel, dpx, dpy, N0, axis, tnNearFar(length(rel - mc.u_terrainEye.xyz)));
        albedo = layers.albedo;
        N = normalize(N0 + layers.slope);
        open = layers.mask.r;
    }
    let q = rel / mc.u_macroScale;
    let broad = pnNoise(q) * 0.6 + pnNoise(q * 4.1 + vec3f(7.0)) * 0.4;
    albedo = albedo * mix(1.0, 0.7 + 0.6 * broad, mc.u_macroVariation);

    let roughness = mc.u_roughness;
    let ext = surfaceExtNone(N);
    let viewDir = viewDirection(P);
    let lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 0.5, open, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, 1.0);
    frag.surface = vec4f(packNormal(N), roughness, 0.75);
    frag.albedo = vec4f(albedo, 1.0);
    return frag;
#else
    return vec4f(lit, 1.0);
#endif
}
#pragma end
`;

export const PLANET_SHADER_TEMPLATE = makeBuiltinShaderTemplate('planet', 'Planet',
    'Ground on a sphere, from the pages of a Planet component\'s quadtree nodes, painted by four layer colours.', PLANET);
