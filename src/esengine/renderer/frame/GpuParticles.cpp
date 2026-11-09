// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./GpuParticles.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../../core/Log.hpp"
#include "../../ecs/components/ParticleEmitter.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../RenderOrigin.hpp"
#include "../../particle/ParticleSystem.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace esengine {

namespace {

// One record per live particle, exactly what the particle draw's instance attributes read (44 bytes).
constexpr u32 kInstanceBytes = 44;
// Position + age, velocity + lifetime, then start size, end size, rotation, angular velocity.
constexpr u32 kStateBytes = 48;

constexpr u32 kMaxFields = 8;
constexpr u32 kLutSize = particle::kColorLutSize;
static_assert(kLutSize == 32, "the kernel's LUT arrays are sized for 32 entries");

enum Flags : u32 {
    kReset = 1u << 0,
    kLocal = 1u << 1,
    kNoise = 1u << 2,
    kSizeLut = 1u << 3,
    kColorLut = 1u << 4,
    kSpeedLut = 1u << 5,
    kFloor = 1u << 6,
    kDepth = 1u << 7,
    kSdf = 1u << 8,
    kEmitBirth = 1u << 9,
    kEmitDeath = 1u << 10,
    kEmitHit = 1u << 11,
    kFed = 1u << 12,
    kTrail = 1u << 13,
};

// An event a kernel appends and another reads: where and which kind, how fast, and the surface it hit with the slot that hit it.
constexpr u32 kEventBytes = 48;
constexpr u32 kEventHeaderBytes = 16;
// The most events one emitter keeps of a frame. Past it they are dropped: a child would have nowhere to put so many anyway.
constexpr u32 kMaxEvents = 4096;
constexpr u32 kMaxColliders = 64;
static_assert(sizeof(particle::SdfColliderInstance) == 64, "the kernel's Collider is 64 bytes");
// The depth a frame leaves, at most this many texels across: a particle needs where a surface is, not its edges.
constexpr u32 kDepthGridMax = 640;

// Mirrors the kernel's `Params`: vec4s only, so the layout is the same in both languages with no padding to get wrong.
struct ParamsBlock {
    u32 p0[4];      // capacity, firstIndex, spawnCount, smoothCount
    u32 p1[4];      // seed, flags, shape, octaves
    f32 p2[4];      // dt, noiseTime, lifetimeMin, lifetimeMax
    f32 p3[4];      // speedMin, speedMax, startSizeMin, startSizeMax
    f32 p4[4];      // endSizeMin, endSizeMax, rotationMin, rotationMax
    f32 p5[4];      // angularVelocityMin, angularVelocityMax, gravity.x, gravity.y
    f32 p6[4];      // gravity.z, damping, noiseStrength, noiseFrequency
    f32 p7[4];      // noiseScroll.x, noiseScroll.y, shapeRadius, shapeHalfAngle
    f32 p8[4];      // shapeSize.xyz, sizeEasing
    f32 p9[4];      // aimMin, aimMax (radians), colorEasing, floorY
    f32 p10[4];     // bounce, friction, lifetimeLoss, spriteFPS
    u32 p11[4];     // spriteColumns, spriteRows, spriteLoop, fieldCount
    f32 startColor[4];
    f32 endColor[4];
    f32 origin[4];  // emitter position
    f32 scale[4];   // emitter scale
    f32 rot0[4], rot1[4], rot2[4];  // emitter rotation, one column each
    f32 local[4];   // cos, sin of the emitter's turn about Z; scale.x, scale.y
    f32 shift[4];   // the render origin, taken from each particle's world position as it is written for drawing
    f32 fields[kMaxFields * 3][4];
    f32 colorLut[kLutSize][4];
    f32 sizeLut[kLutSize / 4][4];
    f32 speedLut[kLutSize / 4][4];
    u32 p12[4];     // frame, eventCapacity, subBurst, colliderCount
    f32 p13[4];     // eventChance, inheritVelocity, thickness, depthValid
    u32 p14[4];     // trailPoints, collisionMask, depthGridW, depthGridH
    f32 p15[4];     // trailWidth, trailMinDistance, 0, 0
    f32 camera[4];  // the eye (w 1) or the way to the viewer (w 0), as the draw's vertex stage has it
    f32 depthClip[4][4], depthWorld[4][4];  // the view the depth was left by, and its inverse
    f32 depthOrigin[4];                     // the render origin it was seen from
};
static_assert(sizeof(ParamsBlock) == 107 * 16, "the kernel's Params is 107 vec4s");
constexpr u32 kJobStride = 2048;  // a uniform binding starts on a multiple of 256
static_assert(sizeof(ParamsBlock) <= kJobStride && kJobStride % 256 == 0);
constexpr u32 kMaxJobs = 64;

// In pieces: MSVC refuses one string literal past 16 KB, and takes adjacent ones to 64.
const char* const kKernel = R"WGSL(
struct State { pa: vec4<f32>, vl: vec4<f32>, ms: vec4<f32> };
struct Inst { px: f32, py: f32, pz: f32, sx: f32, sy: f32, rot: f32, color: u32, u0: f32, v0: f32, us: f32, vs: f32 };
struct Params {
    p0: vec4<u32>, p1: vec4<u32>,
    p2: vec4<f32>, p3: vec4<f32>, p4: vec4<f32>, p5: vec4<f32>, p6: vec4<f32>, p7: vec4<f32>,
    p8: vec4<f32>, p9: vec4<f32>, p10: vec4<f32>,
    p11: vec4<u32>,
    startColor: vec4<f32>, endColor: vec4<f32>,
    origin: vec4<f32>, scale: vec4<f32>,
    rot0: vec4<f32>, rot1: vec4<f32>, rot2: vec4<f32>,
    local: vec4<f32>,
    shift: vec4<f32>,
    fields: array<vec4<f32>, 24>,
    colorLut: array<vec4<f32>, 32>,
    sizeLut: array<vec4<f32>, 8>,
    speedLut: array<vec4<f32>, 8>,
    p12: vec4<u32>, p13: vec4<f32>, p14: vec4<u32>, p15: vec4<f32>,
    camera: vec4<f32>,
    depthClip: mat4x4<f32>, depthWorld: mat4x4<f32>,
    depthOrigin: vec4<f32>,
};
struct EventRec { at: vec4<f32>, vel: vec4<f32>, normal: vec4<f32> };
struct Events { count: atomic<u32>, head: u32, capacity: u32, pad: u32, rec: array<EventRec> };
struct EventsIn { count: u32, head: u32, capacity: u32, pad: u32, rec: array<EventRec> };
struct Collider { at: vec4<f32>, rot: vec4<f32>, ext: vec4<f32>, mask: vec4<u32> };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> states: array<State>;
@group(0) @binding(2) var<storage, read_write> insts: array<Inst>;
@group(0) @binding(3) var<storage, read_write> events: Events;
@group(0) @binding(4) var<storage, read> parentEvents: EventsIn;
@group(0) @binding(5) var<storage, read> depthGrid: array<f32>;
@group(0) @binding(6) var<storage, read> colliders: array<Collider>;
@group(0) @binding(7) var<storage, read_write> trail: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> segments: array<Inst>;

var<private> rng: u32;
var<private> hitPoint: vec3<f32>;
var<private> hitNormal: vec3<f32>;

fn pcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn rand() -> f32 {
    rng = pcg(rng);
    return f32(rng) * 2.3283064365386963e-10;
}
fn rr(a: f32, b: f32) -> f32 {
    if (a >= b) { return a; }
    return a + (b - a) * rand();
}

// --- the shapes: where a particle is born and which way it leaves (ParticleShapes.hpp) ---
fn coneDir(halfAngle: f32) -> vec3<f32> {
    let cosT = rr(cos(halfAngle), 1.0);
    let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    let phi = rr(0.0, 6.283185307179586);
    return vec3<f32>(sinT * cos(phi), cosT, sinT * sin(phi));
}
fn planarAim() -> vec3<f32> {
    let a = rr(P.p9.x, P.p9.y);
    return vec3<f32>(cos(a), sin(a), 0.0);
}

// --- curl noise (ParticleNoise.hpp): the same field the CPU sim advects along ---
fn hash2(x: i32, y: i32) -> f32 {
    var h = u32(x) * 374761393u + u32(y) * 668265263u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    h = h ^ (h >> 16u);
    return f32(h) * (1.0 / 4294967295.0);
}
fn grad2(x: i32, y: i32) -> vec2<f32> {
    let a = hash2(x, y) * 6.283185307179586;
    return vec2<f32>(cos(a), sin(a));
}
fn fade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn perlin2(p: vec2<f32>) -> f32 {
    let pi = floor(p);
    let pf = p - pi;
    let x0 = i32(pi.x);
    let y0 = i32(pi.y);
    let n00 = dot(grad2(x0, y0), pf - vec2<f32>(0.0, 0.0));
    let n10 = dot(grad2(x0 + 1, y0), pf - vec2<f32>(1.0, 0.0));
    let n01 = dot(grad2(x0, y0 + 1), pf - vec2<f32>(0.0, 1.0));
    let n11 = dot(grad2(x0 + 1, y0 + 1), pf - vec2<f32>(1.0, 1.0));
    let ux = fade(pf.x);
    let uy = fade(pf.y);
    return mix(mix(n00, n10, ux), mix(n01, n11, ux), uy);
}
fn fbm2(p: vec2<f32>, octaves: u32) -> f32 {
    var sum = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var norm = 0.0;
    let n = clamp(octaves, 1u, 8u);
    for (var i = 0u; i < n; i = i + 1u) {
        sum = sum + amp * perlin2(p * freq);
        norm = norm + amp;
        freq = freq * 2.0;
        amp = amp * 0.5;
    }
    if (norm > 0.0) { return sum / norm; }
    return 0.0;
}
fn curl(p: vec2<f32>, octaves: u32) -> vec2<f32> {
    let e = 0.1;
    let dpdx = fbm2(p + vec2<f32>(e, 0.0), octaves) - fbm2(p - vec2<f32>(e, 0.0), octaves);
    let dpdy = fbm2(p + vec2<f32>(0.0, e), octaves) - fbm2(p - vec2<f32>(0.0, e), octaves);
    return vec2<f32>(dpdy, -dpdx) * (0.25 / (2.0 * e));
}

fn ease(kind: f32, t: f32) -> f32 {
    if (kind > 2.5) { return select(-1.0 + (4.0 - 2.0 * t) * t, 2.0 * t * t, t < 0.5); }
    if (kind > 1.5) { return t * (2.0 - t); }
    if (kind > 0.5) { return t * t; }
    return t;
}

fn lutF(which: u32, t: f32) -> f32 {
    let f = clamp(t, 0.0, 1.0) * 31.0;
    let i = u32(f);
    let j = min(i + 1u, 31u);
    var a: f32;
    var b: f32;
    if (which == 0u) {
        a = P.sizeLut[i >> 2u][i & 3u];
        b = P.sizeLut[j >> 2u][j & 3u];
    } else {
        a = P.speedLut[i >> 2u][i & 3u];
        b = P.speedLut[j >> 2u][j & 3u];
    }
    return mix(a, b, f - f32(i));
}
fn lutC(t: f32) -> vec4<f32> {
    let f = clamp(t, 0.0, 1.0) * 31.0;
    let i = u32(f);
    let j = min(i + 1u, 31u);
    return mix(P.colorLut[i], P.colorLut[j], f - f32(i));
}

// A scene force field folded into a world-space particle's velocity (ParticleSystem.cpp applyForceField).
fn applyField(k: u32, pos: vec3<f32>, vel: vec3<f32>, dt: f32) -> vec3<f32> {
    let a = P.fields[k * 3u];
    let b = P.fields[k * 3u + 1u];
    let c = P.fields[k * 3u + 2u];
    let toField = a.xyz - pos;
    let distSq = dot(toField, toField);
    var factor = 1.0;
    if (c.x > 0.0) {
        if (distSq > c.x * c.x) { return vel; }
        if (c.y > 0.5) { factor = 1.0 - sqrt(distSq) / c.x; }
    }
    let strength = b.w;
    var v = vel;
    let kind = u32(a.w + 0.5);
    if (kind == 0u) {
        v = v + b.xyz * (strength * factor * dt);
    } else if (kind == 1u) {
        let d = sqrt(distSq);
        if (d > 1e-4) { v = v + (toField / d) * (strength * factor * dt); }
    } else if (kind == 2u) {
        let d = sqrt(distSq);
        if (d > 1e-4) {
            let radial = -toField / d;
            var axis = vec3<f32>(0.0, 0.0, 1.0);
            if (length(b.xyz) > 1e-6) { axis = normalize(b.xyz); }
            let perp = cross(axis, radial);
            let pl = length(perp);
            if (pl > 1e-6) { v = v + (perp / pl) * (strength * factor * dt); }
        }
    } else {
        v = v * (1.0 - min(strength * factor * dt, 1.0));
    }
    return v;
}

fn hide(i: u32) {
    insts[i] = Inst(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0.0, 0.0, 1.0, 1.0);
    if ((P.p1.y & 8192u) != 0u) {
        let n = P.p14.x - 1u;
        for (var j = 0u; j < n; j = j + 1u) {
            segments[i * n + j] = Inst(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0.0, 0.0, 1.0, 1.0);
        }
    }
}

)WGSL"
R"WGSL(
// --- events: what another emitter's kernel, or the game a frame or two later, is told ---
fn emitEvent(kind: f32, at: vec3<f32>, vel: vec3<f32>, normal: vec3<f32>, slot: u32) {
    if (P.p13.x < 1.0 && rand() >= P.p13.x) { return; }
    let k = atomicAdd(&events.count, 1u);
    if (k < P.p12.y) {
        events.rec[k] = EventRec(vec4<f32>(at, kind), vec4<f32>(vel, 0.0), vec4<f32>(normal, f32(slot)));
    }
}

