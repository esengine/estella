// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./DynamicGI.hpp"
#include "./RenderContext.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>

namespace esengine {

DynamicGIScene& dynamicGIScene() {
    static DynamicGIScene scene;
    return scene;
}

namespace {

constexpr u32 kInstanceVec4 = 20;
constexpr u32 kProbeSize = 8;
constexpr u32 kProbeTexels = 3;  // the vector that integrates a probe against a normal, one texel a colour channel

/// The header the SDK writes (sdk/src/gi/gpuScene.ts), by index.
enum Header : u32 {
    kDim = 0, kCell, kOriginX, kOriginY, kOriginZ, kReach, kInstances, kPixels,
    kSunX, kSunY, kSunZ, kSunOn, kSunR, kSunG, kSunB, kBias, kRange, kTolerance, kSkyR, kSkyG, kSkyB, kHit, kHeaderSize
};

struct ParamsBlock {
    f32 sdf[4];
    i32 origin[4];
    u32 counts[4];
    f32 sunDir[4];
    f32 sunRad[4];
    f32 trace[4];
    f32 sky[4];
};
static_assert(sizeof(ParamsBlock) == 112, "the GI block is seven vec4s");

#ifdef ES_ENABLE_WEBGPU
// The CPU twin of what is here is in sdk/src/gi (globalSdf.ts sphereTrace, surfaceCache.ts lookup, screenProbes.ts tracePoint);
// pipeline/tests/gi-lab.test.ts holds the twin to Cycles, and tools/gi/check-sdf-wgsl.mjs ran the trace of this on a GPU.
//
// An instance is 20 vec4: 0-3 the matrix local to world; 4-6 the rows of world to local (w the translation, the scale already divided
// out); 7 the world box min and w the scale; 8 the world box max and w the card pixel size; 9 the local box min and w the emission
// scale; 10 the local box max; 11-16 the six faces (width, height, first pixel in the card pixel array).
const char* kCommon = R"WGSL(
struct Frame { projection : mat4x4f, camera : vec4f, inverseViewProjection : mat4x4f, renderOrigin : vec4f };
struct GI {
    sdf : vec4f,       // x: cells per axis, y: cell size, z: reach, w: intensity
    origin : vec4i,    // xyz: the window's first cell; w: the frame
    counts : vec4u,    // x: instances, y: card pixels, z: probe tiles x, w: probe tiles y
    sunDir : vec4f,    // xyz: toward the sun; w: 1 when there is one
    sunRad : vec4f,    // rgb: radiance; w: how far off a surface a ray starts
    trace : vec4f,     // x: how far a ray looks, y: card tolerance, z: blend, w: hit fraction of a cell
    sky : vec4f,       // rgb: what a ray that meets nothing brings
};
@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<uniform> gi : GI;
@group(0) @binding(2) var<storage, read> sdfData : array<f32>;
@group(0) @binding(3) var<storage, read> insts : array<vec4f>;
@group(0) @binding(4) var<storage, read> cardPix : array<vec4u>;
@group(0) @binding(5) var<storage, read> radIn : array<vec4f>;

const PI : f32 = 3.14159265;

fn cellValue(c : vec3i) -> f32 {
    let d = i32(gi.sdf.x);
    let w = c & vec3i(d - 1);
    return sdfData[u32(w.x + w.y * d + w.z * d * d)];
}
fn sdfSample(p : vec3f) -> f32 {
    let g = p / gi.sdf.y - vec3f(0.5);
    let i0 = vec3i(floor(g));
    let f = g - vec3f(i0);
    let c000 = cellValue(i0);
    let c100 = cellValue(i0 + vec3i(1, 0, 0));
    let c010 = cellValue(i0 + vec3i(0, 1, 0));
    let c110 = cellValue(i0 + vec3i(1, 1, 0));
    let c001 = cellValue(i0 + vec3i(0, 0, 1));
    let c101 = cellValue(i0 + vec3i(1, 0, 1));
    let c011 = cellValue(i0 + vec3i(0, 1, 1));
    let c111 = cellValue(i0 + vec3i(1, 1, 1));
    return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y), mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}
fn inField(p : vec3f) -> bool {
    let c = p / gi.sdf.y - vec3f(gi.origin.xyz);
    return all(c >= vec3f(1.0)) && all(c <= vec3f(gi.sdf.x - 1.0));
}
// Distance along dir to the first surface within maxT, or -1. A ray that starts inside a body hits at 0.
fn sdfTrace(origin : vec3f, dir : vec3f, maxT : f32) -> f32 {
    var t = 0.0;
    let cell = gi.sdf.y;
    for (var i = 0; i < 160; i = i + 1) {
        if (t >= maxT) { return -1.0; }
        let p = origin + dir * t;
        if (!inField(p)) { return -1.0; }
        let d = sdfSample(p);
        if (d < cell * gi.trace.w) { return t; }
        t = t + max(d, cell * 0.25);
    }
    return -1.0;
}

fn instBase(i : u32) -> u32 { return i * 20u; }
fn faceAxes(face : u32) -> vec2u {
    let axis = face / 2u;
    if (axis == 0u) { return vec2u(1u, 2u); }
    if (axis == 1u) { return vec2u(0u, 2u); }
    return vec2u(0u, 1u);
}
fn comp(v : vec3f, k : u32) -> f32 { return select(select(v.z, v.y, k == 1u), v.x, k == 0u); }
fn setComp(v : vec3f, k : u32, x : f32) -> vec3f {
    var r = v;
    if (k == 0u) { r.x = x; } else if (k == 1u) { r.y = x; } else { r.z = x; }
    return r;
}
fn unpackNormal(w0 : u32, w1 : u32) -> vec3f {
    let nx = f32(bitcast<i32>((w0 >> 16u) << 24u) >> 24u) / 127.0;
    let ny = f32(bitcast<i32>((w0 >> 24u) << 24u) >> 24u) / 127.0;
    let nz = f32(bitcast<i32>(w1 << 24u) >> 24u) / 127.0;
    return vec3f(nx, ny, nz);
}
fn unpackColour(w : u32) -> vec3f {
    return vec3f(f32(w & 255u), f32((w >> 8u) & 255u), f32((w >> 16u) & 255u)) / 255.0;
}

// What a ray brings back from the surface it hit at point, travelling along dir: the cards that face it, blended by how squarely each
// does, from the pixel whose surface is within the tolerance of the point; of the instances that hold the point, the nearest wins.
fn lookup(point : vec3f, dir : vec3f) -> vec3f {
    var best = vec3f(0.0);
    var bestError = 1e30;
    let tol = gi.trace.y;
    for (var i = 0u; i < gi.counts.x; i = i + 1u) {
        let b = instBase(i);
        let wmin = insts[b + 7u];
        let wmax = insts[b + 8u];
        if (any(point < wmin.xyz - vec3f(tol)) || any(point > wmax.xyz + vec3f(tol))) { continue; }
        let r0 = insts[b + 4u]; let r1 = insts[b + 5u]; let r2 = insts[b + 6u];
        let local = vec3f(dot(r0.xyz, point) + r0.w, dot(r1.xyz, point) + r1.w, dot(r2.xyz, point) + r2.w);
        var d = vec3f(dot(r0.xyz, dir), dot(r1.xyz, dir), dot(r2.xyz, dir));
        d = d / max(length(d), 1e-9);
        let lmin = insts[b + 9u].xyz;
        let lmax = insts[b + 10u].xyz;
        let scale = wmin.w;
        let cell = wmax.w;
        var sum = vec3f(0.0);
        var total = 0.0;
        var error = 0.0;
        for (var axis = 0u; axis < 3u; axis = axis + 1u) {
            let da = comp(d, axis);
            let weight = abs(da);
            if (weight < 0.05) { continue; }
            let face = axis * 2u + select(0u, 1u, da > 0.0);
            let uv = faceAxes(face);
            let lu = comp(local, uv.x); let lv = comp(local, uv.y);
            if (lu < comp(lmin, uv.x) - cell || lu > comp(lmax, uv.x) + cell || lv < comp(lmin, uv.y) - cell || lv > comp(lmax, uv.y) + cell) { continue; }
            let f = insts[b + 11u + face];
            let fu = clamp((lu - comp(lmin, uv.x)) / max(comp(lmax, uv.x) - comp(lmin, uv.x), 1e-9), 0.0, 0.99999);
            let fv = clamp((lv - comp(lmin, uv.y)) / max(comp(lmax, uv.y) - comp(lmin, uv.y), 1e-9), 0.0, 0.99999);
            let px = u32(floor(fu * f.x));
            let py = u32(floor(fv * f.y));
            let idx = u32(f.z) + px + py * u32(f.x);
            let pix = cardPix[idx];
            let depth16 = pix.x & 0xffffu;
            if (depth16 == 65535u) { continue; }
            let ext = comp(lmax, axis) - comp(lmin, axis);
            let sgn = face % 2u == 0u;
            let la = comp(local, axis);
            let pointDepth = select(la - comp(lmin, axis), comp(lmax, axis) - la, sgn);
            let cardDepth = f32(depth16) / 65534.0 * ext;
            let off = abs(cardDepth - pointDepth) * scale;
            if (off > tol) { continue; }
            error = max(error, off);
            sum = sum + weight * radIn[idx].xyz;
            total = total + weight;
        }
        if (total > 0.0 && error < bestError) { bestError = error; best = sum / total; }
    }
    return best;
}

fn hash3(a : u32, b : u32, c : u32) -> f32 {
    var h = (a * 73856093u) ^ (b * 19349663u) ^ (c * 83492791u);
    h = (h ^ (h >> 16u)) * 0x45d9f3bu;
    h = h ^ (h >> 16u);
    return f32(h) / 4294967296.0;
}
fn octahedral(u : f32, v : f32) -> vec3f {
    let x = u * 2.0 - 1.0; let y = v * 2.0 - 1.0;
    var p = vec2f(x, y);
    let z = 1.0 - abs(x) - abs(y);
    if (z < 0.0) { p = vec2f((1.0 - abs(y)) * select(-1.0, 1.0, x >= 0.0), (1.0 - abs(x)) * select(-1.0, 1.0, y >= 0.0)); }
    return normalize(vec3f(p.x, p.y, z));
}
// One ray of a probe about normal n: the octahedral cell (i, j), jittered inside it, folded into n's hemisphere.
fn probeRay(i : u32, j : u32, n : vec3f, seed : u32, frame : u32) -> vec3f {
    let jx = hash3(i, j, seed * 31u + frame * 7u + 1u);
    let jy = hash3(i, j, seed * 17u + frame * 13u + 2u);
    var d = octahedral((f32(i) + jx) / 8.0, (f32(j) + jy) / 8.0);
    let dn = dot(d, n);
    if (dn < 0.0) { d = d - 2.0 * dn * n; }
    return d;
}
// The light a ray from origin along d brings.
fn rayRadiance(origin : vec3f, d : vec3f) -> vec3f {
    let t = sdfTrace(origin, d, gi.trace.x);
    if (t < 0.0) { return gi.sky.xyz; }
    if (t < 0.001) { return vec3f(0.0); }
    return lookup(origin + d * t, d);
}
)WGSL";

