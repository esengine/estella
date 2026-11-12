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
DynamicGIStats g_stats;
}

const DynamicGIStats& dynamicGIStats() {
    return g_stats;
}

namespace {

constexpr u32 kInstanceVec4 = 20;
constexpr u32 kProbeSize = 8;
constexpr u32 kProbeTexels = 3;  // the vector that integrates a probe against a normal, one texel a colour channel

/// The header the SDK writes (sdk/src/gi/gpuScene.ts), by index.
enum Header : u32 {
    kDim = 0, kCell, kOriginX, kOriginY, kOriginZ, kReach, kInstances, kPixels,
    kSunX, kSunY, kSunZ, kSunOn, kSunR, kSunG, kSunB, kBias, kRange, kTolerance, kSkyR, kSkyG, kSkyB, kHit, kLevels, kLights,
    /// Levels 1 and 2, eight floats each: dim, cell, origin x y z, reach, offset, owner offset. Then the lights, sixteen floats each.
    kLevelBlock = 24, kLightBlock = 40, kHeaderSize = 40,
    /// After the lights: how much fatter than its mesh the fattest body's field is.
    kGrowth = 40 + 8 * 16
};
constexpr u32 kMaxLevels = 3, kMaxLights = 8, kLightFloats = 16;

struct ParamsBlock {
    f32 sdf[4];
    i32 origin[4];
    u32 counts[4];
    f32 sunDir[4];
    f32 sunRad[4];
    f32 trace[4];
    f32 sky[4];
    f32 misc[4];
    i32 levelA[kMaxLevels][4];  // origin xyz, cells per axis
    f32 levelB[kMaxLevels][4];  // cell size, reach
    u32 levelC[kMaxLevels][4];  // where the field starts in the buffer, and its owner words
    f32 lights[kMaxLights * 4][4];
};
static_assert(sizeof(ParamsBlock) == 128 + 3 * 48 + 512, "the GI block: eight vec4s, three levels, eight lights of four");

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
    sdf : vec4f,       // x: levels of the field, y: lights, w: intensity
    origin : vec4i,    // w: the frame
    counts : vec4u,    // x: instances, y: card pixels, z: probe tiles x, w: probe tiles y
    sunDir : vec4f,    // xyz: toward the sun; w: 1 when there is one
    sunRad : vec4f,    // rgb: radiance; w: how far off a surface a ray starts
    trace : vec4f,     // x: how far a ray looks, y: card tolerance, z: blend, w: hit fraction of a cell
    sky : vec4f,       // rgb: what a ray that meets nothing brings
    misc : vec4f,      // x: how many frames the cards are spread over; y: 1 of every this many rays of a probe is traced a frame; z: pixels between probes; w: how much fatter than its mesh a body's field is
    levelA : array<vec4i, 3>,   // per level: the first cell of its window, cells per axis
    levelB : array<vec4f, 3>,   // per level: cell size, reach
    levelC : array<vec4u, 3>,   // per level: where its field starts in sdfData, and its owner words
    lights : array<vec4f, 32>,  // eight lights of four: position and reach | colour and kind | aim and falloff | inner radius and cone cosines
};
@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<uniform> gi : GI;
@group(0) @binding(2) var<storage, read> sdfData : array<f32>;
@group(0) @binding(3) var<storage, read> insts : array<vec4f>;
@group(0) @binding(4) var<storage, read> cardPix : array<vec4u>;
@group(0) @binding(5) var<storage, read> radIn : array<vec4f>;

const PI : f32 = 3.14159265;

fn cellValue(l : u32, c : vec3i) -> f32 {
    let d = gi.levelA[l].w;
    let w = c & vec3i(d - 1);
    return sdfData[gi.levelC[l].x + u32(w.x + w.y * d + w.z * d * d)];
}
fn sdfSample(l : u32, p : vec3f) -> f32 {
    let g = p / gi.levelB[l].x - vec3f(0.5);
    let i0 = vec3i(floor(g));
    let f = g - vec3f(i0);
    let c000 = cellValue(l, i0);
    let c100 = cellValue(l, i0 + vec3i(1, 0, 0));
    let c010 = cellValue(l, i0 + vec3i(0, 1, 0));
    let c110 = cellValue(l, i0 + vec3i(1, 1, 0));
    let c001 = cellValue(l, i0 + vec3i(0, 0, 1));
    let c101 = cellValue(l, i0 + vec3i(1, 0, 1));
    let c011 = cellValue(l, i0 + vec3i(0, 1, 1));
    let c111 = cellValue(l, i0 + vec3i(1, 1, 1));
    return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y), mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}