// --- the depth the last frame left: reprojected with the camera that saw it, so a turning camera does not smear it ---
fn depthAt(tx: i32, ty: i32) -> f32 {
    let w = i32(P.p14.z);
    let h = i32(P.p14.w);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) { return 1.0; }
    return depthGrid[u32(ty * w + tx)];
}
fn unproject(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let world = P.depthWorld * vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    return world.xyz / world.w;
}
fn texelSurface(tx: i32, ty: i32, depth: f32) -> vec3<f32> {
    return unproject((vec2<f32>(f32(tx), f32(ty)) + 0.5) / vec2<f32>(f32(P.p14.z), f32(P.p14.w)), depth);
}
fn depthHit(point: vec3<f32>, vel: vec3<f32>, dt: f32) -> bool {
    let rel = point - P.depthOrigin.xyz;
    let clip = P.depthClip * vec4<f32>(rel, 1.0);
    if (clip.w <= 0.0) { return false; }
    let ndc = clip.xyz / clip.w;
    if (abs(ndc.x) >= 1.0 || abs(ndc.y) >= 1.0 || ndc.z < 0.0 || ndc.z > 1.0) { return false; }
    let uv = vec2<f32>((ndc.x + 1.0) * 0.5, (1.0 - ndc.y) * 0.5);
    let tx = i32(uv.x * f32(P.p14.z));
    let ty = i32(uv.y * f32(P.p14.w));
    let depth = depthAt(tx, ty);
    if (depth >= 1.0) { return false; }
    let ray = normalize(unproject(uv, 1.0) - unproject(uv, 0.0));
    let surface = texelSurface(tx, ty, depth);
    let behind = dot(rel - surface, ray);
    // A particle may cross more than the thickness in a step, and still have hit what it crossed.
    if (behind < 0.0 || behind > max(P.p13.z, length(vel) * dt)) { return false; }
    // The surface's slope from the texels beside it, each way from whichever is nearer: an edge belongs to what stands in front.
    var normal = -ray;
    let l = depthAt(tx - 1, ty);
    let r = depthAt(tx + 1, ty);
    let u = depthAt(tx, ty - 1);
    let d = depthAt(tx, ty + 1);
    let useR = abs(r - depth) <= abs(l - depth);
    let useD = abs(d - depth) <= abs(u - depth);
    let hx = select(l, r, useR);
    let hy = select(u, d, useD);
    if (hx < 1.0 && hy < 1.0) {
        let across = texelSurface(select(tx - 1, tx + 1, useR), ty, hx) - surface;
        let along = texelSurface(tx, select(ty - 1, ty + 1, useD), hy) - surface;
        let n = cross(across, along);
        let size = length(n);
        if (size > 1e-8) {
            normal = n / size;
            if (dot(normal, ray) > 0.0) { normal = -normal; }
        }
    }
    if (dot(vel, normal) >= 0.0) { return false; }
    hitNormal = normal;
    hitPoint = surface + P.depthOrigin.xyz + normal * (0.001 * P.p13.z);
    return true;
}

