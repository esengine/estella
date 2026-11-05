// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./VoxelGI.hpp"
#include "./FrameConstants.hpp"
#include "./RenderContext.hpp"
#include "../RenderOrigin.hpp"
#include <glm/gtc/type_ptr.hpp>
#include "../rhi/GfxDevice.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

namespace esengine {

namespace {

/// Eight u32 per voxel: radiance r, g, b (fixed point), a sample count, the facing x, y, z (fixed point), and how much of the
/// voxel the surfaces in it cover (the area they put in it, over a face of the voxel, fixed point).
constexpr u32 kVoxelWords = 8;

#ifdef ES_ENABLE_WEBGPU
/// What every kernel sees at group 0: the frame, the cache's parameters and the cache itself.
const char* kCommon = R"WGSL(
struct Frame { projection : mat4x4f, camera : vec4f, inverseViewProjection : mat4x4f, renderOrigin : vec4f };
struct GI {
    origin : vec4i,   // xyz: the window's first cell; w: the frame
    dims : vec4u,     // xyz: voxels per axis; w: rays per point
    a : vec4f,        // x: voxel size, y: what the grid keeps, z: the brightest a surface gives, w: intensity
    b : vec4f,        // x: how far a ray looks (cells), y: where it starts (cells), z: how much of the last bounce feeds back, w: debug
    view : vec4f,     // x: the gather's divisor, y: 1 when the last gather is a history to blend with, z: how much of this one goes in
    prevViewProjection : mat4x4f,
};
@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<uniform> gi : GI;
@group(0) @binding(2) var<storage, read_write> grid : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> tags : array<u32>;

const WORDS : u32 = 8u;
const FIXED : f32 = 1024.0;
const FACING : f32 = 256.0;
// A sample counts COUNT, not 1: the grid ages by a factor below one each frame and truncates, and a count of 1 aged to 0.93 truncates
// to 0 — a voxel that one sample a frame lands in (a small voxel, or one far away) then never reached the 2 a ray asks for, and a
// fine grid drew no bounce at all.
const COUNT : u32 = 16u;
// The covered area, in AREA parts of one voxel face. A ray that meets a voxel takes its light in proportion to how much of the voxel
// a surface fills: averaged over a whole voxel, a bright patch that fills a corner of one would otherwise light like the whole voxel,
// which spreads every light by up to a voxel and makes a coarse grid brighter than a fine one.
const AREA : f32 = 4096.0;
fn addArea(base : u32, area : f32) {
    let vs = gi.a.x;
    atomicAdd(&grid[base + 7u], u32(clamp(area / (vs * vs), 0.0, 1.0) * AREA));
}

// Set on a slot's tag by the inject when the picture showed its cell this frame, and cleared by the maintain each frame.
const SEEN : u32 = 2u;
fn hash3(c : vec3i) -> u32 {
    var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u);
    h = (h ^ (h >> 16u)) * 0x45d9f3bu;
    h = h ^ (h >> 16u);
    // Bit 0 always set (no live cell hashes to 0, which an empty slot holds); bit 1 is not part of the hash, but the mark SEEN.
    return (h | 1u) & ~SEEN;
}
fn wrapIndex(cell : vec3i) -> u32 {
    let d = vec3i(gi.dims.xyz);
    let w = ((cell % d) + d) % d;
    return u32(w.x) + u32(w.y) * gi.dims.x + u32(w.z) * gi.dims.x * gi.dims.y;
}
fn inWindow(cell : vec3i) -> bool {
    let o = gi.origin.xyz;
    let d = vec3i(gi.dims.xyz);
    return all(cell >= o) && all(cell < o + d);
}
)WGSL";

/// What the depth, the G-buffer and the frame say about a pixel, shared by the kernels that read them.
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

/// Ages the grid, and hands cells that came into the window since last frame back empty.
const char* kMaintain = R"WGSL(
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let total = gi.dims.x * gi.dims.y * gi.dims.z;
    let i = id.x;
    if (i >= total) { return; }
    let g = vec3i(i32(i % gi.dims.x), i32((i / gi.dims.x) % gi.dims.y), i32(i / (gi.dims.x * gi.dims.y)));
    let d = vec3i(gi.dims.xyz);
    // The cell this slot stands for in the window as it is now: toroidal, so the window slides over the same memory.
    let rel = ((g - gi.origin.xyz) % d + d) % d;
    let cell = gi.origin.xyz + rel;
    let tag = hash3(cell);
    let base = i * WORDS;
    if ((tags[i] & ~SEEN) != tag) {
        tags[i] = tag;
        for (var k = 0u; k < WORDS; k = k + 1u) { atomicStore(&grid[base + k], 0u); }
    } else {
        tags[i] = tag;
        for (var k = 0u; k < WORDS; k = k + 1u) {
            atomicStore(&grid[base + k], u32(f32(atomicLoad(&grid[base + k])) * gi.a.y));
        }
    }
}
)WGSL";