const char* kCardLight = R"WGSL(
@group(0) @binding(6) var<storage, read_write> radOut : array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let p = id.x;
    if (p >= gi.counts.y) { return; }
    let pix = cardPix[p];
    let depth16 = pix.x & 0xffffu;
    if (depth16 == 65535u) { radOut[p] = vec4f(0.0); return; }
    let instance = pix.w >> 3u;
    let face = pix.w & 7u;
    let b = instBase(instance);
    let f = insts[b + 11u + face];
    let idx = p - u32(f.z);
    let w = u32(f.x);
    let px = idx % w;
    let py = idx / w;
    let lmin = insts[b + 9u].xyz;
    let lmax = insts[b + 10u].xyz;
    let axis = face / 2u;
    let uv = faceAxes(face);
    var local = vec3f(0.0);
    local = setComp(local, uv.x, comp(lmin, uv.x) + (f32(px) + 0.5) / f.x * (comp(lmax, uv.x) - comp(lmin, uv.x)));
    local = setComp(local, uv.y, comp(lmin, uv.y) + (f32(py) + 0.5) / f.y * (comp(lmax, uv.y) - comp(lmin, uv.y)));
    let depth = f32(depth16) / 65534.0 * (comp(lmax, axis) - comp(lmin, axis));
    local = setComp(local, axis, select(comp(lmin, axis) + depth, comp(lmax, axis) - depth, face % 2u == 0u));
    let m0 = insts[b]; let m1 = insts[b + 1u]; let m2 = insts[b + 2u]; let m3 = insts[b + 3u];
    let pos = m0.xyz * local.x + m1.xyz * local.y + m2.xyz * local.z + m3.xyz;
    let scale = insts[b + 7u].w;
    let nl = unpackNormal(pix.x, pix.y);
    let n = normalize((m0.xyz * nl.x + m1.xyz * nl.y + m2.xyz * nl.z) / scale);
    let albedo = unpackColour(pix.y >> 8u);
    let emissive = unpackColour(pix.z) * insts[b + 9u].w;

    var direct = vec3f(0.0);
    if (gi.sunDir.w > 0.5) {
        let ndl = dot(n, gi.sunDir.xyz);
        if (ndl > 0.0) {
            let t = sdfTrace(pos + n * gi.sunRad.w, gi.sunDir.xyz, gi.trace.x);
            if (t < 0.0) { direct = gi.sunRad.xyz * ndl; }
        }
    }
    let origin = pos + n * gi.sunRad.w;
    var sum = vec3f(0.0);
    let frameIndex = u32(gi.origin.w);
    for (var j = 0u; j < 8u; j = j + 1u) {
        for (var i = 0u; i < 8u; i = i + 1u) {
            let d = probeRay(i, j, n, p, frameIndex);
            sum = sum + rayRadiance(origin, d) * dot(d, n);
        }
    }
    let indirect = sum * (2.0 / 64.0);
    let now = albedo * (direct + indirect) + emissive;
    let blend = select(gi.trace.z, 1.0, gi.origin.w < 2);
    radOut[p] = vec4f(mix(radIn[p].xyz, now, blend), 1.0);
}
)WGSL";