// --- the distance functions (ParticleSystem sdfDistance) ---
fn turnBack(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    let u = -q.xyz;
    return v + 2.0 * cross(u, cross(u, v) + q.w * v);
}
fn sdfOne(k: u32, point: vec3<f32>) -> f32 {
    let c = colliders[k];
    let q = turnBack(c.rot, point - c.at.xyz);
    var d: f32;
    if (c.at.w > 1.5) {
        let along = clamp(q.y, -c.ext.y, c.ext.y);
        d = length(vec3<f32>(q.x, q.y - along, q.z)) - c.ext.x;
    } else if (c.at.w > 0.5) {
        let over = abs(q) - c.ext.xyz;
        d = length(max(over, vec3<f32>(0.0))) + min(max(over.x, max(over.y, over.z)), 0.0);
    } else {
        d = length(q) - c.ext.x;
    }
    if (c.ext.w > 0.5) { return -d; }
    return d;
}
fn sdfHit(point: vec3<f32>, vel: vec3<f32>) -> bool {
    var least = 0.0;
    var found = P.p12.w;
    for (var k = 0u; k < P.p12.w; k = k + 1u) {
        if ((colliders[k].mask.x & P.p14.y) == 0u) { continue; }
        let d = sdfOne(k, point);
        if (d < least) { least = d; found = k; }
    }
    if (found == P.p12.w) { return false; }
    let e = max(0.01, -least * 0.1);
    let g = vec3<f32>(
        sdfOne(found, point + vec3<f32>(e, 0.0, 0.0)) - sdfOne(found, point - vec3<f32>(e, 0.0, 0.0)),
        sdfOne(found, point + vec3<f32>(0.0, e, 0.0)) - sdfOne(found, point - vec3<f32>(0.0, e, 0.0)),
        sdfOne(found, point + vec3<f32>(0.0, 0.0, e)) - sdfOne(found, point - vec3<f32>(0.0, 0.0, e)));
    let size = length(g);
    if (size < 1e-6) { return false; }
    let normal = g / size;
    if (dot(vel, normal) >= 0.0) { return false; }
    hitNormal = normal;
    hitPoint = point - normal * least;
    return true;
}