/// The lit picture into the voxels its visible surfaces stand in, with the bounce light the last gather found on them: what a surface
/// gives off is what it was lit by, the bounce included, so each frame carries the light one surface further and the cache converges on
/// the light of every bounce rather than of the first.
const char* kInject = R"WGSL(
@group(0) @binding(4) var scene : texture_2d<f32>;
@group(0) @binding(5) var depthTex : texture_depth_2d;
@group(0) @binding(6) var gbuffer : texture_2d<f32>;
@group(0) @binding(8) var albedoTex : texture_2d<f32>;
@group(0) @binding(9) var histTex : texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let size = vec2i(textureDimensions(depthTex));
    let t = vec2i(id.xy) * 2;
    if (t.x >= size.x || t.y >= size.y) { return; }
    let depth = textureLoad(depthTex, t, 0);
    if (depth >= 1.0) { return; }
    let g = textureLoad(gbuffer, t, 0);
    if (g.a <= 0.7) { return; }
    var n = decodeNormal(g);
    let p = worldFromDepth((vec2f(t) + 0.5) / vec2f(size), depth);
    if (dot(n, viewDirection(p)) < 0.0) { n = -n; }
    let cell = vec3i(floor(p / gi.a.x));
    if (!inWindow(cell)) { return; }
    let base = wrapIndex(cell) * WORDS;
    // The surface this sample stands for: the two-by-two pixels around it, measured on the surface from the neighbours' depth
    // (which carries the slant). A neighbour off the surface (an edge) leaves the footprint the pixel's own square seen face on.
    let tx = select(t + vec2i(2, 0), t - vec2i(2, 0), t.x + 2 >= size.x);
    let ty = select(t + vec2i(0, 2), t - vec2i(0, 2), t.y + 2 >= size.y);
    let px = worldFromDepth((vec2f(tx) + 0.5) / vec2f(size), textureLoad(depthTex, tx, 0));
    let py = worldFromDepth((vec2f(ty) + 0.5) / vec2f(size), textureLoad(depthTex, ty, 0));
    var footprint = length(cross(px - p, py - p));
    let side = max(length(px - p), length(py - p));
    if (side > gi.a.x) {
        footprint = min(length(px - p), length(py - p));
        footprint = footprint * footprint;
    }
    addArea(base, footprint);
    // Every writer writes the same value, so the race is harmless.
    tags[wrapIndex(cell)] = hash3(cell) | SEEN;
    var lit = textureLoad(scene, t, 0).rgb;
    let albedo = textureLoad(albedoTex, t, 0);
    if (gi.view.y > 0.5 && albedo.a > 0.5) {
        let div = i32(gi.view.x);
        let q = clamp(t / div, vec2i(0), vec2i(textureDimensions(histTex)) - vec2i(1));
        lit = lit + albedo.rgb * textureLoad(histTex, q, 0).rgb * (gi.a.w * gi.b.z);
    }
    let c = clamp(lit, vec3f(0.0), vec3f(gi.a.z));
    atomicAdd(&grid[base], u32(c.r * FIXED));
    atomicAdd(&grid[base + 1u], u32(c.g * FIXED));
    atomicAdd(&grid[base + 2u], u32(c.b * FIXED));
    atomicAdd(&grid[base + 3u], COUNT);
    let f = n * 0.5 + 0.5;
    atomicAdd(&grid[base + 4u], u32(f.x * FACING));
    atomicAdd(&grid[base + 5u], u32(f.y * FACING));
    atomicAdd(&grid[base + 6u], u32(f.z * FACING));
}
)WGSL";

/// What the sun lights, whether the camera sees it or not: every texel of the sun shadow map is a surface the sun reaches, so the map
/// is read back into world positions (the inverse of each tile matrix) and their direct light injected where they stand. Its colour is
/// not in the map, so it is lit as a surface of one assumed albedo; where the camera also sees it, the picture colour averages in beside it.
const char* kSun = R"WGSL(
struct Sun {
    light : vec4f,                    // rgb: the sun colour times its intensity; w: the albedo a surface is taken to have
    toLight : vec4f,                  // xyz: unit vector toward the sun; w: how many tiles
    samples : vec4u,                  // x: samples per tile side
    rect : array<vec4f, 4>,           // each tile square in the atlas, low corner and side, in GL terms
    inverse : array<mat4x4f, 4>,      // each tile clip space back to the world
};
// The atlas holds depth packed into colour (what the lit shaders unpack), not a depth texture.
@group(0) @binding(4) var shadowTex : texture_2d<f32>;
@group(0) @binding(10) var<uniform> sun : Sun;