const char* kSurface = R"WGSL(
fn worldFromDepth(uv : vec2f, depth : f32) -> vec3f {
    let clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    let world = frame.inverseViewProjection * clip;
    return world.xyz / world.w;
}
fn decodeNormal(g : vec4f) -> vec3f {
    let f = g.rg * 2.0 - 1.0;
    var n = vec3f(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    let k = clamp(-n.z, 0.0, 1.0);
    n = vec3f(n.x + select(k, -k, n.x >= 0.0), n.y + select(k, -k, n.y >= 0.0), n.z);
    return normalize(n);
}
fn viewDirection(p : vec3f) -> vec3f {
    if (frame.camera.w > 0.5) { return normalize(frame.camera.xyz - p); }
    return frame.camera.xyz;
}
)WGSL";

// One workgroup is one probe: its 64 threads are the 64 rays, reduced to the vector V = 2/64 * sum(L d) per colour channel, with which
// the diffuse light for any normal n is max(V.n, 0) (exact for the probe's own normal, and linear in n around it).
const char* kProbe = R"WGSL(
@group(0) @binding(6) var depthTex : texture_depth_2d;
@group(0) @binding(7) var gbuffer : texture_2d<f32>;
@group(0) @binding(8) var probeOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var probeHist : texture_2d<f32>;