// --- trails: each piece of the path as a quad the particle draw already knows, turned to lie along it as seen ---
fn segmentBetween(a: vec3<f32>, b: vec3<f32>, width: f32, color: vec4<f32>) -> Inst {
    let mid = (a + b) * 0.5 - P.shift.xyz;
    var fwd = P.camera.xyz;
    if (P.camera.w > 0.5) { fwd = normalize(P.camera.xyz - mid); }
    var refUp = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(fwd.y) > 0.999) { refUp = vec3<f32>(0.0, 0.0, 1.0); }
    let right = normalize(cross(refUp, fwd));
    let up = cross(fwd, right);
    let d = b - a;
    let x = dot(d, right);
    let y = dot(d, up);
    return Inst(mid.x, mid.y, mid.z, sqrt(x * x + y * y), width, atan2(y, x), pack4x8unorm(color), 0.0, 0.0, 1.0, 1.0);
}
fn stepTrail(i: u32, head: vec3<f32>, born: bool, color: vec4<f32>) {
    let points = P.p14.x;
    let n = points - 1u;
    let base = i * points;
    var count = u32(trail[base].w);
    if (born || count == 0u) {
        trail[base] = vec4<f32>(head, 1.0);
        count = 1u;
    } else {
        let last = trail[base].xyz;
        if (distance(head, last) >= P.p15.y) {
            for (var k = n; k > 0u; k = k - 1u) { trail[base + k] = trail[base + k - 1u]; }
            count = min(count + 1u, points);
            trail[base] = vec4<f32>(head, f32(count));
        }
    }
    var prev = head;
    for (var j = 0u; j < n; j = j + 1u) {
        if (j >= count) {
            segments[i * n + j] = Inst(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0.0, 0.0, 1.0, 1.0);
            continue;
        }
        let next = trail[base + j].xyz;
        let fadeOut = 1.0 - (f32(j) + 0.5) / f32(n);
        segments[i * n + j] = segmentBetween(prev, next, P.p15.x * fadeOut, vec4<f32>(color.rgb, color.a * fadeOut));
        prev = next;
    }
}

)WGSL"
R"WGSL(
fn bornState(origin: vec3<f32>, inherit: vec3<f32>, world: bool) -> State {
    let life = rr(P.p2.z, P.p2.w);
    let startSize = rr(P.p3.z, P.p3.w);
    let endSize = rr(P.p4.x, P.p4.y);
    let rot = rr(P.p4.z, P.p4.w);
    let angVel = rr(P.p5.x, P.p5.y);

    var pos = vec3<f32>(0.0);
    var dir = vec3<f32>(0.0, 1.0, 0.0);
    let shape = P.p1.z;
    if (shape == 1u) {
        let angle = rr(0.0, 6.283185307179586);
        let radius = rr(0.0, P.p7.z);
        pos = vec3<f32>(cos(angle) * radius, sin(angle) * radius, 0.0);
        if (radius > 0.001) { dir = pos / radius; } else { dir = planarAim(); }
    } else if (shape == 2u) {
        let h = P.p8.xyz * 0.5;
        let x = rr(-h.x, h.x);
        let y = rr(-h.y, h.y);
        var z = 0.0;
        if (P.p8.z > 0.0) { z = rr(-h.z, h.z); }
        pos = vec3<f32>(x, y, z);
        dir = planarAim();
    } else if (shape == 3u) {
        dir = coneDir(P.p7.w);
        pos = coneDir(P.p7.w) * rr(0.0, P.p7.z);
    } else if (shape == 4u || shape == 5u) {
        var cap2 = 3.141592653589793;
        if (shape == 5u) { cap2 = 1.5707963267948966; }
        dir = coneDir(cap2);
        pos = coneDir(cap2) * (P.p7.z * pow(rr(0.0, 1.0), 1.0 / 3.0));
    } else {
        dir = planarAim();
    }
    let speed = rr(P.p3.x, P.p3.y);
    let R = mat3x3<f32>(P.rot0.xyz, P.rot1.xyz, P.rot2.xyz);
    var wpos: vec3<f32>;
    var wdir: vec3<f32>;
    if (!world) {
        wpos = origin + pos * P.scale.xyz;
        wdir = dir;
    } else {
        wpos = origin + R * (pos * P.scale.xyz);
        wdir = R * dir;
    }
    return State(vec4<f32>(wpos, 0.0), vec4<f32>(wdir * speed + inherit, max(life, 1e-4)), vec4<f32>(startSize, endSize, rot, angVel));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let cap = P.p0.x;
    let i = gid.x;
    if (i >= cap) { return; }
    let flags = P.p1.y;
    if ((flags & 1u) != 0u) {
        states[i] = State(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
        hide(i);
        return;
    }
    let local = (flags & 2u) != 0u;
    let R = mat3x3<f32>(P.rot0.xyz, P.rot1.xyz, P.rot2.xyz);
    let dt = P.p2.x;

    var st = states[i];
    var stepDt = dt;
    var born = false;
    rng = pcg(P.p1.x ^ (i * 2654435761u) ^ (P.p12.x * 40503u));

    // Born this step? Slot i holds the particle whose absolute index lands on it.
    let first = P.p0.y % cap;
    let rel = (i + cap - first) % cap;
    if (rel < P.p0.z) {
        rng = pcg(P.p1.x ^ ((P.p0.y + rel) * 2654435761u));
        var at = P.origin.xyz;
        if (local) { at = vec3<f32>(0.0); }
        st = bornState(at, vec3<f32>(0.0), !local);
        born = true;
        // Rate-born particles are spread across the step they were born in, so a fast emitter draws a line, not a row of clumps.
        if (rel < P.p0.w) { stepDt = dt * (1.0 - (f32(rel) + 0.5) / f32(P.p0.w)); }
    } else if ((flags & 4096u) != 0u) {
        // Or a parent's event lit it, each event its child's burst, from where the ring stopped last frame.
        let burst = max(P.p12.z, 1u);
        let lit = min(min(parentEvents.count, parentEvents.capacity) * burst, cap);
        let fromHead = (i + cap - events.head % cap) % cap;
        if (fromHead < lit) {
            let e = parentEvents.rec[fromHead / burst];
            rng = pcg(P.p1.x ^ ((events.head + fromHead) * 2654435761u) ^ (P.p12.x * 40503u));
            var at = e.at.xyz;
            var carried = e.vel.xyz * P.p13.y;
            if (local) { at = transpose(R) * (at - P.origin.xyz); carried = transpose(R) * carried; }
            st = bornState(at, carried, !local);
            born = true;
        }
    }
    if (!born && st.pa.w >= st.vl.w) {
        hide(i);
        return;
    }
    if (born && (flags & 512u) != 0u) {
        var bornAt = st.pa.xyz;
        var bornVel = st.vl.xyz;
        if (local) { bornAt = P.origin.xyz + R * bornAt; bornVel = R * bornVel; }
        emitEvent(1.0, bornAt, bornVel, vec3<f32>(0.0), i);
    }

    let life = st.vl.w;
    var age = st.pa.w + stepDt;
    if (age >= life) {
        st.pa.w = life;
        states[i] = st;
        if ((flags & 1024u) != 0u) {
            var deadAt = st.pa.xyz;
            var deadVel = st.vl.xyz;
            if (local) { deadAt = P.origin.xyz + R * deadAt; deadVel = R * deadVel; }
            emitEvent(0.0, deadAt, deadVel, vec3<f32>(0.0), i);
        }
        hide(i);
        return;
    }
    var pos = st.pa.xyz;
    var vel = st.vl.xyz;
    let t = age / life;

    vel = vel + vec3<f32>(P.p5.z, P.p5.w, P.p6.x) * stepDt;
    if (!local) {
        for (var k = 0u; k < P.p11.w; k = k + 1u) { vel = applyField(k, pos, vel, stepDt); }
    }
    if (P.p6.y > 0.0) { vel = vel * max(0.0, 1.0 - P.p6.y * stepDt); }
    var speedMul = 1.0;
    if ((flags & 32u) != 0u) { speedMul = lutF(1u, t); }
    pos = pos + vel * speedMul * stepDt;

    if ((flags & 4u) != 0u) {
        let flow = curl(pos.xy * P.p6.w + P.p7.xy, P.p1.w);
        pos = pos + vec3<f32>(flow, 0.0) * P.p6.z * stepDt;
    }

    if ((flags & (64u | 128u | 256u)) != 0u) {
        var point = pos;
        var velW = vel;
        if (local) { point = P.origin.xyz + R * pos; velW = R * vel; }
        var collided = false;
        if ((flags & 64u) != 0u && point.y < P.p9.w && velW.y < 0.0) {
            hitPoint = vec3<f32>(point.x, P.p9.w, point.z);
            hitNormal = vec3<f32>(0.0, 1.0, 0.0);
            collided = true;
        } else if ((flags & 128u) != 0u && P.p13.w > 0.5) {
            collided = depthHit(point, velW, stepDt);
        } else if ((flags & 256u) != 0u) {
            collided = sdfHit(point, velW);
        }
        if (collided) {
            let approach = dot(velW, hitNormal);
            let fr = clamp(P.p10.y, 0.0, 1.0);
            let bounce = clamp(P.p10.x, 0.0, 1.0);
            let incoming = velW;
            velW = (velW - hitNormal * approach) * (1.0 - fr) - hitNormal * approach * bounce;
            point = hitPoint;
            if (local) {
                pos = transpose(R) * (point - P.origin.xyz);
                vel = transpose(R) * velW;
            } else {
                pos = point;
                vel = velW;
            }
            if ((flags & 2048u) != 0u) { emitEvent(2.0, point, incoming, hitNormal, i); }
            age = age + clamp(P.p10.z, 0.0, 1.0) * life;
            if (age >= life) {
                st.pa.w = life;
                states[i] = st;
                if ((flags & 1024u) != 0u) { emitEvent(0.0, point, velW, vec3<f32>(0.0), i); }
                hide(i);
                return;
            }
        }
    }

    let rotation = st.ms.z + st.ms.w * stepDt;
    st = State(vec4<f32>(pos, age), vec4<f32>(vel, life), vec4<f32>(st.ms.x, st.ms.y, rotation, st.ms.w));
    states[i] = st;

    var size = mix(st.ms.x, st.ms.y, ease(P.p8.w, t));
    if ((flags & 8u) != 0u) { size = st.ms.x * lutF(0u, t); }
    var color = mix(P.startColor, P.endColor, ease(P.p9.z, t));
    if ((flags & 16u) != 0u) { color = lutC(t); }

    var u0 = 0.0;
    var v0 = 0.0;
    var us = 1.0;
    var vs = 1.0;
    let cols = max(P.p11.x, 1u);
    let rows = max(P.p11.y, 1u);
    let total = f32(cols * rows);
    if (total > 1.0) {
        us = 1.0 / f32(cols);
        vs = 1.0 / f32(rows);
        if (P.p10.w > 0.0) {
            let raw = age * P.p10.w;
            var frameF = min(raw, total - 1.0);
            if (P.p11.z != 0u) { frameF = raw - total * floor(raw / total); }
            let fi = u32(frameF);
            u0 = f32(fi % cols) * us;
            v0 = f32(fi / cols) * vs;
        }
    }

    var worldPos = pos;
    var worldSize = vec2<f32>(size);
    if (local) {
        let rel3 = pos * vec3<f32>(P.local.z, P.local.w, 1.0);
        worldPos = P.origin.xyz + vec3<f32>(rel3.x * P.local.x - rel3.y * P.local.y, rel3.x * P.local.y + rel3.y * P.local.x, rel3.z);
        worldSize = worldSize * vec2<f32>(P.local.z, P.local.w);
    }
    if ((flags & 8192u) != 0u) { stepTrail(i, worldPos, born, color); }
    worldPos = worldPos - P.shift.xyz;
    insts[i] = Inst(worldPos.x, worldPos.y, worldPos.z, worldSize.x, worldSize.y, rotation, pack4x8unorm(color), u0, v0, us, vs);
}
)WGSL";

// Before an emitter's kernel: its events are this frame's. After: the ring has moved on by what its parent lit.
const char* const kEventControl = R"WGSL(
struct Control { p: vec4<u32> };
struct Events { count: atomic<u32>, head: u32, capacity: u32, pad: u32 };
struct EventsIn { count: u32, head: u32, capacity: u32, pad: u32 };
@group(0) @binding(0) var<uniform> C: Control;
@group(0) @binding(1) var<storage, read_write> events: Events;
@group(0) @binding(2) var<storage, read> parentEvents: EventsIn;

@compute @workgroup_size(1)
fn begin() {
    atomicStore(&events.count, 0u);
    events.capacity = C.p.x;
}
@compute @workgroup_size(1)
fn finish() {
    let lit = min(min(parentEvents.count, parentEvents.capacity) * max(C.p.y, 1u), C.p.z);
    events.head = (events.head + lit) % max(C.p.z, 1u);
}
)WGSL";