fn shadowPoint(k : u32, uv : vec2f, size : vec2f) -> vec4f {
    let rect = sun.rect[k];
    let base = vec2f(rect.x, 1.0 - rect.y - rect.z);
    let at = base + vec2f(uv.x, 1.0 - uv.y) * rect.z;
    let texel = clamp(vec2i(at * size), vec2i(0), vec2i(size) - vec2i(1));
    let c = textureLoad(shadowTex, texel, 0).rgb;
    let d = dot(c, vec3f(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    // The map stores clip z remapped to [0, 1] (z * 0.5 + 0.5, as the lit shaders compare it): undone before the inverse.
    let w = sun.inverse[k] * vec4f(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return vec4f(w.xyz / w.w, d);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let n = sun.samples.x;
    let k = id.x / n;
    if (k >= u32(sun.toLight.w) || id.y >= n) { return; }
    let size = vec2f(textureDimensions(shadowTex));
    let step = 1.0 / f32(n);
    let uv = (vec2f(f32(id.x % n), f32(id.y)) + 0.5) * step;
    let p = shadowPoint(k, uv, size);
    if (p.w >= 1.0 || p.w <= 0.0) { return; }
    let px = shadowPoint(k, uv + vec2f(step, 0.0), size).xyz;
    let py = shadowPoint(k, uv + vec2f(0.0, step), size).xyz;
    let vs = gi.a.x;
    // A neighbour across a depth edge (the top of a wall against the floor) gives no tangent: those samples carry no normal.
    let ex = px - p.xyz;
    let ey = py - p.xyz;
    if (length(ex) > vs * 4.0 || length(ey) > vs * 4.0) { return; }
    // Two neighbours on one texel (or on a line) give no plane: normalizing nothing is a NaN, and one NaN turned into the grid's
    // fixed point poisons every ray that meets its voxel.
    let cr = cross(ex, ey);
    let area = dot(cr, cr);
    if (!(area > 1e-12)) { return; }
    var nrm = cr * inverseSqrt(area);
    let L = sun.toLight.xyz;
    if (dot(nrm, L) < 0.0) { nrm = -nrm; }
    let cell = vec3i(floor((p.xyz + nrm * (vs * 0.25)) / vs));
    if (!inWindow(cell)) { return; }
    let base = wrapIndex(cell) * WORDS;
    // Where the picture has shown this voxel (the inject ran first this frame), its own colour is the better answer than an assumed
    // albedo: the sun's estimate is what stands in only where the camera has not looked.
    if ((tags[wrapIndex(cell)] & SEEN) != 0u) { return; }
    addArea(base, sqrt(area));
    let c = clamp(sun.light.rgb * (sun.light.w * max(dot(nrm, L), 0.0)), vec3f(0.0), vec3f(gi.a.z));
    atomicAdd(&grid[base], u32(c.r * FIXED));
    atomicAdd(&grid[base + 1u], u32(c.g * FIXED));
    atomicAdd(&grid[base + 2u], u32(c.b * FIXED));
    atomicAdd(&grid[base + 3u], COUNT);
    let f = nrm * 0.5 + 0.5;
    atomicAdd(&grid[base + 4u], u32(f.x * FACING));
    atomicAdd(&grid[base + 5u], u32(f.y * FACING));
    atomicAdd(&grid[base + 6u], u32(f.z * FACING));
}
)WGSL";

/// Rays from each visible surface through the grid, at a fraction of the picture size.
const char* kGather = R"WGSL(
@group(0) @binding(5) var depthTex : texture_depth_2d;
@group(0) @binding(6) var gbuffer : texture_2d<f32>;
@group(0) @binding(7) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var histTex : texture_2d<f32>;

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn cosineDirection(n : vec3f, u : f32, v : f32) -> vec3f {
    let r = sqrt(u);
    let phi = 6.2831853 * v;
    var up = vec3f(1.0, 0.0, 0.0);
    if (abs(n.y) < 0.99) { up = vec3f(0.0, 1.0, 0.0); }
    let t = normalize(cross(up, n));
    let b = cross(n, t);
    return normalize(t * (r * cos(phi)) + b * (r * sin(phi)) + n * sqrt(max(1.0 - u, 0.0)));
}

/// The light a ray from @p origin along @p dir brings: that of the first voxel it meets that faces it.
fn trace(origin : vec3f, dir : vec3f) -> vec3f {
    let vs = gi.a.x;
    let pos = origin / vs;
    var cell = vec3i(floor(pos));
    let stepv = vec3i(select(vec3f(-1.0), vec3f(1.0), dir >= vec3f(0.0)));
    let safe = select(dir, vec3f(1e-6), abs(dir) < vec3f(1e-6));
    let delta = abs(vec3f(1.0) / safe);
    let next = select(vec3f(cell), vec3f(cell + vec3i(1)), dir >= vec3f(0.0));
    var tMax = (next - pos) / safe;
    let range = gi.b.x;
    var t = 0.0;
    var acc = vec3f(0.0);
    var trans = 1.0;
    for (var i = 0; i < 96; i = i + 1) {
        if (t > range) { break; }
        // Step into the neighbouring cell along the axis whose boundary comes first.
        if (tMax.x < tMax.y && tMax.x < tMax.z) {
            cell.x = cell.x + stepv.x; t = tMax.x; tMax.x = tMax.x + delta.x;
        } else if (tMax.y < tMax.z) {
            cell.y = cell.y + stepv.y; t = tMax.y; tMax.y = tMax.y + delta.y;
        } else {
            cell.z = cell.z + stepv.z; t = tMax.z; tMax.z = tMax.z + delta.z;
        }
        if (!inWindow(cell)) { break; }
        let idx = wrapIndex(cell);
        if ((tags[idx] & ~SEEN) != hash3(cell)) { continue; }
        let base = idx * WORDS;
        let count = atomicLoad(&grid[base + 3u]);
        if (count < 2u * COUNT) { continue; }
        let inv = f32(COUNT) / f32(count);
        let facing = (vec3f(f32(atomicLoad(&grid[base + 4u])), f32(atomicLoad(&grid[base + 5u])), f32(atomicLoad(&grid[base + 6u]))) * inv / FACING) * 2.0 - 1.0;
        // A surface is met from the side it faces. One facing away is behind the ray, or the ray skims along it.
        if (dot(normalize(facing), dir) > -0.15) { continue; }
        let radiance = vec3f(f32(atomicLoad(&grid[base])), f32(atomicLoad(&grid[base + 1u])), f32(atomicLoad(&grid[base + 2u]))) * inv / FIXED;
        // The area aged the way every word is (a frame adds `a`, the sum settles at a / (1 - keep)), so one frame's worth of it is the
        // sum times (1 - keep). Two surfaces in one voxel (a corner) add past one face, which is a voxel fully covered.
        let covered = min(f32(atomicLoad(&grid[base + 7u])) / AREA * (1.0 - gi.a.y), 1.0);
        // What a ray meets is what it brings, however far it went: distance is already in how few rays reach a far surface. A fade over
        // the last stretch of the range only, so the edge of what a ray can see does not draw a line. (A falloff over the whole range had
        // darkened every bounce by its distance: 40% at 4 m with 12 cm voxels.)
        // A voxel a surface only partly fills lets the rest of the ray through to what stands behind it.
        acc = acc + trans * covered * radiance * clamp((range - t) / (range * 0.15), 0.0, 1.0);
        trans = trans * (1.0 - covered);
        if (trans < 0.05) { return acc; }
    }
    return acc;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let lowSize = vec2i(textureDimensions(outTex));
    let p = vec2i(id.xy);
    if (p.x >= lowSize.x || p.y >= lowSize.y) { return; }
    let size = vec2i(textureDimensions(depthTex));
    let div = i32(gi.view.x);
    let t = min(p * div + vec2i(i32(gi.origin.w) % div, (i32(gi.origin.w) / div) % div), size - vec2i(1));
    let depth = textureLoad(depthTex, t, 0);
    let g = textureLoad(gbuffer, t, 0);
    if (depth >= 1.0 || g.a <= 0.7) {
        textureStore(outTex, p, vec4f(0.0));
        return;
    }
    var n = decodeNormal(g);
    let world = worldFromDepth((vec2f(t) + 0.5) / vec2f(size), depth);
    if (dot(n, viewDirection(world)) < 0.0) { n = -n; }
    let origin = world + n * (gi.a.x * gi.b.y);

    let rays = i32(gi.dims.w);
    let r1 = ign(vec2f(p) + vec2f(0.0, f32(gi.origin.w % 16)));
    let r2 = ign(vec2f(p.yx) + vec2f(f32(gi.origin.w % 16) * 5.588238, 0.0));
    var sum = vec3f(0.0);
    for (var k = 0; k < rays; k = k + 1) {
        let u = fract((f32(k) + 0.5) / f32(rays) + r1);
        let v = fract(f32(k) * 0.61803399 + r2);
        sum = sum + trace(origin, cosineDirection(n, u, v));
    }
    var light = sum / f32(rays);
    // What the last frames agreed on, found where this surface was in the last frame's picture.
    if (gi.view.y > 0.5) {
        let prevClip = gi.prevViewProjection * vec4f(world, 1.0);
        if (prevClip.w > 1e-4) {
            let ndc = prevClip.xy / prevClip.w;
            let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
            if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
                let q = clamp(vec2i(uv * vec2f(lowSize)), vec2i(0), lowSize - vec2i(1));
                light = mix(textureLoad(histTex, q, 0).rgb, light, gi.view.z);
            }
        }
    }
    textureStore(outTex, p, vec4f(light, 1.0));
}
)WGSL";

