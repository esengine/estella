// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// variants.js — the JS half of the Stage 0 AOT measurement.
//
// Four shapes of ONE system (velocity integration over N entities), so the
// speedup an AOT compiler could buy can be split into the two things it is
// actually made of:
//
//   A  today's SDK path .... fillTransform -> user body -> writeTransform
//   B  in-place view ....... a reused view object whose fields are accessors
//                            straight onto the component bytes
//   B2 raw indexing ........ the interpreted floor: no object layer at all
//   C  native .............. in bench.cpp, the AOT ceiling
//
// A -> B  is what a pure SDK change buys.   B -> C is what COMPILING buys.
// The Stage 0 exit criterion needs both, which is why they are separate runs.
//
// A and B are transcribed from sdk/src/ecs/bridge/ptrAccessors.generated.ts —
// same field order, same offsets, same "write every field back" behaviour. If
// that generated file changes shape, this file is wrong and must follow it.
//
// All arithmetic is done the way JS does it (f64 math, f32 store), and bench.cpp
// does the same in C++, so every variant is bit-identical and the checksums must
// match. A checksum mismatch means the variants are not doing the same work and
// no timing from the run means anything.

'use strict';

// Filled by setup(). Module-level so a per-frame call marshals one argument.
let N = 0;
let ents = null;      // Uint32Array — the candidate list a query walks
let sparse = null;    // Uint32Array — entity id -> dense row
let TF = null;        // Float32Array over the Transform pool
let VF = null;        // Float32Array over the Velocity pool
let changed = null;   // Uint8Array — world.markChanged's bit
let TW = 0;           // Transform stride, in f32 words
let VW = 0;           // Velocity stride, in f32 words

// Transform field offsets, in f32 words from the row base. Mirrors
// fillTransform/writeTransform: position@0 rotation@12 scale@28
// worldPosition@40 worldRotation@52 worldScale@68 (bytes).
const T_POS = 0, T_ROT = 3, T_SCL = 7, T_WPOS = 10, T_WROT = 13, T_WSCL = 17;
// Velocity: linear@0 angular@12 (bytes).
const V_LIN = 0, V_ANG = 3;

globalThis.setup = function (n, entsBuf, sparseBuf, tBuf, vBuf, changedBuf, tStrideBytes, vStrideBytes) {
    N = n;
    ents = new Uint32Array(entsBuf);
    sparse = new Uint32Array(sparseBuf);
    TF = new Float32Array(tBuf);
    VF = new Float32Array(vBuf);
    changed = new Uint8Array(changedBuf);
    TW = tStrideBytes >> 2;
    VW = vStrideBytes >> 2;
};

// ---------------------------------------------------------------------------
// A — today's path.
//
// The `out` objects are created ONCE per query, not per entity: that is what
// createTransformData() is for, and modelling it any other way would make the
// baseline look worse than it is. The cost is not allocation, it is the ~90
// property accesses and 46 typed-array accesses per entity — and above all that
// writeTransform stores ALL TWENTY floats to change three.
// ---------------------------------------------------------------------------
const outT = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 0 },
    scale: { x: 0, y: 0, z: 0 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 0 },
    worldScale: { x: 0, y: 0, z: 0 },
};
const outV = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };

globalThis.variantA = function (dt) {
    for (let i = 0; i < N; i++) {
        const e = ents[i];
        const row = sparse[e];
        const t = row * TW;
        const v = row * VW;

        // fillTransform(f32, u32, u8, ptr, out)
        const p_ = outT.position; p_.x = TF[t + T_POS]; p_.y = TF[t + T_POS + 1]; p_.z = TF[t + T_POS + 2];
        const r_ = outT.rotation; r_.x = TF[t + T_ROT]; r_.y = TF[t + T_ROT + 1]; r_.z = TF[t + T_ROT + 2]; r_.w = TF[t + T_ROT + 3];
        const s_ = outT.scale; s_.x = TF[t + T_SCL]; s_.y = TF[t + T_SCL + 1]; s_.z = TF[t + T_SCL + 2];
        const wp_ = outT.worldPosition; wp_.x = TF[t + T_WPOS]; wp_.y = TF[t + T_WPOS + 1]; wp_.z = TF[t + T_WPOS + 2];
        const wr_ = outT.worldRotation; wr_.x = TF[t + T_WROT]; wr_.y = TF[t + T_WROT + 1]; wr_.z = TF[t + T_WROT + 2]; wr_.w = TF[t + T_WROT + 3];
        const ws_ = outT.worldScale; ws_.x = TF[t + T_WSCL]; ws_.y = TF[t + T_WSCL + 1]; ws_.z = TF[t + T_WSCL + 2];

        // fillVelocity(...)
        const l_ = outV.linear; l_.x = VF[v + V_LIN]; l_.y = VF[v + V_LIN + 1]; l_.z = VF[v + V_LIN + 2];
        const a_ = outV.angular; a_.x = VF[v + V_ANG]; a_.y = VF[v + V_ANG + 1]; a_.z = VF[v + V_ANG + 2];

        // --- the system body the game author actually wrote ---
        outT.position.x += outV.linear.x * dt;
        outT.position.y += outV.linear.y * dt;
        outT.position.z += outV.linear.z * dt;

        // writeTransform(f32, u32, u8, ptr, data) — every field, readonly ones included
        TF[t + T_POS] = outT.position.x; TF[t + T_POS + 1] = outT.position.y; TF[t + T_POS + 2] = outT.position.z;
        TF[t + T_ROT] = outT.rotation.x; TF[t + T_ROT + 1] = outT.rotation.y; TF[t + T_ROT + 2] = outT.rotation.z; TF[t + T_ROT + 3] = outT.rotation.w;
        TF[t + T_SCL] = outT.scale.x; TF[t + T_SCL + 1] = outT.scale.y; TF[t + T_SCL + 2] = outT.scale.z;
        TF[t + T_WPOS] = outT.worldPosition.x; TF[t + T_WPOS + 1] = outT.worldPosition.y; TF[t + T_WPOS + 2] = outT.worldPosition.z;
        TF[t + T_WROT] = outT.worldRotation.x; TF[t + T_WROT + 1] = outT.worldRotation.y; TF[t + T_WROT + 2] = outT.worldRotation.z; TF[t + T_WROT + 3] = outT.worldRotation.w;
        TF[t + T_WSCL] = outT.worldScale.x; TF[t + T_WSCL + 1] = outT.worldScale.y; TF[t + T_WSCL + 2] = outT.worldScale.z;

        changed[e] = 1;   // world.markChanged(entity, component)
    }
};

// ---------------------------------------------------------------------------
// B — in-place view.
//
// The game author's code is UNCHANGED: still `t.position.x += v.linear.x * dt`.
// What changed is that `t.position` is a reused object whose x/y/z are accessors
// onto the component bytes, so nothing is copied in and nothing is written back.
// One object graph for the whole query, retargeted per entity by moving `base`.
//
// This is the honest shape of the cheap fix: the accessor CALLS are still paid,
// which is exactly what makes it different from B2 and from C.
// ---------------------------------------------------------------------------
function vec3View(get, set) {
    return {
        get x() { return TF[get() + 0]; }, set x(n) { TF[set() + 0] = n; },
        get y() { return TF[get() + 1]; }, set y(n) { TF[set() + 1] = n; },
        get z() { return TF[get() + 2]; }, set z(n) { TF[set() + 2] = n; },
    };
}

let tBase = 0, vBase = 0;
const viewT = {
    position: {
        get x() { return TF[tBase + T_POS]; }, set x(n) { TF[tBase + T_POS] = n; },
        get y() { return TF[tBase + T_POS + 1]; }, set y(n) { TF[tBase + T_POS + 1] = n; },
        get z() { return TF[tBase + T_POS + 2]; }, set z(n) { TF[tBase + T_POS + 2] = n; },
    },
};
const viewV = {
    linear: {
        get x() { return VF[vBase + V_LIN]; },
        get y() { return VF[vBase + V_LIN + 1]; },
        get z() { return VF[vBase + V_LIN + 2]; },
    },
};