// The scene's depth left where next frame's kernel can read it: no texture survives a graph, and a buffer is what the kernel already has.
const char* const kDepthCopy = R"WGSL(
struct Grid { size: vec4<u32> };
@group(0) @binding(0) var<uniform> G: Grid;
@group(0) @binding(1) var depth: texture_depth_2d;
@group(0) @binding(2) var<storage, read_write> grid: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= G.size.x || gid.y >= G.size.y) { return; }
    let dims = vec2<f32>(textureDimensions(depth));
    let at = (vec2<f32>(gid.xy) + 0.5) / vec2<f32>(G.size.xy) * dims;
    let texel = clamp(vec2<i32>(at), vec2<i32>(0), vec2<i32>(dims) - vec2<i32>(1));
    grid[gid.y * G.size.x + gid.x] = textureLoad(depth, texel, 0);
}
)WGSL";

void set4(f32 (&dst)[4], f32 a, f32 b, f32 c, f32 d) { dst[0] = a; dst[1] = b; dst[2] = c; dst[3] = d; }
void set4(u32 (&dst)[4], u32 a, u32 b, u32 c, u32 d) { dst[0] = a; dst[1] = b; dst[2] = c; dst[3] = d; }

// A finite, non-negative range: a bad value reaching a kernel is a hung or poisoned buffer, and nothing reads it back.
f32 finite(f32 v, f32 fallback = 0.0f) { return std::isfinite(v) ? v : fallback; }

}  // namespace

struct GpuParticles::Job {
    Entity entity;
    ParamsBlock block;
    Slot* slot;
    particle::ParticleSystem* system;
    particle::GpuStep step;
    u32 subEmitter = 0;       ///< The child its events feed.
    f32 inheritVelocity = 0;  ///< What of a parent's speed that child keeps.
    u32 eventCapacity = 0;
    u32 reportEvents = 0;     ///< How many of its events the game asks to hear about.
};

GpuParticles::GpuParticles(GfxDevice& device) : device_(device) {}

GpuParticles::~GpuParticles() {
    release();
}

bool GpuParticles::available() const {
    return !failed_ && device_.supportsCompute();
}

void GpuParticles::freeSlot(Slot& slot) {
    if (slot.state != BufferHandle::Invalid) device_.deleteBuffer(slot.state);
    if (slot.instances != BufferHandle::Invalid) device_.deleteBuffer(slot.instances);
    if (slot.events != BufferHandle::Invalid) device_.deleteBuffer(slot.events);
    if (slot.trail != BufferHandle::Invalid) device_.deleteBuffer(slot.trail);
    if (slot.segments != BufferHandle::Invalid) device_.deleteBuffer(slot.segments);
    if (slot.readback != ReadbackHandle::Invalid) device_.discardReadback(slot.readback);
    slot = {};
}

void GpuParticles::release() {
    for (auto& [id, slot] : slots_) freeSlot(slot);
    slots_.clear();
    jobs_.clear();
    if (params_ != BufferHandle::Invalid) device_.deleteBuffer(params_);
    params_ = BufferHandle::Invalid;
    paramsCapacity_ = 0;
    if (kernel_ != ComputeHandle::Invalid) device_.deleteCompute(kernel_);
    kernel_ = ComputeHandle::Invalid;
    for (ComputeHandle* k : {&beginEvents_, &finishEvents_, &depthCopy_}) {
        if (*k != ComputeHandle::Invalid) device_.deleteCompute(*k);
        *k = ComputeHandle::Invalid;
    }
    for (BufferHandle* b : {&control_, &emptyRead_, &emptyEvents_, &emptyTrail_, &emptySegments_, &colliders_, &depthGrid_, &depthParams_}) {
        if (*b != BufferHandle::Invalid) device_.deleteBuffer(*b);
        *b = BufferHandle::Invalid;
    }
    controlCapacity_ = 0;
    collidersCapacity_ = 0;
    depthW_ = depthH_ = 0;
    depthValid_ = false;
    failed_ = false;
}

void GpuParticles::beginFrame() {
    ++frame_;
    jobs_.clear();
    lastDispatches_ = 0;
    drawn_ = 0;
    depthCopied_ = false;
    wantsDepth_ = wantsDepthNext_;
    wantsDepthNext_ = false;
    pollReadbacks();
    // Given back after a few seconds unseen: an emitter off screen keeps its particles for a moment, not for ever.
    for (auto it = slots_.begin(); it != slots_.end();) {
        if (frame_ > it->second.lastUsed + 300) {
            freeSlot(it->second);
            it = slots_.erase(it);
        } else {
            ++it;
        }
    }
}

bool GpuParticles::ensureKernel() {
    if (kernel_ != ComputeHandle::Invalid) return true;
    if (failed_ || !device_.supportsCompute()) return false;
    std::string log;
    kernel_ = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, kKernel, "main"}, &log);
    if (kernel_ == ComputeHandle::Invalid) {
        ES_LOG_ERROR("GpuParticles: the kernel did not compile: {}", log);
        failed_ = true;
        return false;
    }
    return true;
}

bool GpuParticles::ensureEventKernels() {
    if (beginEvents_ != ComputeHandle::Invalid && finishEvents_ != ComputeHandle::Invalid) return true;
    std::string log;
    beginEvents_ = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, kEventControl, "begin"}, &log);
    finishEvents_ = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, kEventControl, "finish"}, &log);
    if (beginEvents_ == ComputeHandle::Invalid || finishEvents_ == ComputeHandle::Invalid) {
        ES_LOG_ERROR("GpuParticles: the event kernels did not compile: {}", log);
        return false;
    }
    return true;
}

void GpuParticles::ensureEmpties() {
    // A kernel's layout is fixed, so what an emitter does not use is still bound; written-to bindings may not share a buffer.
    const auto make = [this](BufferHandle& b, u32 size) {
        if (b == BufferHandle::Invalid) b = device_.createBuffer({GfxBufferUsage::Storage, size, false}, GfxContent::transient(), nullptr);
    };
    make(emptyRead_, 128);
    make(emptyEvents_, 128);
    make(emptyTrail_, 64);
    make(emptySegments_, 64);
}

void GpuParticles::pollReadbacks() {
    for (auto& [id, slot] : slots_) {
        if (slot.readback == ReadbackHandle::Invalid) continue;
        const GfxReadbackStatus status = device_.pollReadback(slot.readback);
        if (status == GfxReadbackStatus::Pending) continue;
        const ReadbackHandle handle = slot.readback;
        slot.readback = ReadbackHandle::Invalid;
        if (status != GfxReadbackStatus::Ready) continue;
        std::vector<u8> bytes(slot.readbackBytes);
        if (!device_.takeReadback(handle, bytes.data(), bytes.size()) || !slot.system) continue;
        u32 total = 0;
        std::memcpy(&total, bytes.data(), sizeof(u32));
        const u32 kept = std::min(total, (slot.readbackBytes - kEventHeaderBytes) / kEventBytes);
        std::vector<particle::CollisionEvent> out;
        out.reserve(kept);
        u32 hits = 0;
        for (u32 k = 0; k < kept; ++k) {
            f32 r[12];
            std::memcpy(r, bytes.data() + kEventHeaderBytes + k * kEventBytes, sizeof(r));
            if (r[3] < 1.5f) continue;
            ++hits;
            out.push_back({id, static_cast<u32>(r[11]), 0xffffffffu, slot.collisionMode,
                           r[0], r[1], r[2], r[8], r[9], r[10], r[4], r[5], r[6], 1u});
        }
        // Past what was kept, the kinds are not known; every event of an emitter that only reports hits is one.
        slot.system->addGpuCollisions(Entity::fromRaw(id), total > kept ? hits + (total - kept) : hits, out.data(), static_cast<u32>(out.size()));
    }
}