/// The gathered light over the picture, upsampled with the depth so it does not bleed across an edge.
const char* kApply = R"WGSL(
@group(0) @binding(4) var scene : texture_2d<f32>;
@group(0) @binding(5) var depthTex : texture_depth_2d;
@group(0) @binding(6) var albedoTex : texture_2d<f32>;
@group(0) @binding(7) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var giTex : texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let size = vec2i(textureDimensions(depthTex));
    let t = vec2i(id.xy);
    if (t.x >= size.x || t.y >= size.y) { return; }
    let src = textureLoad(scene, t, 0);
    let lowSize = vec2i(textureDimensions(giTex));
    let div = i32(gi.view.x);
    let depth = textureLoad(depthTex, t, 0);
    var light = vec3f(0.0);
    if (depth < 1.0) {
        // A depth-weighted blend of the low-resolution texels around the pixel: the ones on the same surface count, the ones
        // across an edge do not. The window is wider than the bilinear four, which is what smooths the rays' noise.
        let centre = vec2i(floor((vec2f(t) + 0.5) / f32(div) - 0.5));
        var total = 0.0;
        var acc = vec3f(0.0);
        for (var dy = -1; dy <= 2; dy = dy + 1) {
            for (var dx = -1; dx <= 2; dx = dx + 1) {
                let q = clamp(centre + vec2i(dx, dy), vec2i(0), lowSize - vec2i(1));
                let qd = textureLoad(depthTex, min(q * div, size - vec2i(1)), 0);
                if (qd >= 1.0) { continue; }
                let near = abs(vec2f(t) / f32(div) - 0.5 - vec2f(q));
                let spatial = max(1.0 - 0.4 * (near.x + near.y), 0.05);
                // Depth is nonlinear: it is the ratio of what is left to the far plane that says how far apart two surfaces are.
                let w = spatial * exp(-abs(log((1.0 - qd + 1e-6) / (1.0 - depth + 1e-6))) * 24.0);
                acc = acc + textureLoad(giTex, q, 0).rgb * w;
                total = total + w;
            }
        }
        if (total > 1e-4) { light = acc / total; }
    }
    // What the gathered light is lit onto reflects it by its own diffuse colour, which the surface wrote beside its
    // normal. A surface that wrote none (a shader older than the attachment) has its colour guessed from the picture.
    let written = textureLoad(albedoTex, t, 0);
    let lum = max(dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.02);
    let guessed = mix(vec3f(0.55), clamp(src.rgb / lum, vec3f(0.0), vec3f(1.6)) * 0.55, 0.7);
    let albedo = select(guessed, written.rgb, written.a > 0.5);
    var result = src.rgb + albedo * light * gi.a.w;
    if (gi.b.w > 0.5) { result = light * gi.a.w; }
    textureStore(outTex, t, vec4f(result, src.a));
}
)WGSL";
#else
// The kernels are WGSL and only the WebGPU device runs them: a build without it (WeChat, playables) carries none of the text.
const char* const kCommon = "";
const char* const kSurface = "";
const char* const kMaintain = "";
const char* const kInject = "";
const char* const kSun = "";
const char* const kGather = "";
const char* const kApply = "";
#endif