var<workgroup> shR : array<vec3f, 64>;
var<workgroup> shG : array<vec3f, 64>;
var<workgroup> shB : array<vec3f, 64>;

@compute @workgroup_size(8, 8)
fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_id) lid3 : vec3u, @builtin(local_invocation_index) lid : u32) {
    let size = vec2i(textureDimensions(depthTex));
    let t = min(vec2i(wg.xy) * 8 + vec2i(4), size - vec2i(1));
    let depth = textureLoad(depthTex, t, 0);
    let g = textureLoad(gbuffer, t, 0);
    let valid = depth < 1.0 && g.a > 0.7;
    var contribution = array<vec3f, 3>(vec3f(0.0), vec3f(0.0), vec3f(0.0));
    var eyeDistance = 0.0;
    if (valid) {
        var n = decodeNormal(g);
        let pos = worldFromDepth((vec2f(t) + 0.5) / vec2f(size), depth);
        if (dot(n, viewDirection(pos)) < 0.0) { n = -n; }
        eyeDistance = length(pos - frame.camera.xyz);
        let d = probeRay(lid3.x, lid3.y, n, wg.x + wg.y * gi.counts.z, u32(gi.origin.w));
        let L = rayRadiance(pos + n * gi.sunRad.w, d);
        contribution = array<vec3f, 3>(d * L.x, d * L.y, d * L.z);
    }
    shR[lid] = contribution[0]; shG[lid] = contribution[1]; shB[lid] = contribution[2];
    workgroupBarrier();
    for (var s = 32u; s > 0u; s = s >> 1u) {
        if (lid < s) { shR[lid] = shR[lid] + shR[lid + s]; shG[lid] = shG[lid] + shG[lid + s]; shB[lid] = shB[lid] + shB[lid + s]; }
        workgroupBarrier();
    }
    if (lid == 0u) {
        let k = 2.0 / 64.0;
        var vr = shR[0] * k; var vg = shG[0] * k; var vb = shB[0] * k;
        let base = vec2i(i32(wg.x) * 3, i32(wg.y));
        // The last frames agree where the probe still looks at the same surface (its distance from the eye is the key, kept in w).
        let hr = textureLoad(probeHist, base, 0);
        if (valid && hr.w > 0.0 && abs(hr.w - eyeDistance) < 0.02 * eyeDistance && gi.origin.w > 1) {
            let a = gi.trace.z;
            vr = mix(textureLoad(probeHist, base, 0).xyz, vr, a);
            vg = mix(textureLoad(probeHist, base + vec2i(1, 0), 0).xyz, vg, a);
            vb = mix(textureLoad(probeHist, base + vec2i(2, 0), 0).xyz, vb, a);
        }
        textureStore(probeOut, base, vec4f(vr, eyeDistance));
        textureStore(probeOut, base + vec2i(1, 0), vec4f(vg, 0.0));
        textureStore(probeOut, base + vec2i(2, 0), vec4f(vb, 0.0));
    }
}
)WGSL";