GpuParticles::Slot* GpuParticles::ensureSlot(Entity entity, u32 capacity) {
    Slot& slot = slots_[entity.raw];
    slot.lastUsed = frame_;
    if (slot.state != BufferHandle::Invalid && slot.capacity == capacity) return &slot;
    freeSlot(slot);
    // Zeroed by the device: age 0 of lifetime 0 is a dead particle, and a zero instance has no size to draw.
    slot.state = device_.createBuffer({GfxBufferUsage::Storage, capacity * kStateBytes, false}, GfxContent::transient(), nullptr);
    slot.instances = device_.createBuffer({GfxBufferUsage::Storage, capacity * kInstanceBytes, false}, GfxContent::transient(), nullptr);
    if (slot.state == BufferHandle::Invalid || slot.instances == BufferHandle::Invalid) {
        ES_LOG_ERROR("GpuParticles: could not allocate {} particles", capacity);
        freeSlot(slot);
        slots_.erase(entity.raw);
        return nullptr;
    }
    slot.capacity = capacity;
    slot.lastUsed = frame_;
    return &slot;
}

bool GpuParticles::submit(Entity entity, const ecs::ParticleEmitter& emitter, const ecs::Transform& transform,
                          particle::ParticleSystem& system, const particle::GpuStep& step, const glm::vec4& eye,
                          BufferHandle& instances, BufferHandle& segments, u32& segmentCount) {
    if (!ensureKernel() || step.capacity == 0) return false;
    Slot* slot = ensureSlot(entity, step.capacity);
    if (!slot) return false;
    instances = slot->instances;
    drawn_ += step.drawCount;
    slot->system = &system;
    slot->collisionMode = static_cast<u32>(emitter.collisionMode);

    const bool collides = emitter.collisionEnabled;
    const i32 mode = emitter.collisionMode;
    const bool depthMode = collides && mode == static_cast<i32>(ecs::ParticleCollisionMode::Depth);
    const bool sdfMode = collides && mode == static_cast<i32>(ecs::ParticleCollisionMode::Sdf);
    if (depthMode) wantsDepthNext_ = true;

    // What an emitter fires: its child's trigger, and what the game asks to hear.
    const bool hasChild = emitter.subEmitter != 0;
    const i32 trigger = emitter.subEmitterTrigger;
    const u32 report = collides && emitter.collisionEvents ? static_cast<u32>(std::clamp(emitter.collisionEventBudget, 0, 1024)) : 0u;
    const bool emitsBirth = hasChild && trigger == static_cast<i32>(ecs::SubEmitterTrigger::Birth);
    const bool emitsDeath = hasChild && trigger == static_cast<i32>(ecs::SubEmitterTrigger::Death);
    const bool emitsHit = (hasChild && trigger == static_cast<i32>(ecs::SubEmitterTrigger::Collision)) || report > 0;
    const bool emits = emitsBirth || emitsDeath || emitsHit;
    const u32 eventCapacity = emits ? kMaxEvents : 1u;
    if (emits || step.fed) {
        const u32 bytes = kEventHeaderBytes + eventCapacity * kEventBytes;
        if (slot->events == BufferHandle::Invalid || slot->eventBytes != bytes) {
            if (slot->events != BufferHandle::Invalid) device_.deleteBuffer(slot->events);
            slot->events = device_.createBuffer({GfxBufferUsage::Storage, bytes, false}, GfxContent::transient(), nullptr);
            slot->eventBytes = bytes;
            if (slot->events == BufferHandle::Invalid) return false;
        }
    }

    const bool trailOn = emitter.trailEnabled && emitter.trailWidth > 0.0f;
    const u32 points = static_cast<u32>(std::clamp(emitter.trailPoints, 2, particle::kMaxTrailPoints));
    if (trailOn) {
        if (slot->trail == BufferHandle::Invalid || slot->trailPoints != points) {
            if (slot->trail != BufferHandle::Invalid) device_.deleteBuffer(slot->trail);
            if (slot->segments != BufferHandle::Invalid) device_.deleteBuffer(slot->segments);
            slot->trail = device_.createBuffer({GfxBufferUsage::Storage, step.capacity * points * 16u, false}, GfxContent::transient(), nullptr);
            slot->segments = device_.createBuffer({GfxBufferUsage::Storage, step.capacity * (points - 1u) * kInstanceBytes, false}, GfxContent::transient(), nullptr);
            slot->trailPoints = points;
            if (slot->trail == BufferHandle::Invalid || slot->segments == BufferHandle::Invalid) {
                ES_LOG_ERROR("GpuParticles: could not allocate trails for {} particles", step.capacity);
                return false;
            }
        }
        segments = slot->segments;
        segmentCount = step.drawCount * (points - 1u);
    }

    // A second camera's collect asks for the same step until the first has run it.
    for (const Job& queued : jobs_) {
        if (queued.entity == entity) return true;
    }
    const bool local = emitter.simulationSpace == static_cast<i32>(ecs::SimulationSpace::Local);
    // Nothing to advance and nowhere it could have moved to: the buffer already says what is true.
    if (step.dt <= 0.0f && step.spawnCount == 0 && !step.reset && !local) return true;
    if (jobs_.size() >= kMaxJobs) return true;

    Job job{entity, {}, slot, &system, step};
    ParamsBlock& b = job.block;
    std::memset(&b, 0, sizeof(b));

    u32 flags = 0;
    if (step.reset) flags |= kReset;
    if (local) flags |= kLocal;
    const bool noiseOn = emitter.noiseStrength > 0.0f && emitter.noiseFrequency > 0.0f;
    if (noiseOn) flags |= kNoise;
    if (collides && mode == static_cast<i32>(ecs::ParticleCollisionMode::Floor)) flags |= kFloor;
    // A scene query is the CPU's to ask; here, what the emitter says to do when one is not to be had.
    if (collides && (mode == static_cast<i32>(ecs::ParticleCollisionMode::Physics2D) || mode == static_cast<i32>(ecs::ParticleCollisionMode::Physics3D))
        && emitter.collisionFallback == static_cast<i32>(ecs::ParticleCollisionFallback::Floor)) flags |= kFloor;
    if (depthMode) flags |= kDepth;
    if (sdfMode) flags |= kSdf;
    if (emitsBirth) flags |= kEmitBirth;
    if (emitsDeath) flags |= kEmitDeath;
    if (emitsHit) flags |= kEmitHit;
    if (step.fed) flags |= kFed;
    if (trailOn) flags |= kTrail;

    const auto* colorLut = system.colorLut(entity);
    const auto* sizeLut = system.sizeLut(entity);
    const auto* speedLut = system.speedLut(entity);
    if (colorLut) flags |= kColorLut;
    if (sizeLut) flags |= kSizeLut;
    if (speedLut) flags |= kSpeedLut;

    // A scene's own draw of randomness, fixed per emitter: the same emitter replays the same particles.
    const u32 seed = entity.raw * 2246822519u + 3266489917u;
    set4(b.p0, step.capacity, step.firstIndex, step.spawnCount, step.smoothCount);
    set4(b.p1, seed, flags, static_cast<u32>(std::clamp(emitter.shape, 0, 5)), static_cast<u32>(std::clamp(emitter.noiseOctaves, 1, 8)));
    set4(b.p2, step.dt, step.noiseTime, finite(emitter.lifetimeMin), finite(emitter.lifetimeMax));
    set4(b.p3, finite(emitter.speedMin), finite(emitter.speedMax), finite(emitter.startSizeMin), finite(emitter.startSizeMax));
    set4(b.p4, finite(emitter.endSizeMin), finite(emitter.endSizeMax), finite(emitter.rotationMin), finite(emitter.rotationMax));
    set4(b.p5, finite(emitter.angularVelocityMin), finite(emitter.angularVelocityMax), finite(emitter.gravity.x), finite(emitter.gravity.y));
    set4(b.p6, finite(emitter.gravity.z), finite(emitter.damping), finite(emitter.noiseStrength), finite(emitter.noiseFrequency));
    const f32 scroll = emitter.noiseScrollSpeed * step.noiseTime * emitter.noiseFrequency;
    set4(b.p7, finite(scroll), finite(scroll), finite(emitter.shapeRadius), finite(emitter.shapeAngle * 0.5f * math::DEG_TO_RAD));
    set4(b.p8, finite(emitter.shapeSize.x), finite(emitter.shapeSize.y), finite(emitter.shapeSize.z), static_cast<f32>(emitter.sizeEasing));
    set4(b.p9, finite(emitter.angleSpreadMin * math::DEG_TO_RAD), finite(emitter.angleSpreadMax * math::DEG_TO_RAD),
         static_cast<f32>(emitter.colorEasing), finite(emitter.collisionFloor));
    set4(b.p10, finite(emitter.collisionBounce), finite(emitter.collisionFriction), finite(emitter.collisionLifetimeLoss), finite(emitter.spriteFPS));
    const std::vector<particle::ForceFieldInstance>& fields = system.forceFields();
    const u32 fieldCount = local ? 0u : static_cast<u32>(std::min<std::size_t>(fields.size(), kMaxFields));
    set4(b.p11, static_cast<u32>(std::max(emitter.spriteColumns, 1)), static_cast<u32>(std::max(emitter.spriteRows, 1)),
         emitter.spriteLoop ? 1u : 0u, fieldCount);
    set4(b.startColor, emitter.startColor.r, emitter.startColor.g, emitter.startColor.b, emitter.startColor.a);
    set4(b.endColor, emitter.endColor.r, emitter.endColor.g, emitter.endColor.b, emitter.endColor.a);

    const glm::vec3 position = transform.worldPosition;
    const glm::vec3 scale = transform.worldScale;
    set4(b.origin, position.x, position.y, position.z, 0.0f);
    set4(b.scale, scale.x, scale.y, scale.z, 0.0f);
    const glm::mat3 rot = glm::mat3_cast(transform.worldRotation);
    set4(b.rot0, rot[0].x, rot[0].y, rot[0].z, 0.0f);
    set4(b.rot1, rot[1].x, rot[1].y, rot[1].z, 0.0f);
    set4(b.rot2, rot[2].x, rot[2].y, rot[2].z, 0.0f);
    f32 angle = 2.0f * std::atan2(transform.worldRotation.z, transform.worldRotation.w);
    if (std::abs(angle) <= 0.001f) angle = 0.0f;
    set4(b.local, std::cos(angle), std::sin(angle), scale.x, scale.y);
    const glm::dvec3 origin = renderOrigin();
    set4(b.shift, static_cast<f32>(origin.x), static_cast<f32>(origin.y), static_cast<f32>(origin.z), 0.0f);

    for (u32 k = 0; k < fieldCount; ++k) {
        const particle::ForceFieldInstance& f = fields[k];
        set4(b.fields[k * 3], f.position.x, f.position.y, f.position.z, static_cast<f32>(f.type));
        set4(b.fields[k * 3 + 1], f.direction.x, f.direction.y, f.direction.z, f.strength);
        set4(b.fields[k * 3 + 2], f.radius, f.falloff ? 1.0f : 0.0f, 0.0f, 0.0f);
    }
    if (colorLut) {
        for (u32 k = 0; k < kLutSize; ++k) set4(b.colorLut[k], (*colorLut)[k].r, (*colorLut)[k].g, (*colorLut)[k].b, (*colorLut)[k].a);
    }
    for (u32 k = 0; k < kLutSize; ++k) {
        if (sizeLut) b.sizeLut[k >> 2][k & 3] = (*sizeLut)[k];
        if (speedLut) b.speedLut[k >> 2][k & 3] = (*speedLut)[k];
    }

    set4(b.p12, static_cast<u32>(frame_), eventCapacity, static_cast<u32>(std::max(emitter.burstCount, 1)),
         sdfMode ? static_cast<u32>(std::min<std::size_t>(system.sdfColliders().size(), kMaxColliders)) : 0u);
    // A report must hear every hit; a chance belongs to a child.
    set4(b.p13, report > 0 || !hasChild ? 1.0f : std::clamp(finite(emitter.subEmitterChance, 1.0f), 0.0f, 1.0f), 0.0f,
         std::max(finite(emitter.collisionThickness), 0.0f), 0.0f);
    set4(b.p14, points, emitter.collisionMask & 0xffffu, depthW_, depthH_);
    set4(b.p15, finite(emitter.trailWidth), std::max(finite(emitter.trailMinDistance), 0.0f), 0.0f, 0.0f);
    set4(b.camera, eye.x, eye.y, eye.z, eye.w);
    job.subEmitter = emitter.subEmitter;
    job.inheritVelocity = std::clamp(finite(emitter.subEmitterInheritVelocity), 0.0f, 1.0f);
    job.eventCapacity = eventCapacity;
    job.reportEvents = report;

    jobs_.push_back(job);
    return true;
}