std::string join(const char* a, const char* b, const char* c = "") {
    return std::string(a) + b + c;
}

struct ParamsBlock {
    i32 origin[4];
    u32 dims[4];
    f32 a[4];
    f32 b[4];
    f32 view[4];
    f32 prevViewProjection[16];
};
static_assert(sizeof(ParamsBlock) == 144, "the GI block is five vec4s and a matrix");

/// The sun shadow tiles as the sun kernel reads them back (see kSun).
struct SunBlock {
    f32 light[4];
    f32 toLight[4];
    u32 samples[4];
    f32 rect[4][4];
    f32 inverse[4][16];
};
static_assert(sizeof(SunBlock) == 368, "the sun block is three vec4s, four rects and four matrices");
constexpr u32 kSunTiles = 4;

}  // namespace

VoxelGI::VoxelGI(GfxDevice& device, RenderContext& context) : device_(device), context_(context) {}

VoxelGI::~VoxelGI() {
    release();
}

void VoxelGI::release() {
    for (BufferHandle* b : {&grid_, &tags_, &params_, &sun_}) {
        if (*b != BufferHandle::Invalid) device_.deleteBuffer(*b);
        *b = BufferHandle::Invalid;
    }
    for (TextureHandle& t : history_) {
        if (t != TextureHandle::Invalid) device_.deleteTexture(t);
        t = TextureHandle::Invalid;
    }
    historyWidth_ = historyHeight_ = 0;
    historyValid_ = false;
    for (ComputeHandle* c : {&maintain_, &inject_, &gather_, &apply_, &sunInject_}) {
        if (*c != ComputeHandle::Invalid) device_.deleteCompute(*c);
        *c = ComputeHandle::Invalid;
    }
    failed_ = false;
}