globalThis.variantB = function (dt) {
    const t = viewT, v = viewV;
    for (let i = 0; i < N; i++) {
        const e = ents[i];
        const row = sparse[e];
        tBase = row * TW;
        vBase = row * VW;

        // --- byte-for-byte the same system body as variant A ---
        t.position.x += v.linear.x * dt;
        t.position.y += v.linear.y * dt;
        t.position.z += v.linear.z * dt;

        changed[e] = 1;
    }
};

// ---------------------------------------------------------------------------
// B2 — raw indexing. No object layer at all.
//
// Not a shippable API — a game author will not write this. It is the FLOOR for
// interpreted JS, and it is what separates "the object layer costs this much"
// from "the interpreter costs this much". Without it, B -> C conflates the two.
// ---------------------------------------------------------------------------
globalThis.variantB2 = function (dt) {
    for (let i = 0; i < N; i++) {
        const e = ents[i];
        const row = sparse[e];
        const t = row * TW;
        const v = row * VW;
        TF[t] = TF[t] + VF[v] * dt;
        TF[t + 1] = TF[t + 1] + VF[v + 1] * dt;
        TF[t + 2] = TF[t + 2] + VF[v + 2] * dt;
        changed[e] = 1;
    }
};

// vec3View is declared for symmetry with a real SDK implementation but is not on
// the measured path; referencing it keeps a minifier or a reader from assuming
// variant B builds its views per entity.
globalThis.__unused_vec3View = vec3View;

// ===========================================================================
// THICK BODY
//
// Everything above integrates velocity in three multiply-adds. That is a real
// system — it is the one bench/nojit-frame-bench.mjs runs — but it is also the
// case that flatters AOT most, because almost none of the frame is arithmetic:
// it is the interpreter's dispatch and the SDK's write-back. Reporting only that
// number would be measuring the benchmark instead of the engine.
//
// So the same four variants get a second body with the arithmetic a movement
// system actually carries: a speed clamp (with a sqrt) and a wrap into bounds.
// ~25 flops and two branches per entity instead of three multiply-adds. The
// honest answer for a real game is bracketed by the two.
//
// Written with locals and ONE store per field, in every variant, so all four
// stay bit-identical: Math.sqrt and std::sqrt are both correctly rounded, and
// nothing rounds to f32 until the final store.
// ===========================================================================
const MAXSPEED = 50.0;   // velocities reach ~85, so the clamp fires for roughly half — the sqrt must be LIVE and the branch unpredictable, or "thick" is just "thin with dead code"
const MAXSPEED2 = MAXSPEED * MAXSPEED;
const BOUND = 1000.0;
const BOUND2 = BOUND * 2.0;