void GpuParticles::declareDepthCopy(rg::RenderGraph& graph, rg::ResourceId scene, u32 sceneW, u32 sceneH, const glm::mat4& clip) {
    if (!wantsDepth_ || depthCopied_ || scene == rg::kNoResource || !device_.supportsCompute()) return;
    depthCopied_ = true;
    rg::TargetDesc token;
    token.width = 1;
    token.height = 1;
    token.format = GfxPixelFormat::RGBA8;
    token.storage = true;
    token.linearFilter = false;
    rg::PassDesc pass;
    pass.name = "gpu_particle_depth";
    pass.compute = true;
    pass.keep = true;
    pass.dependencies = {scene};
    pass.write = graph.createTarget(token);
    const glm::dvec3 origin = renderOrigin();
    pass.execute = [this, &graph, scene, sceneW, sceneH, clip, origin](const rg::PassContext&) {
        const TextureHandle depth = graph.depthTextureOf(scene);
        if (depth == TextureHandle::Invalid) { depthValid_ = false; return; }
        if (depthCopy_ == ComputeHandle::Invalid) {
            std::string log;
            depthCopy_ = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, kDepthCopy, "main"}, &log);
            if (depthCopy_ == ComputeHandle::Invalid) {
                ES_LOG_ERROR("GpuParticles: the depth copy did not compile: {}", log);
                return;
            }
        }
        const u32 w = std::max(std::min(sceneW, kDepthGridMax), 1u);
        const u32 h = std::max(1u, static_cast<u32>(static_cast<u64>(sceneH) * w / std::max(sceneW, 1u)));
        if (w != depthW_ || h != depthH_ || depthGrid_ == BufferHandle::Invalid) {
            if (depthGrid_ != BufferHandle::Invalid) device_.deleteBuffer(depthGrid_);
            depthGrid_ = device_.createBuffer({GfxBufferUsage::Storage, w * h * 4u, false}, GfxContent::transient(), nullptr);
            if (depthGrid_ == BufferHandle::Invalid) { depthW_ = depthH_ = 0; depthValid_ = false; return; }
            depthW_ = w;
            depthH_ = h;
        }
        if (depthParams_ == BufferHandle::Invalid) {
            depthParams_ = device_.createBuffer({GfxBufferUsage::Uniform, 16, true}, GfxContent::transient(), nullptr);
            if (depthParams_ == BufferHandle::Invalid) return;
        }
        const u32 size[4] = {w, h, 0, 0};
        device_.updateBuffer(depthParams_, 0, size, sizeof(size));
        const GfxComputeBinding bindings[3] = {
            GfxComputeBinding::uniform(0, depthParams_),
            GfxComputeBinding::depth(1, depth),
            GfxComputeBinding::storage(2, depthGrid_),
        };
        if (device_.dispatchCompute(depthCopy_, bindings, 3, (w + 7) / 8, (h + 7) / 8)) {
            depthValid_ = true;
            depthClip_ = clip;
            depthWorld_ = glm::inverse(clip);
            depthOrigin_ = glm::vec3(origin);
        }
    };
    graph.addPass(std::move(pass));
}