const char* kApply = R"WGSL(
@group(0) @binding(6) var depthTex : texture_depth_2d;
@group(0) @binding(7) var gbuffer : texture_2d<f32>;
@group(0) @binding(8) var albedoTex : texture_2d<f32>;
@group(0) @binding(9) var probes : texture_2d<f32>;
@group(0) @binding(10) var sceneTex : texture_2d<f32>;
@group(0) @binding(11) var outTex : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let size = vec2i(textureDimensions(depthTex));
    let p = vec2i(id.xy);
    if (p.x >= size.x || p.y >= size.y) { return; }
    let scene = textureLoad(sceneTex, p, 0);
    let depth = textureLoad(depthTex, p, 0);
    let g = textureLoad(gbuffer, p, 0);
    let albedo = textureLoad(albedoTex, p, 0);
    if (depth >= 1.0 || g.a <= 0.7 || albedo.a <= 0.5) { textureStore(outTex, p, scene); return; }
    var n = decodeNormal(g);
    let pos = worldFromDepth((vec2f(p) + 0.5) / vec2f(size), depth);
    if (dot(n, viewDirection(pos)) < 0.0) { n = -n; }
    let tiles = vec2i(gi.counts.zw);
    // The probes round the pixel: probe (tx, ty) stands at pixel (tx * 8 + 4, ty * 8 + 4). The nine nearest are looked at, since in the
    // corner of two walls the four nearest can all be on the other wall, and a probe on another plane has nothing to say about this one.
    let q = (vec2f(p) - vec2f(4.0)) / 8.0;
    let q0 = vec2i(floor(q));
    let eye = max(length(pos - frame.camera.xyz), 1.0);
    var E = vec3f(0.0);
    var total = 0.0;
    var Erelaxed = vec3f(0.0);
    var totalRelaxed = 0.0;
    for (var k = 0; k < 16; k = k + 1) {
        let o = vec2i(k & 3, k >> 2) - vec2i(1);
        let tile = q0 + o;
        if (any(tile < vec2i(0)) || any(tile >= tiles)) { continue; }
        let pp = min(tile * 8 + vec2i(4), size - vec2i(1));
        let pd = textureLoad(depthTex, pp, 0);
        let pg = textureLoad(gbuffer, pp, 0);
        if (pd >= 1.0 || pg.a <= 0.7) { continue; }
        let ppos = worldFromDepth((vec2f(pp) + 0.5) / vec2f(size), pd);
        var pn = decodeNormal(pg);
        if (dot(pn, viewDirection(ppos)) < 0.0) { pn = -pn; }
        // A tent over a tile and a half round the pixel, so a probe two tiles away does not count.
        let d = abs(vec2f(tile) - q);
        let tent = max(1.0 - d.x / 1.6, 0.0) * max(1.0 - d.y / 1.6, 0.0);
        if (tent <= 0.0) { continue; }
        let plane = abs(dot(n, ppos - pos)) / (0.02 * eye);
        let wPlane = tent / (1.0 + plane * plane);
        let wNormal = pow(max(dot(pn, n), 0.0), 4.0);
        let base = vec2i(tile.x * 3, tile.y);
        let vr = textureLoad(probes, base, 0).xyz;
        let vg = textureLoad(probes, base + vec2i(1, 0), 0).xyz;
        let vb = textureLoad(probes, base + vec2i(2, 0), 0).xyz;
        let e = max(vec3f(dot(vr, n), dot(vg, n), dot(vb, n)), vec3f(0.0));
        E = E + e * wPlane * wNormal;
        total = total + wPlane * wNormal;
        // The same without the normal, for a pixel whose every neighbour faces another way.
        Erelaxed = Erelaxed + e * wPlane;
        totalRelaxed = totalRelaxed + wPlane;
    }
    if (total > 0.05) { E = E / total; } else if (totalRelaxed > 1e-5) { E = Erelaxed / totalRelaxed; } else { E = vec3f(0.0); }
    textureStore(outTex, p, vec4f(scene.rgb + albedo.rgb * E * gi.sdf.w, scene.a));
}
)WGSL";
#else
const char* kCommon = "";
const char* kCardLight = "";
const char* kSurface = "";
const char* kProbe = "";
const char* kApply = "";
#endif