bool VoxelGI::ensure() {
    if (failed_) return false;
    if (!device_.supportsCompute()) return false;
    const u32 voxels = kDimsX * kDimsY * kDimsZ;
    if (grid_ == BufferHandle::Invalid) {
        grid_ = device_.createBuffer({GfxBufferUsage::Storage, voxels * kVoxelWords * 4u, false}, GfxContent::transient(), nullptr);
        tags_ = device_.createBuffer({GfxBufferUsage::Storage, voxels * 4u, false}, GfxContent::transient(), nullptr);
        params_ = device_.createBuffer({GfxBufferUsage::Uniform, sizeof(ParamsBlock), true}, GfxContent::transient(), nullptr);
        sun_ = device_.createBuffer({GfxBufferUsage::Uniform, sizeof(SunBlock), true}, GfxContent::transient(), nullptr);
    }
    if (grid_ == BufferHandle::Invalid || tags_ == BufferHandle::Invalid || params_ == BufferHandle::Invalid
        || sun_ == BufferHandle::Invalid) {
        ES_LOG_ERROR("VoxelGI: could not allocate the voxel cache");
        failed_ = true;
        return false;
    }
    const auto make = [&](ComputeHandle& handle, const std::string& source, const char* name) {
        if (handle != ComputeHandle::Invalid) return true;
        std::string log;
        handle = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, source.c_str(), "main"}, &log);
        if (handle == ComputeHandle::Invalid) {
            ES_LOG_ERROR("VoxelGI: the {} kernel did not compile: {}", name, log);
            failed_ = true;
            return false;
        }
        return true;
    };
    return make(maintain_, join(kCommon, kMaintain), "maintain") && make(inject_, join(kCommon, kSurface, kInject), "inject")
        && make(gather_, join(kCommon, kSurface, kGather), "gather") && make(apply_, join(kCommon, kApply), "apply")
        && make(sunInject_, join(kCommon, kSun), "sun");
}

bool VoxelGI::ensureHistory(u32 width, u32 height) {
    if (history_[0] != TextureHandle::Invalid && historyWidth_ == width && historyHeight_ == height) return true;
    for (TextureHandle& t : history_) {
        if (t != TextureHandle::Invalid) device_.deleteTexture(t);
        t = TextureHandle::Invalid;
    }
    historyValid_ = false;
    TextureDesc desc;
    desc.width = width;
    desc.height = height;
    desc.format = GfxPixelFormat::RGBA16F;
    desc.minFilter = desc.magFilter = TextureFilter::Nearest;
    desc.storage = true;
    for (TextureHandle& t : history_) t = device_.createTexture(desc, GfxContent::transient(), nullptr);
    if (history_[0] == TextureHandle::Invalid || history_[1] == TextureHandle::Invalid) {
        ES_LOG_ERROR("VoxelGI: could not allocate the gather history");
        return false;
    }
    historyWidth_ = width;
    historyHeight_ = height;
    return true;
}

void VoxelGI::writeParams(const VoxelGIParams& p) {
    // The window is centred on the eye, snapped to whole cells so the grid does not swim as the camera moves.
    const glm::vec4 eye = cameraFromViewProjection(context_.viewProjection());
    const f32 vs = std::max(p.voxelSize, 0.001f);
    ParamsBlock block{};
    block.origin[0] = static_cast<i32>(std::floor(eye.x / vs)) - static_cast<i32>(kDimsX / 2);
    block.origin[1] = static_cast<i32>(std::floor(eye.y / vs)) - static_cast<i32>(kDimsY / 2);
    block.origin[2] = static_cast<i32>(std::floor(eye.z / vs)) - static_cast<i32>(kDimsZ / 2);
    block.origin[3] = static_cast<i32>(frame_);
    block.dims[0] = kDimsX;
    block.dims[1] = kDimsY;
    block.dims[2] = kDimsZ;
    block.dims[3] = std::clamp(p.rays, 1u, 64u);
    block.a[0] = vs;
    block.a[1] = std::clamp(p.decay, 0.0f, 0.999f);
    block.a[2] = std::max(p.maxBounce, 0.01f);
    block.a[3] = p.intensity;
    block.b[0] = std::clamp(p.range, 1.0f, 90.0f);
    block.b[1] = std::max(p.bias, 0.0f);
    block.b[2] = std::clamp(p.bounceFeedback, 0.0f, 1.0f);
    block.b[3] = p.debug;
    block.view[0] = static_cast<f32>(std::clamp(p.divisor, 1u, 4u));
    // A change of voxel size makes every voxel a different place, so what was gathered under the old one is not history.
    if (previousVoxelSize_ != vs) historyValid_ = false;
    previousVoxelSize_ = vs;
    block.view[1] = historyValid_ ? 1.0f : 0.0f;
    block.view[2] = std::clamp(p.blend, 0.01f, 1.0f);
    // A view of a frame drawn from another origin is taken to this one, and what was gathered under it is not history.
    if (previousOrigin_ != renderOrigin()) historyValid_ = false;
    {
        const glm::mat4 previous = viewProjectionFromOrigin(glm::make_mat4(previousViewProjection_), previousOrigin_);
        std::copy(glm::value_ptr(previous), glm::value_ptr(previous) + 16, block.prevViewProjection);
    }
    previousOrigin_ = renderOrigin();
    const glm::mat4& vp = context_.viewProjection();
    for (int c = 0; c < 4; ++c) for (int r = 0; r < 4; ++r) previousViewProjection_[c * 4 + r] = vp[c][r];
    device_.updateBuffer(params_, 0, &block, sizeof(block));
    origin_[0] = block.origin[0];
    origin_[1] = block.origin[1];
    origin_[2] = block.origin[2];
    ++frame_;
}

