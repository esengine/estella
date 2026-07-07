// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WGSLTwins.hpp
 * @brief   Hand-authored WGSL twins of the engine's embedded shaders (REARCH_WGSL Phase 2).
 * @details Each twin mirrors its .esshader source line for line: same attribute
 *          locations, same UBO blocks at the same binding slots (group 0), and
 *          the multi-texture set as bind group 1 — 8 texture_2d at bindings 0..7
 *          paired with 8 samplers at bindings 8..15 (GL's combined
 *          texture+sampler state arrives de-combined; sampler i carries texture
 *          i's filter/wrap params). Consumed by the WebGPU bring-up today and by
 *          the engine's WGSL program selection when the backend reports WGSL;
 *          Phase 3's dual-language emitter replaces the hand-written pairs.
 *
 *          Compiled only under ES_ENABLE_WEBGPU; never part of the GL build.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

namespace esengine::webgpu {

// =============================================================================
// shape.esshader — SDF shapes over the Shape stream (locations 0..3), the
// FrameConstants block at group 0 binding 0, the same SDF math per shape type.
// `v` instead of `in` (a WGSL reserved word).
// =============================================================================

inline constexpr const char* kShapeWGSL_Vertex = R"(
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn {
    @location(0) position : vec2f,
    @location(1) uv : vec2f,
    @location(2) color : vec4f,
    @location(3) shapeInfo : vec4f,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) uv : vec2f,
    @location(1) color : vec4f,
    @location(2) shapeInfo : vec4f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.position, 0.0, 1.0);
    out.uv = v.uv;
    out.color = v.color;
    out.shapeInfo = v.shapeInfo;
    return out;
}
)";

inline constexpr const char* kShapeWGSL_Fragment = R"(
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) uv : vec2f,
    @location(1) color : vec4f,
    @location(2) shapeInfo : vec4f,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let halfSize = v.shapeInfo.yz;
    let cornerRadius = v.shapeInfo.w;
    let p = v.uv * halfSize;
    let shapeType = v.shapeInfo.x;

    var dist : f32;
    if (shapeType < 0.5) {
        let r = min(halfSize.x, halfSize.y);
        dist = length(p) - r;
    } else if (shapeType < 1.5) {
        let r = min(halfSize.x, halfSize.y);
        let elongation = halfSize - vec2f(r, r);
        let q = abs(p) - elongation;
        dist = length(max(q, vec2f(0.0, 0.0))) - r;
    } else {
        let r = min(cornerRadius, min(halfSize.x, halfSize.y));
        let q = abs(p) - halfSize + vec2f(r, r);
        dist = length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
    }

    let fw = fwidth(dist);
    let alpha = 1.0 - smoothstep(-fw, fw, dist);
    if (alpha < 0.001) { discard; }
    return vec4f(v.color.rgb, v.color.a * alpha);
}
)";

// =============================================================================
// batch.esshader (default variant) — the Batch stream (pos, unorm8x4 color, uv,
// texIndex at locations 0..3), FrameConstants at group 0, and u_textures[8] as
// the group-1 texture/sampler pairs. textureSampleLevel(…, 0) keeps sampling
// uniform-flow-legal inside the branch chain; 2D sprites sample mip 0 (the
// mipped path is a Phase 3 topic).
// =============================================================================

inline constexpr const char* kBatchWGSL_Vertex = R"(
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn {
    @location(0) position : vec2f,
    @location(1) color : vec4f,
    @location(2) uv : vec2f,
    @location(3) texIndex : f32,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) color : vec4f,
    @location(1) uv : vec2f,
    @location(2) texIndex : f32,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.position, 0.0, 1.0);
    out.color = v.color;
    out.uv = v.uv;
    out.texIndex = v.texIndex;
    return out;
}
)";

inline constexpr const char* kBatchWGSL_Fragment = R"(
@group(1) @binding(0) var t0 : texture_2d<f32>;
@group(1) @binding(1) var t1 : texture_2d<f32>;
@group(1) @binding(2) var t2 : texture_2d<f32>;
@group(1) @binding(3) var t3 : texture_2d<f32>;
@group(1) @binding(4) var t4 : texture_2d<f32>;
@group(1) @binding(5) var t5 : texture_2d<f32>;
@group(1) @binding(6) var t6 : texture_2d<f32>;
@group(1) @binding(7) var t7 : texture_2d<f32>;
@group(1) @binding(8) var s0 : sampler;
@group(1) @binding(9) var s1 : sampler;
@group(1) @binding(10) var s2 : sampler;
@group(1) @binding(11) var s3 : sampler;
@group(1) @binding(12) var s4 : sampler;
@group(1) @binding(13) var s5 : sampler;
@group(1) @binding(14) var s6 : sampler;
@group(1) @binding(15) var s7 : sampler;

struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) color : vec4f,
    @location(1) uv : vec2f,
    @location(2) texIndex : f32,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let idx = i32(v.texIndex + 0.5);
    var c : vec4f;
    if (idx == 0) { c = textureSampleLevel(t0, s0, v.uv, 0.0); }
    else if (idx == 1) { c = textureSampleLevel(t1, s1, v.uv, 0.0); }
    else if (idx == 2) { c = textureSampleLevel(t2, s2, v.uv, 0.0); }
    else if (idx == 3) { c = textureSampleLevel(t3, s3, v.uv, 0.0); }
    else if (idx == 4) { c = textureSampleLevel(t4, s4, v.uv, 0.0); }
    else if (idx == 5) { c = textureSampleLevel(t5, s5, v.uv, 0.0); }
    else if (idx == 6) { c = textureSampleLevel(t6, s6, v.uv, 0.0); }
    else { c = textureSampleLevel(t7, s7, v.uv, 0.0); }
    return c * v.color;
}
)";

}  // namespace esengine::webgpu