rg::ResourceId GpuParticles::declare(rg::RenderGraph& graph) {
    if (jobs_.empty()) return rg::kNoResource;
    // The pass is tied to the scene by what it writes, the way the other compute passes are: a single texel nobody samples.
    rg::TargetDesc token;
    token.width = 1;
    token.height = 1;
    token.format = GfxPixelFormat::RGBA8;
    token.storage = true;
    token.linearFilter = false;
    const rg::ResourceId done = graph.createTarget(token);
    rg::PassDesc pass;
    pass.name = "gpu_particles";
    pass.compute = true;
    pass.write = done;
    pass.execute = [this](const rg::PassContext&) { run(); };
    graph.addPass(std::move(pass));
    return done;
}

void GpuParticles::run() {
    if (jobs_.empty() || kernel_ == ComputeHandle::Invalid) return;
    const u32 needed = static_cast<u32>(jobs_.size()) * kJobStride;
    if (params_ == BufferHandle::Invalid || paramsCapacity_ < needed) {
        if (params_ != BufferHandle::Invalid) device_.deleteBuffer(params_);
        paramsCapacity_ = std::max(needed, kJobStride * 8u);
        params_ = device_.createBuffer({GfxBufferUsage::Uniform, paramsCapacity_, true}, GfxContent::transient(), nullptr);
        if (params_ == BufferHandle::Invalid) {
            paramsCapacity_ = 0;
            return;
        }
    }
    ensureEmpties();

    // A parent runs before what its events feed, however the scene happens to list them.
    std::vector<Job*> order;
    order.reserve(jobs_.size());
    const auto parentOf = [this](const Job& child) -> Job* {
        for (Job& candidate : jobs_) {
            if (candidate.subEmitter == child.entity.raw && &candidate != &child) return &candidate;
        }
        return nullptr;
    };
    std::vector<u8> placed(jobs_.size(), 0);
    const auto place = [&](auto&& self, Job& job, u32 depth) -> void {
        const std::size_t index = static_cast<std::size_t>(&job - jobs_.data());
        if (placed[index]) return;
        placed[index] = 1;
        if (depth < kMaxJobs) {
            if (Job* parent = parentOf(job)) self(self, *parent, depth + 1);
        }
        order.push_back(&job);
    };
    for (Job& job : jobs_) place(place, job, 0);

    const std::vector<particle::SdfColliderInstance>& colliders = jobs_.front().system->sdfColliders();
    const u32 colliderBytes = static_cast<u32>(std::min<std::size_t>(colliders.size(), kMaxColliders)) * sizeof(particle::SdfColliderInstance);
    if (colliderBytes > 0 && (colliders_ == BufferHandle::Invalid || collidersCapacity_ < colliderBytes)) {
        if (colliders_ != BufferHandle::Invalid) device_.deleteBuffer(colliders_);
        collidersCapacity_ = kMaxColliders * sizeof(particle::SdfColliderInstance);
        colliders_ = device_.createBuffer({GfxBufferUsage::Storage, collidersCapacity_, true}, GfxContent::transient(), nullptr);
    }
    if (colliderBytes > 0 && colliders_ != BufferHandle::Invalid) device_.updateBuffer(colliders_, 0, colliders.data(), colliderBytes);

    std::vector<u8> staging(needed, 0);
    for (std::size_t i = 0; i < jobs_.size(); ++i) {
        Job& job = jobs_[i];
        if (const Job* parent = parentOf(job)) job.block.p13[1] = parent->inheritVelocity;
        if (depthValid_) {
            job.block.p13[3] = 1.0f;
            set4(job.block.p14, job.block.p14[0], job.block.p14[1], depthW_, depthH_);
            std::memcpy(job.block.depthClip, &depthClip_[0][0], sizeof(job.block.depthClip));
            std::memcpy(job.block.depthWorld, &depthWorld_[0][0], sizeof(job.block.depthWorld));
            set4(job.block.depthOrigin, depthOrigin_.x, depthOrigin_.y, depthOrigin_.z, 0.0f);
        }
        std::memcpy(staging.data() + i * kJobStride, &job.block, sizeof(ParamsBlock));
    }
    device_.updateBuffer(params_, 0, staging.data(), needed);

    bool anyEvents = false;
    for (const Job& job : jobs_) anyEvents = anyEvents || job.slot->events != BufferHandle::Invalid;
    if (anyEvents) {
        if (!ensureEventKernels()) anyEvents = false;
        const u32 controlBytes = static_cast<u32>(jobs_.size()) * 256u;
        if (anyEvents && (control_ == BufferHandle::Invalid || controlCapacity_ < controlBytes)) {
            if (control_ != BufferHandle::Invalid) device_.deleteBuffer(control_);
            controlCapacity_ = std::max(controlBytes, 256u * 8u);
            control_ = device_.createBuffer({GfxBufferUsage::Uniform, controlCapacity_, true}, GfxContent::transient(), nullptr);
            if (control_ == BufferHandle::Invalid) { controlCapacity_ = 0; anyEvents = false; }
        }
        if (anyEvents) {
            std::vector<u8> control(controlBytes, 0);
            for (std::size_t i = 0; i < jobs_.size(); ++i) {
                const u32 words[4] = {jobs_[i].eventCapacity, jobs_[i].block.p12[2], jobs_[i].slot->capacity, 0u};
                std::memcpy(control.data() + i * 256u, words, sizeof(words));
            }
            device_.updateBuffer(control_, 0, control.data(), controlBytes);
        }
    }

    for (Job* jobPtr : order) {
        const Job& job = *jobPtr;
        const u32 i = static_cast<u32>(jobPtr - jobs_.data());
        const Job* parent = parentOf(job);
        const BufferHandle ownEvents = job.slot->events != BufferHandle::Invalid ? job.slot->events : emptyEvents_;
        const bool fed = (job.block.p1[1] & kFed) != 0u;
        const BufferHandle inEvents = fed && parent && parent->slot->events != BufferHandle::Invalid ? parent->slot->events : emptyRead_;
        const bool controlled = anyEvents && job.slot->events != BufferHandle::Invalid;
        if (controlled) {
            const GfxComputeBinding control[2] = {
                GfxComputeBinding::uniform(0, control_, i * 256u, 16u),
                GfxComputeBinding::storage(1, ownEvents),
            };
            device_.dispatchCompute(beginEvents_, control, 2, 1);
        }
        const GfxComputeBinding bindings[9] = {
            GfxComputeBinding::uniform(0, params_, i * kJobStride, sizeof(ParamsBlock)),
            GfxComputeBinding::storage(1, job.slot->state),
            GfxComputeBinding::storage(2, job.slot->instances),
            GfxComputeBinding::storage(3, ownEvents),
            GfxComputeBinding::storageRead(4, inEvents),
            GfxComputeBinding::storageRead(5, depthValid_ && depthGrid_ != BufferHandle::Invalid ? depthGrid_ : emptyRead_),
            GfxComputeBinding::storageRead(6, colliders_ != BufferHandle::Invalid ? colliders_ : emptyRead_),
            GfxComputeBinding::storage(7, job.slot->trail != BufferHandle::Invalid ? job.slot->trail : emptyTrail_),
            GfxComputeBinding::storage(8, job.slot->segments != BufferHandle::Invalid ? job.slot->segments : emptySegments_),
        };
        if (device_.dispatchCompute(kernel_, bindings, 9, (job.slot->capacity + 63) / 64)) {
            ++lastDispatches_;
            job.system->commitGpuStep(job.entity, job.step);
        }
        if (controlled && fed) {
            const GfxComputeBinding control[3] = {
                GfxComputeBinding::uniform(0, control_, i * 256u, 16u),
                GfxComputeBinding::storage(1, ownEvents),
                GfxComputeBinding::storageRead(2, inEvents),
            };
            device_.dispatchCompute(finishEvents_, control, 3, 1);
        }
        if (job.reportEvents > 0 && controlled && job.slot->readback == ReadbackHandle::Invalid) {
            job.slot->readbackBytes = kEventHeaderBytes + std::min(job.reportEvents, job.eventCapacity) * kEventBytes;
            job.slot->readback = device_.requestBufferReadback(job.slot->events, 0, job.slot->readbackBytes);
        }
    }
    jobs_.clear();
}

}  // namespace esengine