u32 VoxelGI::writeSun(const VoxelGIParams& p) {
    // The first directional light that owns shadow tiles: the sun whose map says what it reaches.
    const LightConstants& lc = context_.lights().data();
    if (lc.shadowParams.x < 0.5f || p.sunAlbedo <= 0.0f) return 0;
    // Every slot, not a count: an empty slot reads as no light (zero colour, zero tiles).
    for (u32 i = 0; i < MAX_LIGHTS; ++i) {
        const GpuLight& l = lc.lights[i];
        const bool directional = l.posDir.z > 0.5f && l.posDir.z < 1.5f;
        const u32 tiles = static_cast<u32>(std::fmod(std::max(l.shadowMap.y, 0.0f), LIGHT_TILE_BITS));
        if (!directional || tiles == 0) continue;
        const u32 first = static_cast<u32>(std::max(l.shadowMap.x, 0.0f));
        if (first >= MAX_SHADOW_TILES) continue;
        SunBlock block{};
        const glm::vec3 aim = glm::normalize(glm::vec3(l.posDir.x, l.posDir.y, l.posDir.w));
        block.light[0] = l.color.r * l.color.a;
        block.light[1] = l.color.g * l.color.a;
        block.light[2] = l.color.b * l.color.a;
        block.light[3] = p.sunAlbedo;
        block.toLight[0] = -aim.x;
        block.toLight[1] = -aim.y;
        block.toLight[2] = -aim.z;
        const u32 used = std::min({tiles, kSunTiles, MAX_SHADOW_TILES - first});
        block.toLight[3] = static_cast<f32>(used);
        block.samples[0] = kSunSamples;
        for (u32 k = 0; k < used; ++k) {
            const glm::vec4& r = lc.shadowTile[first + k];
            block.rect[k][0] = r.x; block.rect[k][1] = r.y; block.rect[k][2] = r.z; block.rect[k][3] = r.w;
            const glm::mat4 inv = glm::inverse(lc.shadowMatrix[first + k]);
            std::copy(glm::value_ptr(inv), glm::value_ptr(inv) + 16, block.inverse[k]);
        }
        device_.updateBuffer(sun_, 0, &block, sizeof(block));
        return used;
    }
    return 0;
}