std::string join(const char* a, const char* b, const char* c = "") {
    return std::string(a) + b + c;
}

}  // namespace

DynamicGI::DynamicGI(GfxDevice& device, RenderContext& context) : device_(device), context_(context) {}

DynamicGI::~DynamicGI() {
    release();
}

void DynamicGI::release() {
    for (BufferHandle* b : {&params_, &sdf_, &instances_, &pixels_, &radiance_[0], &radiance_[1]}) {
        if (*b != BufferHandle::Invalid) device_.deleteBuffer(*b);
        *b = BufferHandle::Invalid;
    }
    for (TextureHandle& t : probes_) {
        if (t != TextureHandle::Invalid) device_.deleteTexture(t);
        t = TextureHandle::Invalid;
    }
    for (ComputeHandle* c : {&cardLight_, &probe_, &apply_}) {
        if (*c != ComputeHandle::Invalid) device_.deleteCompute(*c);
        *c = ComputeHandle::Invalid;
    }
    probeTilesX_ = probeTilesY_ = 0;
    sdfBytes_ = instanceBytes_ = pixelBytes_ = radianceBytes_ = 0;
    uploadedVersion_ = 0;
    failed_ = false;
}

bool DynamicGI::ensure() {
    if (failed_) return false;
    if (!device_.supportsCompute()) return false;
    if (params_ == BufferHandle::Invalid) {
        params_ = device_.createBuffer({GfxBufferUsage::Uniform, sizeof(ParamsBlock), true}, GfxContent::transient(), nullptr);
        if (params_ == BufferHandle::Invalid) { failed_ = true; return false; }
    }
    const auto make = [&](ComputeHandle& handle, const std::string& source, const char* name) {
        if (handle != ComputeHandle::Invalid) return true;
        std::string log;
        handle = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, source.c_str(), "main"}, &log);
        if (handle == ComputeHandle::Invalid) {
            ES_LOG_ERROR("DynamicGI: the {} kernel did not compile: {}", name, log);
            failed_ = true;
            return false;
        }
        return true;
    };
    return make(cardLight_, join(kCommon, kCardLight), "card light") && make(probe_, join(kCommon, kSurface, kProbe), "probe")
        && make(apply_, join(kCommon, kSurface, kApply), "apply");
}

bool DynamicGI::upload() {
    const DynamicGIScene& s = dynamicGIScene();
    if (s.header.size() < kHeaderSize || s.sdf.empty() || s.instances.empty() || s.pixels.empty()) return false;
    if (s.version == uploadedVersion_) return true;
    const auto put = [&](BufferHandle& buffer, u32& have, const void* data, u32 bytes) {
        bytes = std::max(bytes, 16u);
        if (buffer == BufferHandle::Invalid || have != bytes) {
            if (buffer != BufferHandle::Invalid) device_.deleteBuffer(buffer);
            buffer = device_.createBuffer({GfxBufferUsage::Storage, bytes, false}, GfxContent::transient(), nullptr);
            have = bytes;
        }
        if (buffer == BufferHandle::Invalid) return false;
        device_.updateBuffer(buffer, 0, data, bytes);
        return true;
    };
    if (!put(sdf_, sdfBytes_, s.sdf.data(), static_cast<u32>(s.sdf.size() * 4)) ||
        !put(instances_, instanceBytes_, s.instances.data(), static_cast<u32>(s.instances.size() * 4)) ||
        !put(pixels_, pixelBytes_, s.pixels.data(), static_cast<u32>(s.pixels.size() * 4))) {
        ES_LOG_ERROR("DynamicGI: could not upload the scene");
        failed_ = true;
        return false;
    }
    pixelCount_ = static_cast<u32>(s.header[kPixels]);
    // The radiance the cards hold: 16 bytes a pixel, two of them (this frame is written from the last), zeroed again on a new scene.
    const u32 radianceBytes = std::max(pixelCount_ * 16u, 16u);
    if (radianceBytes != radianceBytes_ || radiance_[0] == BufferHandle::Invalid) {
        for (BufferHandle& r : radiance_) {
            if (r != BufferHandle::Invalid) device_.deleteBuffer(r);
            r = device_.createBuffer({GfxBufferUsage::Storage, radianceBytes, false}, GfxContent::transient(), nullptr);
        }
        radianceBytes_ = radianceBytes;
        if (radiance_[0] == BufferHandle::Invalid || radiance_[1] == BufferHandle::Invalid) { failed_ = true; return false; }
    }
    std::vector<f32> zero(radianceBytes / 4, 0.0f);
    for (BufferHandle r : radiance_) device_.updateBuffer(r, 0, zero.data(), radianceBytes);
    frame_ = 0;
    uploadedVersion_ = s.version;
    return true;
}