// The finest level whose window holds p at least a cell from its edge, or -1.
fn levelAt(p : vec3f) -> i32 {
    for (var l = 0u; l < u32(gi.sdf.x); l = l + 1u) {
        let c = p / gi.levelB[l].x - vec3f(gi.levelA[l].xyz);
        if (all(c >= vec3f(1.0)) && all(c <= vec3f(f32(gi.levelA[l].w) - 1.0))) { return i32(l); }
    }
    return -1;
}
// Distance along dir to the first surface within maxT, or -1. A ray that starts inside a body hits at 0. It walks the finest level
// that holds it and hands over to a coarser one where the finer ends.
fn sdfTrace(origin : vec3f, dir : vec3f, maxT : f32) -> f32 {
    var t = 0.0;
    for (var i = 0; i < 160; i = i + 1) {
        if (t >= maxT) { return -1.0; }
        let p = origin + dir * t;
        let li = levelAt(p);
        if (li < 0) { return -1.0; }
        let l = u32(li);
        let cell = gi.levelB[l].x;
        // Far from anything (the cell the point is in says so by more than three cells) one read is enough: the field there, less the
        // farthest a point can be from its cell centre, is a distance nothing is nearer than. Close to a surface the 8 reads of a trilinear.
        let near = cellValue(l, vec3i(floor(p / cell)));
        if (near > cell * 3.0) { t = t + near - cell * 0.87; continue; }
        let d = sdfSample(l, p);
        if (d < cell * gi.trace.w) { return t; }
        t = t + max(d, cell * 0.25);
    }
    return -1.0;
}
// Where a ray from a surface point may start. Lifted off its own surface the point can still be inside what a trace calls a hit of ANOTHER
// surface (a wall the next wall over meets: the corner of a room), and every ray from there would hit at 0 and bring nothing, which is a
// black band along every edge of the room, as wide as the cell is coarse. It is moved out along the field's slope until it is clear.
fn clearOrigin(o : vec3f, seen : bool) -> vec3f {
    var p = o;
    for (var i = 0; i < 3; i = i + 1) {
        let li = levelAt(p);
        if (li < 0) { return p; }
        let l = u32(li);
        let cell = gi.levelB[l].x;
        let want = cell * (gi.trace.w + 0.25);
        let d = sdfSample(l, p);
        if (d >= want) { return p; }
        // Under the surface of another body (a card pixel of a wall's end, buried in the wall it meets): left where it is, to bring nothing.
        // Moved out it would come up on whichever side is nearer, the lit outside of a sealed room among them, and the room would leak.
        // A point the eye sees (`seen`: a screen probe) is under nothing, whatever the field says of it a tenth of a cell from a wall.
        if (!seen && i == 0 && d < cell * 0.1 - gi.misc.w) { return p; }
        let h = cell * 0.5;
        let g = vec3f(sdfSample(l, p + vec3f(h, 0.0, 0.0)) - sdfSample(l, p - vec3f(h, 0.0, 0.0)),
                      sdfSample(l, p + vec3f(0.0, h, 0.0)) - sdfSample(l, p - vec3f(0.0, h, 0.0)),
                      sdfSample(l, p + vec3f(0.0, 0.0, h)) - sdfSample(l, p - vec3f(0.0, 0.0, h)));
        let len = length(g);
        if (len < 1e-6) { return p; }
        p = p + g / len * (want - d);
    }
    return p;
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

// What the cards of one instance say a ray brings back from the surface it hit at point, travelling along dir: the cards that face it,
// blended by how squarely each does, from the pixel whose surface is within the tolerance of the point. w is how far that pixel is, or
// -1 when no card of the instance holds the point.
fn lookupIn(i : u32, point : vec3f, dir : vec3f, tol : f32) -> vec4f {
    let b = instBase(i);
    let wmin = insts[b + 7u];
    let wmax = insts[b + 8u];
    if (any(point < wmin.xyz - vec3f(tol)) || any(point > wmax.xyz + vec3f(tol))) { return vec4f(0.0, 0.0, 0.0, -1.0); }
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
    if (total <= 0.0) { return vec4f(0.0, 0.0, 0.0, -1.0); }
    return vec4f(sum / total, error);
}

// Which instance a cell of a level is nearest to (id + 1; 0 for none, 127 for an id the table cannot hold). The words after the field hold four each.
fn ownerAt(l : u32, c : vec3i) -> u32 {
    let d = gi.levelA[l].w;
    let w = c & vec3i(d - 1);
    let idx = u32(w.x + w.y * d + w.z * d * d);
    return (bitcast<u32>(sdfData[gi.levelC[l].y + (idx >> 2u)]) >> ((idx & 3u) * 8u)) & 127u;
}

// What a ray brings back from the surface it hit at point. The field names the instance the point is by, so the cards of that one are
// asked; only where it says none (or its cards do not hold the point) are all of them, and of those the nearest wins. A hit found in a
// coarse level is a cell of that level off the surface, and the cards are asked to forgive as much.
fn lookup(point : vec3f, dir : vec3f) -> vec3f {
    let l = u32(max(levelAt(point), 0));
    let cell = gi.levelB[l].x;
    let tol = max(gi.trace.y, cell * 1.5);
    let owner = ownerAt(l, vec3i(floor(point / cell)));
    if (owner > 0u && owner < 127u && owner <= gi.counts.x) {
        let r = lookupIn(owner - 1u, point, dir, tol);
        if (r.w >= 0.0) { return r.xyz; }
    }
    var best = vec3f(0.0);
    var bestError = 1e30;
    for (var i = 0u; i < gi.counts.x; i = i + 1u) {
        let r = lookupIn(i, point, dir, tol);
        if (r.w >= 0.0 && r.w < bestError) { bestError = r.w; best = r.xyz; }
    }
    return best;
}

// The frame falloff of a light over a distance (distanceFalloff in ShaderParser.cpp): held at full to the inner radius, ramped to the reach
// raised to the power fy; or, for fy < 0, 1 / d^2 in metres (-fy world units to one) let go over the reach.
fn lightFalloff(dist : f32, reach : f32, inner : f32, fy : f32) -> f32 {
    let ramp = clamp((reach - dist) / max(reach - inner, 1e-4), 0.0, 1.0);
    let shaped = pow(ramp, max(fy, 1e-3));
    let metres = dist / max(-fy, 1e-4);
    let q = dist / max(reach, 1e-4);
    let w = clamp(1.0 - q * q * q * q, 0.0, 1.0);
    return select(shaped, w * w / max(metres * metres, 0.01), fy < 0.0);
}

// What the point and spot lights give a surface at pos facing n, shadowed by the field: each is a ray from just off the surface to the light.
fn lightsDirect(pos : vec3f, n : vec3f, origin : vec3f) -> vec3f {
    var sum = vec3f(0.0);
    for (var i = 0u; i < u32(gi.sdf.y); i = i + 1u) {
        let a = gi.lights[i * 4u]; let b = gi.lights[i * 4u + 1u]; let c = gi.lights[i * 4u + 2u]; let d = gi.lights[i * 4u + 3u];
        let to = a.xyz - pos;
        let dist = length(to);
        if (dist < 1e-4 || dist >= a.w) { continue; }
        let dir = to / dist;
        let ndl = dot(n, dir);
        if (ndl <= 0.0) { continue; }
        var atten = lightFalloff(dist, a.w, d.x, c.w);
        if (b.w > 1.5) { atten = atten * smoothstep(d.z, d.y, dot(c.xyz, -dir)); }
        if (atten <= 0.0) { continue; }
        let t = sdfTrace(origin, dir, max(dist - gi.sunRad.w, 0.0));
        if (t < 0.0) { sum = sum + b.xyz * atten * ndl; }
    }
    return sum;
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

// One workgroup relights one card pixel: its 64 threads are the 64 rays (one a thread, so the GPU is kept busy where one thread tracing
// 64 in turn left it waiting on its own chain of reads), reduced in shared memory. Only a slice of the cards is relit each frame, round
// robin. The cards are updated in place (a ray that reads a card another workgroup is rewriting sees the old or the new light, either
// of which is a frame of the right answer), so radIn is declared read-write here.
const char* kCardLight = R"WGSL(
var<workgroup> cardSum : array<vec3f, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_index) lid : u32) {
    let slices = max(u32(gi.misc.x), 1u);
    let chunk = (gi.counts.y + slices - 1u) / slices;
    let settled = gi.origin.w >= 2;
    let start = select(0u, (u32(gi.origin.w) % slices) * chunk, settled);
    let end = select(gi.counts.y, min(start + chunk, gi.counts.y), settled);
    let p = start + wg.x + wg.y * 65535u;
    if (p >= end) { return; }
    let pix = cardPix[p];
    let depth16 = pix.x & 0xffffu;
    if (depth16 == 65535u) { if (lid == 0u) { radIn[p] = vec4f(0.0); } return; }
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
    let origin = clearOrigin(pos + n * gi.sunRad.w, false);
    let d = probeRay(lid & 7u, lid >> 3u, n, p, u32(gi.origin.w));
    cardSum[lid] = rayRadiance(origin, d) * dot(d, n);
    workgroupBarrier();
    for (var s = 32u; s > 0u; s = s >> 1u) {
        if (lid < s) { cardSum[lid] = cardSum[lid] + cardSum[lid + s]; }
        workgroupBarrier();
    }
    if (lid != 0u) { return; }
    let albedo = unpackColour(pix.y >> 8u);
    let emissive = unpackColour(pix.z) * insts[b + 9u].w;
    var direct = vec3f(0.0);
    if (gi.sunDir.w > 0.5) {
        let ndl = dot(n, gi.sunDir.xyz);
        if (ndl > 0.0 && sdfTrace(origin, gi.sunDir.xyz, gi.trace.x) < 0.0) { direct = gi.sunRad.xyz * ndl; }
    }
    direct = direct + lightsDirect(pos, n, origin);
    let now = albedo * (direct + cardSum[0] * (2.0 / 64.0)) + emissive;
    // A card is relit once in `slices` frames, so each relight carries that much more of the change.
    let blend = select(min(gi.trace.z * f32(slices), 1.0), 1.0, !settled);
    radIn[p] = vec4f(mix(radIn[p].xyz, now, blend), 1.0);
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
@group(0) @binding(10) var probeGeo : texture_storage_2d<rgba32float, write>;

// A probe's normal in two numbers (octahedral), for the history: see where it is read.
fn packHistNormal(n : vec3f) -> vec2f {
    let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
    if (n.z >= 0.0) { return p; }
    return (vec2f(1.0) - abs(p.yx)) * vec2f(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
}
fn histNormal(x : f32, y : f32) -> vec3f {
    var n = vec3f(x, y, 1.0 - abs(x) - abs(y));
    let t = max(-n.z, 0.0);
    n.x = n.x + select(t, -t, n.x >= 0.0); n.y = n.y + select(t, -t, n.y >= 0.0);
    return normalize(n);
}
var<workgroup> shR : array<vec3f, 64>;
var<workgroup> shG : array<vec3f, 64>;
var<workgroup> shB : array<vec3f, 64>;

@compute @workgroup_size(8, 8)
fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_id) lid3 : vec3u, @builtin(local_invocation_index) lid : u32) {
    let size = vec2i(textureDimensions(depthTex));
    let spacing = i32(gi.misc.z);
    let t = min(vec2i(wg.xy) * spacing + vec2i(spacing / 2), size - vec2i(1));
    let depth = textureLoad(depthTex, t, 0);
    let g = textureLoad(gbuffer, t, 0);
    let valid = depth < 1.0 && g.a > 0.7;
    var contribution = array<vec3f, 3>(vec3f(0.0), vec3f(0.0), vec3f(0.0));
    var eyeDistance = 0.0;
    var probePos = vec3f(0.0);
    var probeNormal = vec3f(0.0, 1.0, 0.0);
    if (valid) {
        var n = decodeNormal(g);
        let pos = worldFromDepth((vec2f(t) + 0.5) / vec2f(size), depth);
        if (dot(n, viewDirection(pos)) < 0.0) { n = -n; }
        eyeDistance = length(pos - frame.camera.xyz);
        probePos = pos;
        probeNormal = n;
        // One ray in `stride` of the 64 is traced this frame, the cells alternating like a checkerboard from frame to frame.
        let stride = max(u32(gi.misc.y), 1u);
        if (((lid3.x + lid3.y * 3u + u32(gi.origin.w)) % stride) == 0u) {
            let d = probeRay(lid3.x, lid3.y, n, wg.x + wg.y * gi.counts.z, u32(gi.origin.w));
            let L = rayRadiance(clearOrigin(pos + n * gi.sunRad.w, true), d);
            contribution = array<vec3f, 3>(d * L.x * f32(stride), d * L.y * f32(stride), d * L.z * f32(stride));
        }
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
        // And the probes round it agree with it where they stand on the same surface (as far from the eye, facing the same way: the normal
        // is kept in the w of the other two texels). What is mixed in is the last frame of the nine, the middle one counting for most: 32
        // rays a frame toward a sun patch a few of them find is grain a probe wide, and the neighbours are the rays it did not trace.
        let hr = textureLoad(probeHist, base, 0);
        if (valid && hr.w > 0.0 && abs(hr.w - eyeDistance) < 0.02 * eyeDistance && gi.origin.w > 1) {
            var hR = vec3f(0.0); var hG = vec3f(0.0); var hB = vec3f(0.0); var hW = 0.0;
            for (var oy = -1; oy <= 1; oy = oy + 1) {
                for (var ox = -1; ox <= 1; ox = ox + 1) {
                    let tx = i32(wg.x) + ox; let ty = i32(wg.y) + oy;
                    if (tx < 0 || ty < 0 || tx >= i32(gi.counts.z) || ty >= i32(gi.counts.w)) { continue; }
                    let nb = vec2i(tx * 3, ty);
                    let r = textureLoad(probeHist, nb, 0);
                    let g2 = textureLoad(probeHist, nb + vec2i(1, 0), 0);
                    let b2 = textureLoad(probeHist, nb + vec2i(2, 0), 0);
                    if (r.w <= 0.0 || abs(r.w - eyeDistance) > 0.03 * eyeDistance) { continue; }
                    let facing = dot(histNormal(g2.w, b2.w), probeNormal);
                    if (facing < 0.95) { continue; }
                    let w = select(0.3, 1.0, ox == 0 && oy == 0);
                    hR = hR + r.xyz * w; hG = hG + g2.xyz * w; hB = hB + b2.xyz * w; hW = hW + w;
                }
            }
            let a = gi.trace.z;
            // None agrees, the probe's own last frame among them (its normal changed: it stands on an edge), and there is nothing to mix.
            if (hW > 0.0) { vr = mix(hR / hW, vr, a); vg = mix(hG / hW, vg, a); vb = mix(hB / hW, vb, a); }
        }
        // Where the probe stands and which way it faces, for the pixels that take its light: stored once here, so that the apply does not read the
        // depth and the G-buffer and rebuild a world position for each probe it looks at, for every pixel.
        textureStore(probeGeo, vec2i(i32(wg.x) * 2, i32(wg.y)), vec4f(probePos, eyeDistance));
        textureStore(probeGeo, vec2i(i32(wg.x) * 2 + 1, i32(wg.y)), vec4f(probeNormal, select(0.0, 1.0, valid)));
        textureStore(probeOut, base, vec4f(vr, eyeDistance));
        let packedN = packHistNormal(probeNormal);
        textureStore(probeOut, base + vec2i(1, 0), vec4f(vg, packedN.x));
        textureStore(probeOut, base + vec2i(2, 0), vec4f(vb, packedN.y));
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
@group(0) @binding(12) var probeGeo : texture_2d<f32>;

// What one probe says about the pixel at pos facing n: its light by the normal, and how much it should count (plane, then normal).
fn probeTerm(tile : vec2i, q : vec2f, radius : f32, pos : vec3f, n : vec3f, eye : f32, e : ptr<function, vec3f>, own : ptr<function, vec3f>, w : ptr<function, vec2f>) -> bool {
    let geo1 = textureLoad(probeGeo, vec2i(tile.x * 2 + 1, tile.y), 0);
    if (geo1.w < 0.5) { return false; }
    let d = abs(vec2f(tile) - q);
    let tent = max(1.0 - d.x / radius, 0.0) * max(1.0 - d.y / radius, 0.0);
    if (tent <= 0.0) { return false; }
    let geo0 = textureLoad(probeGeo, vec2i(tile.x * 2, tile.y), 0);
    let plane = abs(dot(n, geo0.xyz - pos)) / (0.02 * eye);
    let wPlane = tent / (1.0 + plane * plane);
    let wNormal = pow(max(dot(geo1.xyz, n), 0.0), 4.0);
    let base = vec2i(tile.x * 3, tile.y);
    let vr = textureLoad(probes, base, 0).xyz;
    let vg = textureLoad(probes, base + vec2i(1, 0), 0).xyz;
    let vb = textureLoad(probes, base + vec2i(2, 0), 0).xyz;
    *e = max(vec3f(dot(vr, n), dot(vg, n), dot(vb, n)), vec3f(0.0));
    // What the probe gets itself, for a pixel whose own normal no probe agrees with: a pixel on the edge two walls share, where the
    // resolved G-buffer holds a normal that is neither wall's and may face along both.
    *own = max(vec3f(dot(vr, geo1.xyz), dot(vg, geo1.xyz), dot(vb, geo1.xyz)), vec3f(0.0));
    *w = vec2f(wPlane * wNormal, wPlane);
    return true;
}

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
    // The probes round the pixel: probe (tx, ty) stands at pixel (tx * spacing + spacing / 2, ...). The four nearest are asked first (a pixel
    // in the open has all it needs there); only where they are on another plane or face another way, as at the corner of two walls, are the
    // twelve beyond them.
    let spacing = i32(gi.misc.z);
    let q = (vec2f(p) - vec2f(f32(spacing / 2))) / f32(spacing);
    let q0 = vec2i(floor(q));
    let eye = max(length(pos - frame.camera.xyz), 1.0);
    var E = vec3f(0.0);
    var total = 0.0;
    var Erelaxed = vec3f(0.0);
    var totalRelaxed = 0.0;
    // The four nearest with a bilinear weight, which is nothing at a tile's far edge: that the weights go to zero exactly where the set of
    // probes changes is what keeps the picture from showing the probe grid as squares. Only where those four are on another plane or face
    // another way (the corner of two walls) are the sixteen round them asked, with a wider tent.
    for (var k = 0; k < 4; k = k + 1) {
        let tile = q0 + vec2i(k & 1, k >> 1);
        if (any(tile < vec2i(0)) || any(tile >= tiles)) { continue; }
        var e = vec3f(0.0);
        var w = vec2f(0.0);
        var own = vec3f(0.0);
        if (!probeTerm(tile, q, 1.0, pos, n, eye, &e, &own, &w)) { continue; }
        E = E + e * w.x;
        total = total + w.x;
        Erelaxed = Erelaxed + own * w.y;
        totalRelaxed = totalRelaxed + w.y;
    }
    if (total <= 0.15) {
        E = vec3f(0.0);
        total = 0.0;
        Erelaxed = vec3f(0.0);
        totalRelaxed = 0.0;
        for (var k = 0; k < 16; k = k + 1) {
            let tile = q0 + vec2i(k & 3, k >> 2) - vec2i(1);
            if (any(tile < vec2i(0)) || any(tile >= tiles)) { continue; }
            var e = vec3f(0.0);
            var w = vec2f(0.0);
        var own = vec3f(0.0);
            if (!probeTerm(tile, q, 1.6, pos, n, eye, &e, &own, &w)) { continue; }
            E = E + e * w.x;
            total = total + w.x;
            Erelaxed = Erelaxed + own * w.y;
            totalRelaxed = totalRelaxed + w.y;
        }
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

/// The card relight writes the cards it reads (one buffer, updated in place): the common block declares them read-only.
std::string readWriteCards(std::string s) {
    const std::string from = "var<storage, read> radIn";
    const size_t at = s.find(from);
    if (at != std::string::npos) s.replace(at, from.size(), "var<storage, read_write> radIn");
    return s;
}

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
    if (probeGeo_ != TextureHandle::Invalid) device_.deleteTexture(probeGeo_);
    probeGeo_ = TextureHandle::Invalid;
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
    return make(cardLight_, readWriteCards(join(kCommon, kCardLight)), "card light") && make(probe_, join(kCommon, kSurface, kProbe), "probe")
        && make(apply_, join(kCommon, kSurface, kApply), "apply");
}

bool DynamicGI::upload() {
    DynamicGIScene& s = dynamicGIScene();
    if (s.header.size() < kHeaderSize || s.sdf.empty() || s.instances.empty() || s.pixels.empty()) return false;
    if (s.version == uploadedVersion_) return true;
    // A camera moved: only the range of the field that was rewritten goes over. The cards, the instances and the light the cards hold stay as they
    // are (a whole upload zeroes the light and starts the bounces again from the first, which a moving camera would see as a pop every step).
    if (!s.full && sdf_ != BufferHandle::Invalid && sdfBytes_ == std::max(static_cast<u32>(s.sdf.size() * 4), 16u) && s.dirtyEnd <= s.sdf.size()) {
        if (s.dirtyEnd > s.dirtyBegin) device_.updateBuffer(sdf_, s.dirtyBegin * 4u, s.sdf.data() + s.dirtyBegin, (s.dirtyEnd - s.dirtyBegin) * 4u);
        s.dirtyBegin = s.dirtyEnd = 0;
        uploadedVersion_ = s.version;
        return true;
    }
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
    // The radiance the cards hold: 16 bytes a pixel, zeroed again on a new scene.
    const u32 radianceBytes = std::max(pixelCount_ * 16u, 16u);
    if (radianceBytes != radianceBytes_ || radiance_[0] == BufferHandle::Invalid) {
        if (radiance_[0] != BufferHandle::Invalid) device_.deleteBuffer(radiance_[0]);
        radiance_[0] = device_.createBuffer({GfxBufferUsage::Storage, radianceBytes, false}, GfxContent::transient(), nullptr);
        radianceBytes_ = radianceBytes;
        if (radiance_[0] == BufferHandle::Invalid) { failed_ = true; return false; }
    }
    std::vector<f32> zero(radianceBytes / 4, 0.0f);
    device_.updateBuffer(radiance_[0], 0, zero.data(), radianceBytes);
    frame_ = 0;
    uploadedVersion_ = s.version;
    s.full = false;
    s.dirtyBegin = s.dirtyEnd = 0;
    return true;
}

bool DynamicGI::ensureProbes(u32 tilesX, u32 tilesY) {
    if (probes_[0] != TextureHandle::Invalid && probeTilesX_ == tilesX && probeTilesY_ == tilesY) return true;
    for (TextureHandle& t : probes_) {
        if (t != TextureHandle::Invalid) device_.deleteTexture(t);
        t = TextureHandle::Invalid;
    }
    if (probeGeo_ != TextureHandle::Invalid) device_.deleteTexture(probeGeo_);
    probeGeo_ = TextureHandle::Invalid;
    TextureDesc desc;
    desc.width = tilesX * kProbeTexels;
    desc.height = tilesY;
    desc.format = GfxPixelFormat::RGBA16F;
    desc.minFilter = desc.magFilter = TextureFilter::Nearest;
    desc.storage = true;
    for (TextureHandle& t : probes_) t = device_.createTexture(desc, GfxContent::transient(), nullptr);
    // Where each probe stands and which way it faces: full floats, a position is more than a half can hold.
    TextureDesc geo;
    geo.width = tilesX * 2;
    geo.height = tilesY;
    geo.format = GfxPixelFormat::RGBA32F;
    geo.minFilter = geo.magFilter = TextureFilter::Nearest;
    geo.storage = true;
    probeGeo_ = device_.createTexture(geo, GfxContent::transient(), nullptr);
    if (probes_[0] == TextureHandle::Invalid || probes_[1] == TextureHandle::Invalid || probeGeo_ == TextureHandle::Invalid) {
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
    if (params.skip & 8u) return input;  // measuring: nothing declared at all
    // About 160 x 90 probes whatever the size of the picture: 8 pixels apart at 720p, 12 at 1080p, 16 at 1440p. Their cost is in their number.
    // On a phone half as many rows: the pass costs per probe (a workgroup of 64 rays and its reduction) and a phone has the most pixels
    // and the least to spend, 11 ms of a 23 on a Snapdragon 8 Elite at 160 x 90 probes against 3 at half of that along each axis.
#if defined(__ANDROID__)
    constexpr u32 kProbeRows = 45;
#else
    constexpr u32 kProbeRows = 90;
#endif
    probeSpacing_ = params.probeSpacing > 0 ? std::clamp(params.probeSpacing, 4u, 64u)
                                            : std::clamp(((height + kProbeRows - 1) / kProbeRows + 1) / 2 * 2, 8u, 32u);
    const u32 tilesX = (width + probeSpacing_ - 1) / probeSpacing_, tilesY = (height + probeSpacing_ - 1) / probeSpacing_;
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
        const u32 levels = std::clamp(static_cast<u32>(h[kLevels]), 1u, kMaxLevels);
        const u32 lights = std::min(static_cast<u32>(h[kLights]), kMaxLights);
        b.sdf[0] = static_cast<f32>(levels); b.sdf[1] = static_cast<f32>(lights); b.sdf[3] = p.intensity;
        b.origin[3] = static_cast<i32>(frame_);
        // Level 0 is the header's own fields; its field starts the buffer and its owner words follow it.
        const u32 dim0 = static_cast<u32>(h[kDim]);
        b.levelA[0][0] = static_cast<i32>(h[kOriginX]); b.levelA[0][1] = static_cast<i32>(h[kOriginY]); b.levelA[0][2] = static_cast<i32>(h[kOriginZ]);
        b.levelA[0][3] = static_cast<i32>(dim0);
        b.levelB[0][0] = h[kCell]; b.levelB[0][1] = h[kReach];
        b.levelC[0][0] = 0; b.levelC[0][1] = dim0 * dim0 * dim0;
        for (u32 k = 1; k < levels; ++k) {
            const u32 at = kLevelBlock + (k - 1) * 8;
            b.levelA[k][0] = static_cast<i32>(h[at + 2]); b.levelA[k][1] = static_cast<i32>(h[at + 3]); b.levelA[k][2] = static_cast<i32>(h[at + 4]);
            b.levelA[k][3] = static_cast<i32>(h[at]);
            b.levelB[k][0] = h[at + 1]; b.levelB[k][1] = h[at + 5];
            b.levelC[k][0] = static_cast<u32>(h[at + 6]); b.levelC[k][1] = static_cast<u32>(h[at + 7]);
        }
        for (u32 i = 0; i < lights; ++i) {
            for (u32 v = 0; v < 4; ++v) for (u32 c = 0; c < 4; ++c) b.lights[i * 4 + v][c] = h[kLightBlock + i * kLightFloats + v * 4 + c];
        }
        b.counts[0] = static_cast<u32>(h[kInstances]); b.counts[1] = static_cast<u32>(h[kPixels]);
        b.counts[2] = probeTilesX_; b.counts[3] = probeTilesY_;
        b.sunDir[0] = h[kSunX]; b.sunDir[1] = h[kSunY]; b.sunDir[2] = h[kSunZ]; b.sunDir[3] = h[kSunOn];
        b.sunRad[0] = h[kSunR]; b.sunRad[1] = h[kSunG]; b.sunRad[2] = h[kSunB]; b.sunRad[3] = h[kBias];
        b.trace[0] = h[kRange]; b.trace[1] = h[kTolerance]; b.trace[2] = std::clamp(p.blend, 0.01f, 1.0f); b.trace[3] = h[kHit];
        b.sky[0] = h[kSkyR]; b.sky[1] = h[kSkyG]; b.sky[2] = h[kSkyB];
        b.misc[0] = static_cast<f32>(std::clamp(p.cardSlices, 1u, 4096u)); b.misc[1] = static_cast<f32>(std::clamp(p.probeStride, 1u, 8u));
        b.misc[2] = static_cast<f32>(probeSpacing_);
        b.misc[3] = h.size() > kGrowth ? h[kGrowth] : 0.0f;
        device_.updateBuffer(params_, 0, &b, sizeof(b));
    };

    const rg::ResourceId lit = graph.createTarget(token);
    {
        rg::PassDesc pass;
        pass.name = "dgi_cards";
        pass.compute = true;
        pass.dependencies = {scene};
        pass.write = lit;
        pass.execute = [this, writeParams, p](const rg::PassContext&) {
            writeParams();
            const GfxComputeBinding bindings[6] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storageRead(2, sdf_),
                GfxComputeBinding::storageRead(3, instances_),
                GfxComputeBinding::storageRead(4, pixels_),
                GfxComputeBinding::storage(5, radiance_[0]),
            };
            // One workgroup a card pixel to relight: all of them for the first frames, then one slice of them.
            const u32 slices = std::clamp(p.cardSlices, 1u, 4096u);
            const u32 chunk = (pixelCount_ + slices - 1) / slices;
            const u32 active = frame_ < 2 ? pixelCount_ : chunk;
            g_stats.cardPixels = static_cast<f32>(pixelCount_);
            g_stats.cardPixelsRelit = (p.skip & 1u) ? 0.0f : static_cast<f32>(active);
            g_stats.cardRays = g_stats.cardPixelsRelit * 64.0f;
            if (active == 0 || (p.skip & 1u)) return;
            device_.dispatchCompute(cardLight_, bindings, 6, std::min(active, 65535u), (active + 65534u) / 65535u);
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
        pass.execute = [this, &graph, scene, p](const rg::PassContext&) {
            g_stats.probes = static_cast<f32>(probeTilesX_ * probeTilesY_);
            g_stats.probeSpacing = static_cast<f32>(probeSpacing_);
            g_stats.probeRays = (p.skip & 2u) ? 0.0f : g_stats.probes * 64.0f / static_cast<f32>(std::max(p.probeStride, 1u));
            if (p.skip & 2u) return;
            const TextureHandle depth = graph.depthTextureOf(scene);
            const TextureHandle gbuffer = graph.gbufferTextureOf(scene);
            if (depth == TextureHandle::Invalid || gbuffer == TextureHandle::Invalid) return;
            // The cards were just written into the buffer the next frame reads: the probes see this frame's lighting.
            const BufferHandle cards = radiance_[0];
            const u32 cur = frame_ & 1u;
            const GfxComputeBinding bindings[11] = {
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
                GfxComputeBinding::storageTexture(10, probeGeo_),
            };
            device_.dispatchCompute(probe_, bindings, 11, probeTilesX_, probeTilesY_);
        };
        graph.addPass(std::move(pass));
    }

    if (params.skip & 16u) return input;  // measuring: the cards and the probes, and no apply pass nor the target it writes
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
        pass.execute = [this, &graph, scene, p](const rg::PassContext& ctx) {
            // A pixel reads the scene, the depth, the G-buffer and the albedo, and from each of the four nearest probes two geometry texels and three of light.
            g_stats.applyPixels = (p.skip & 4u) ? 0.0f : static_cast<f32>(ctx.width) * static_cast<f32>(ctx.height);
            g_stats.applyLoadsPerPixel = 4.0f + 4.0f * 5.0f;
            g_stats.width = static_cast<f32>(ctx.width);
            g_stats.height = static_cast<f32>(ctx.height);
            g_stats.forcedAttachmentBytes = static_cast<f32>(ctx.width) * static_cast<f32>(ctx.height) * 12.0f;
            g_stats.residentBytes = static_cast<f32>(sdfBytes_ + instanceBytes_ + pixelBytes_ + radianceBytes_)
                                    + static_cast<f32>(probeTilesX_) * static_cast<f32>(probeTilesY_) * (3.0f * 8.0f * 2.0f + 2.0f * 16.0f);
            const DynamicGIScene& sc = dynamicGIScene();
            g_stats.levels = sc.header.size() > kLevels ? sc.header[kLevels] : 0.0f;
            g_stats.lights = sc.header.size() > kLights ? sc.header[kLights] : 0.0f;
            g_stats.instances = sc.header.size() > kInstances ? sc.header[kInstances] : 0.0f;
            g_stats.frame = static_cast<f32>(frame_);
            if (p.skip & 4u) { ++frame_; return; }
            const TextureHandle depth = graph.depthTextureOf(scene);
            const TextureHandle gbuffer = graph.gbufferTextureOf(scene);
            const TextureHandle albedo = graph.albedoTextureOf(scene);
            if (depth == TextureHandle::Invalid || gbuffer == TextureHandle::Invalid || albedo == TextureHandle::Invalid
                || ctx.output == TextureHandle::Invalid) return;
            const u32 cur = frame_ & 1u;
            const GfxComputeBinding bindings[13] = {
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
                GfxComputeBinding::sampled(12, probeGeo_),
            };
            device_.dispatchCompute(apply_, bindings, 13, (ctx.width + 7) / 8, (ctx.height + 7) / 8);
            ++frame_;
        };
        graph.addPass(std::move(pass));
    }
    return result;
}

}  // namespace esengine