rg::ResourceId VoxelGI::declare(rg::RenderGraph& graph, rg::ResourceId input, rg::ResourceId scene, const VoxelGIParams& params,
                                u32 width, u32 height, TextureHandle shadowAtlas, rg::ResourceId shadowResource) {
    if (!ensure() || input == rg::kNoResource || scene == rg::kNoResource) return input;

    // The passes are tied together by what each writes, since the graph only runs what the image reaches. The first two write a
    // single texel nobody samples: their work is in the grid, and the texel is what says "this ran before that".
    rg::TargetDesc token;
    token.width = 1;
    token.height = 1;
    token.format = GfxPixelFormat::RGBA8;
    token.storage = true;
    token.linearFilter = false;

    const u32 divisor = std::clamp(params.divisor, 1u, 4u);
    const VoxelGIParams p = params;
    // The size the graph gives a target at 1 / divisor: the history has to be exactly that.
    const f32 scale = 1.0f / static_cast<f32>(divisor);
    const u32 lowWidth = std::max(1u, static_cast<u32>(static_cast<f32>(width) * scale));
    const u32 lowHeight = std::max(1u, static_cast<u32>(static_cast<f32>(height) * scale));
    if (!ensureHistory(lowWidth, lowHeight)) return input;
    // This frame writes one of the two and reads the other.
    const u32 cur = frame_ & 1u;

    const rg::ResourceId maintainDone = graph.createTarget(token);
    {
        rg::PassDesc pass;
        pass.name = "gi_maintain";
        pass.compute = true;
        pass.write = maintainDone;
        pass.dependencies = {scene};
        pass.execute = [this, p](const rg::PassContext&) {
            writeParams(p);
            const GfxComputeBinding bindings[4] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storage(2, grid_),
                GfxComputeBinding::storage(3, tags_),
            };
            device_.dispatchCompute(maintain_, bindings, 4, (kDimsX * kDimsY * kDimsZ + 63) / 64);
        };
        graph.addPass(std::move(pass));
    }

    const rg::ResourceId injectDone = graph.createTarget(token);
    {
        rg::PassDesc pass;
        pass.name = "gi_inject";
        pass.compute = true;
        pass.reads = {input};
        pass.dependencies = {scene, maintainDone};
        pass.write = injectDone;
        pass.execute = [this, &graph, scene, width, height, cur](const rg::PassContext& ctx) {
            const TextureHandle depth = graph.depthTextureOf(scene);
            const TextureHandle gbuffer = graph.gbufferTextureOf(scene);
            const TextureHandle albedo = graph.albedoTextureOf(scene);
            if (depth == TextureHandle::Invalid || gbuffer == TextureHandle::Invalid || albedo == TextureHandle::Invalid) return;
            const GfxComputeBinding bindings[9] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storage(2, grid_),
                GfxComputeBinding::storage(3, tags_),
                GfxComputeBinding::sampled(4, ctx.input(0)),
                GfxComputeBinding::depth(5, depth),
                GfxComputeBinding::sampled(6, gbuffer),
                GfxComputeBinding::sampled(8, albedo),
                // The last frame gather: written by the gather of the frame before, so the other of the two.
                GfxComputeBinding::sampled(9, history_[cur ^ 1u]),
            };
            device_.dispatchCompute(inject_, bindings, 9, (width / 2 + 7) / 8, (height / 2 + 7) / 8);
        };
        graph.addPass(std::move(pass));
    }

    // The sun own light into the grid, after the picture and before anything reads it.
    rg::ResourceId sunDone = injectDone;
    if (shadowAtlas != TextureHandle::Invalid && shadowResource != rg::kNoResource && p.sunAlbedo > 0.0f) {
        sunDone = graph.createTarget(token);
        rg::PassDesc pass;
        pass.name = "gi_sun";
        pass.compute = true;
        pass.dependencies = {shadowResource, injectDone};
        pass.write = sunDone;
        pass.execute = [this, p, shadowAtlas](const rg::PassContext&) {
            const u32 tiles = writeSun(p);
            if (tiles == 0) return;
            const GfxComputeBinding bindings[6] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storage(2, grid_),
                GfxComputeBinding::storage(3, tags_),
                GfxComputeBinding::sampled(4, shadowAtlas),
                GfxComputeBinding::uniform(10, sun_),
            };
            device_.dispatchCompute(sunInject_, bindings, 6, (kSunSamples * tiles + 7) / 8, (kSunSamples + 7) / 8);
        };
        graph.addPass(std::move(pass));
    }

    const rg::ResourceId gathered = graph.createTarget(token);
    {
        rg::PassDesc pass;
        pass.name = "gi_gather";
        pass.compute = true;
        pass.dependencies = {scene, sunDone};
        pass.write = gathered;
        pass.execute = [this, &graph, scene, cur](const rg::PassContext&) {
            const TextureHandle depth = graph.depthTextureOf(scene);
            const TextureHandle gbuffer = graph.gbufferTextureOf(scene);
            if (depth == TextureHandle::Invalid || gbuffer == TextureHandle::Invalid) return;
            const GfxComputeBinding bindings[8] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storage(2, grid_),
                GfxComputeBinding::storage(3, tags_),
                GfxComputeBinding::depth(5, depth),
                GfxComputeBinding::sampled(6, gbuffer),
                GfxComputeBinding::storageTexture(7, history_[cur]),
                GfxComputeBinding::sampled(9, history_[cur ^ 1u]),
            };
            device_.dispatchCompute(gather_, bindings, 8, (historyWidth_ + 7) / 8, (historyHeight_ + 7) / 8);
            historyValid_ = true;
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
        pass.name = "gi_apply";
        pass.compute = true;
        pass.reads = {input};
        pass.dependencies = {scene, gathered};
        pass.write = result;
        pass.execute = [this, &graph, scene, cur](const rg::PassContext& ctx) {
            const TextureHandle depth = graph.depthTextureOf(scene);
            const TextureHandle albedo = graph.albedoTextureOf(scene);
            if (depth == TextureHandle::Invalid || albedo == TextureHandle::Invalid
                || ctx.output == TextureHandle::Invalid) return;
            const GfxComputeBinding bindings[9] = {
                GfxComputeBinding::uniform(0, context_.frameUbo()),
                GfxComputeBinding::uniform(1, params_),
                GfxComputeBinding::storage(2, grid_),
                GfxComputeBinding::storage(3, tags_),
                GfxComputeBinding::sampled(4, ctx.input(0)),
                GfxComputeBinding::depth(5, depth),
                GfxComputeBinding::sampled(6, albedo),
                GfxComputeBinding::storageTexture(7, ctx.output),
                GfxComputeBinding::sampled(8, history_[cur]),
            };
            device_.dispatchCompute(apply_, bindings, 9, (ctx.width + 7) / 8, (ctx.height + 7) / 8);
        };
        graph.addPass(std::move(pass));
    }
    return result;
}

}  // namespace esengine