bool DynamicGI::ensureProbes(u32 tilesX, u32 tilesY) {
    if (probes_[0] != TextureHandle::Invalid && probeTilesX_ == tilesX && probeTilesY_ == tilesY) return true;
    for (TextureHandle& t : probes_) {
        if (t != TextureHandle::Invalid) device_.deleteTexture(t);
        t = TextureHandle::Invalid;
    }
    TextureDesc desc;
    desc.width = tilesX * kProbeTexels;
    desc.height = tilesY;
    desc.format = GfxPixelFormat::RGBA16F;
    desc.minFilter = desc.magFilter = TextureFilter::Nearest;
    desc.storage = true;
    for (TextureHandle& t : probes_) t = device_.createTexture(desc, GfxContent::transient(), nullptr);
    if (probes_[0] == TextureHandle::Invalid || probes_[1] == TextureHandle::Invalid) {
        ES_LOG_ERROR("DynamicGI: could not allocate the probes");
        return false;
    }
    probeTilesX_ = tilesX;
    probeTilesY_ = tilesY;
    return true;
}

rg::ResourceId DynamicGI::declare(rg::RenderGraph& graph, rg::ResourceId input, rg::ResourceId scene, const DynamicGIParams& params,
                                  u32 width, u32 height) {
    if (!ensure() || input == rg::kNoResource || scene == rg::kNoResource) return input;
    if (!upload()) return input;
    const u32 tilesX = (width + kProbeSize - 1) / kProbeSize, tilesY = (height + kProbeSize - 1) / kProbeSize;
    if (!ensureProbes(tilesX, tilesY)) return input;

    rg::TargetDesc token;
    token.width = 1;
    token.height = 1;
    token.format = GfxPixelFormat::RGBA8;
    token.storage = true;
    token.linearFilter = false;
    const DynamicGIParams p = params;

    // The frame's constants for every pass: the scene's header and the effect's parameters.
    const auto writeParams = [this, p]() {
        const DynamicGIScene& s = dynamicGIScene();
        const std::vector<f32>& h = s.header;
        ParamsBlock b{};
        b.sdf[0] = h[kDim]; b.sdf[1] = h[kCell]; b.sdf[2] = h[kReach]; b.sdf[3] = p.intensity;
        b.origin[0] = static_cast<i32>(h[kOriginX]); b.origin[1] = static_cast<i32>(h[kOriginY]); b.origin[2] = static_cast<i32>(h[kOriginZ]);
        b.origin[3] = static_cast<i32>(frame_);
        b.counts[0] = static_cast<u32>(h[kInstances]); b.counts[1] = static_cast<u32>(h[kPixels]);
        b.counts[2] = probeTilesX_; b.counts[3] = probeTilesY_;
        b.sunDir[0] = h[kSunX]; b.sunDir[1] = h[kSunY]; b.sunDir[2] = h[kSunZ]; b.sunDir[3] = h[kSunOn];
        b.sunRad[0] = h[kSunR]; b.sunRad[1] = h[kSunG]; b.sunRad[2] = h[kSunB]; b.sunRad[3] = h[kBias];
        b.trace[0] = h[kRange]; b.trace[1] = h[kTolerance]; b.trace[2] = std::clamp(p.blend, 0.01f, 1.0f); b.trace[3] = h[kHit];
        b.sky[0] = h[kSkyR]; b.sky[1] = h[kSkyG]; b.sky[2] = h[kSkyB];
        device_.updateBuffer(params_, 0, &b, sizeof(b));
    };

    const rg::ResourceId lit = graph.createTarget(token);
    {
        rg::PassDesc pass;
        pass.name = "dgi_cards";
        pass.compute = true;
        pass.dependencies = {scene};
        pass.write = lit;
        pass.execute = [this, writeParams](const rg::PassContext&) {
            writeParams();
            // This frame's lighting is written to one of the two buffers and read from the other.
            const BufferHandle in = radiance_[frame_ & 1u], out = radiance_[(frame_ & 1u) ^ 1u];
            const GfxComputeBinding bindings[7] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storageRead(2, sdf_),
                GfxComputeBinding::storageRead(3, instances_),
                GfxComputeBinding::storageRead(4, pixels_),
                GfxComputeBinding::storageRead(5, in),
                GfxComputeBinding::storage(6, out),
            };
            device_.dispatchCompute(cardLight_, bindings, 7, (pixelCount_ + 63) / 64);
        };
        graph.addPass(std::move(pass));
    }

    const rg::ResourceId probed = graph.createTarget(token);
    {
        rg::PassDesc pass;
        pass.name = "dgi_probes";
        pass.compute = true;
        pass.dependencies = {scene, lit};
        pass.write = probed;
        pass.execute = [this, &graph, scene](const rg::PassContext&) {
            const TextureHandle depth = graph.depthTextureOf(scene);
            const TextureHandle gbuffer = graph.gbufferTextureOf(scene);
            if (depth == TextureHandle::Invalid || gbuffer == TextureHandle::Invalid) return;
            // The cards were just written into the buffer the next frame reads: the probes see this frame's lighting.
            const BufferHandle cards = radiance_[(frame_ & 1u) ^ 1u];
            const u32 cur = frame_ & 1u;
            const GfxComputeBinding bindings[10] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storageRead(2, sdf_),
                GfxComputeBinding::storageRead(3, instances_),
                GfxComputeBinding::storageRead(4, pixels_),
                GfxComputeBinding::storageRead(5, cards),
                GfxComputeBinding::depth(6, depth),
                GfxComputeBinding::sampled(7, gbuffer),
                GfxComputeBinding::storageTexture(8, probes_[cur]),
                GfxComputeBinding::sampled(9, probes_[cur ^ 1u]),
            };
            device_.dispatchCompute(probe_, bindings, 10, probeTilesX_, probeTilesY_);
        };
        graph.addPass(std::move(pass));
    }

    rg::TargetDesc full;
    full.format = GfxPixelFormat::RGBA16F;
    full.storage = true;
    full.linearFilter = true;
    const rg::ResourceId result = graph.createTarget(full);
    {
        rg::PassDesc pass;
        pass.name = "dgi_apply";
        pass.compute = true;
        pass.reads = {input};
        pass.dependencies = {scene, probed};
        pass.write = result;
        pass.execute = [this, &graph, scene](const rg::PassContext& ctx) {
            const TextureHandle depth = graph.depthTextureOf(scene);
            const TextureHandle gbuffer = graph.gbufferTextureOf(scene);
            const TextureHandle albedo = graph.albedoTextureOf(scene);
            if (depth == TextureHandle::Invalid || gbuffer == TextureHandle::Invalid || albedo == TextureHandle::Invalid
                || ctx.output == TextureHandle::Invalid) return;
            const u32 cur = frame_ & 1u;
            const GfxComputeBinding bindings[12] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storageRead(2, sdf_),
                GfxComputeBinding::storageRead(3, instances_),
                GfxComputeBinding::storageRead(4, pixels_),
                GfxComputeBinding::storageRead(5, radiance_[0]),
                GfxComputeBinding::depth(6, depth),
                GfxComputeBinding::sampled(7, gbuffer),
                GfxComputeBinding::sampled(8, albedo),
                GfxComputeBinding::sampled(9, probes_[cur]),
                GfxComputeBinding::sampled(10, ctx.input(0)),
                GfxComputeBinding::storageTexture(11, ctx.output),
            };
            device_.dispatchCompute(apply_, bindings, 12, (ctx.width + 7) / 8, (ctx.height + 7) / 8);
            ++frame_;
        };
        graph.addPass(std::move(pass));
    }
    return result;
}

}  // namespace esengine