globalThis.variantA_thick = function (dt) {
    for (let i = 0; i < N; i++) {
        const e = ents[i];
        const row = sparse[e];
        const t = row * TW;
        const v = row * VW;

        const p_ = outT.position; p_.x = TF[t + T_POS]; p_.y = TF[t + T_POS + 1]; p_.z = TF[t + T_POS + 2];
        const r_ = outT.rotation; r_.x = TF[t + T_ROT]; r_.y = TF[t + T_ROT + 1]; r_.z = TF[t + T_ROT + 2]; r_.w = TF[t + T_ROT + 3];
        const s_ = outT.scale; s_.x = TF[t + T_SCL]; s_.y = TF[t + T_SCL + 1]; s_.z = TF[t + T_SCL + 2];
        const wp_ = outT.worldPosition; wp_.x = TF[t + T_WPOS]; wp_.y = TF[t + T_WPOS + 1]; wp_.z = TF[t + T_WPOS + 2];
        const wr_ = outT.worldRotation; wr_.x = TF[t + T_WROT]; wr_.y = TF[t + T_WROT + 1]; wr_.z = TF[t + T_WROT + 2]; wr_.w = TF[t + T_WROT + 3];
        const ws_ = outT.worldScale; ws_.x = TF[t + T_WSCL]; ws_.y = TF[t + T_WSCL + 1]; ws_.z = TF[t + T_WSCL + 2];

        const l_ = outV.linear; l_.x = VF[v + V_LIN]; l_.y = VF[v + V_LIN + 1]; l_.z = VF[v + V_LIN + 2];
        const a_ = outV.angular; a_.x = VF[v + V_ANG]; a_.y = VF[v + V_ANG + 1]; a_.z = VF[v + V_ANG + 2];

        // --- the system body ---
        let vx = outV.linear.x, vy = outV.linear.y, vz = outV.linear.z;
        const sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > MAXSPEED2) { const s = MAXSPEED / Math.sqrt(sp2); vx *= s; vy *= s; vz *= s; }
        let px = outT.position.x + vx * dt;
        let py = outT.position.y + vy * dt;
        const pz = outT.position.z + vz * dt;
        if (px > BOUND) px -= BOUND2; else if (px < -BOUND) px += BOUND2;
        if (py > BOUND) py -= BOUND2; else if (py < -BOUND) py += BOUND2;
        outT.position.x = px; outT.position.y = py; outT.position.z = pz;

        TF[t + T_POS] = outT.position.x; TF[t + T_POS + 1] = outT.position.y; TF[t + T_POS + 2] = outT.position.z;
        TF[t + T_ROT] = outT.rotation.x; TF[t + T_ROT + 1] = outT.rotation.y; TF[t + T_ROT + 2] = outT.rotation.z; TF[t + T_ROT + 3] = outT.rotation.w;
        TF[t + T_SCL] = outT.scale.x; TF[t + T_SCL + 1] = outT.scale.y; TF[t + T_SCL + 2] = outT.scale.z;
        TF[t + T_WPOS] = outT.worldPosition.x; TF[t + T_WPOS + 1] = outT.worldPosition.y; TF[t + T_WPOS + 2] = outT.worldPosition.z;
        TF[t + T_WROT] = outT.worldRotation.x; TF[t + T_WROT + 1] = outT.worldRotation.y; TF[t + T_WROT + 2] = outT.worldRotation.z; TF[t + T_WROT + 3] = outT.worldRotation.w;
        TF[t + T_WSCL] = outT.worldScale.x; TF[t + T_WSCL + 1] = outT.worldScale.y; TF[t + T_WSCL + 2] = outT.worldScale.z;

        changed[e] = 1;
    }
};

globalThis.variantB_thick = function (dt) {
    const t = viewT, v = viewV;
    for (let i = 0; i < N; i++) {
        const e = ents[i];
        const row = sparse[e];
        tBase = row * TW;
        vBase = row * VW;

        let vx = v.linear.x, vy = v.linear.y, vz = v.linear.z;
        const sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > MAXSPEED2) { const s = MAXSPEED / Math.sqrt(sp2); vx *= s; vy *= s; vz *= s; }
        let px = t.position.x + vx * dt;
        let py = t.position.y + vy * dt;
        const pz = t.position.z + vz * dt;
        if (px > BOUND) px -= BOUND2; else if (px < -BOUND) px += BOUND2;
        if (py > BOUND) py -= BOUND2; else if (py < -BOUND) py += BOUND2;
        t.position.x = px; t.position.y = py; t.position.z = pz;

        changed[e] = 1;
    }
};

globalThis.variantB2_thick = function (dt) {
    for (let i = 0; i < N; i++) {
        const e = ents[i];
        const row = sparse[e];
        const t = row * TW;
        const v = row * VW;

        let vx = VF[v], vy = VF[v + 1], vz = VF[v + 2];
        const sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > MAXSPEED2) { const s = MAXSPEED / Math.sqrt(sp2); vx *= s; vy *= s; vz *= s; }
        let px = TF[t] + vx * dt;
        let py = TF[t + 1] + vy * dt;
        const pz = TF[t + 2] + vz * dt;
        if (px > BOUND) px -= BOUND2; else if (px < -BOUND) px += BOUND2;
        if (py > BOUND) py -= BOUND2; else if (py < -BOUND) py += BOUND2;
        TF[t] = px; TF[t + 1] = py; TF[t + 2] = pz;

        changed[e] = 1;
    }
};
