#pragma once

namespace esengine::ShaderEmbeds {

inline constexpr const char* BATCH = R"esshader(#pragma shader "Batch"
#pragma version 300 es

// Compile-time variant: when enabled the fragment stage treats the sampled
// alpha as a signed distance field (runtime glyph atlas) and
// derives crisp, resolution-independent coverage instead of sampling RGBA.
#pragma feature SDF

// Compile-time variant: lit by the scene's 2D lights (Sprite.lit). Compiled as a
// Lit2D-domain shader, so applyLighting2D + LightConstants are injected.
#pragma feature LIT

#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_texCoord;
layout(location = 3) in float a_texIndex;

layout(std140) uniform FrameConstants {
    mat4 u_projection;
};

out vec4 v_color;
out vec2 v_texCoord;
flat out int v_texIndex;
#ifdef LIT
out highp vec2 v_worldPos;
#endif

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_color = a_color;
    v_texCoord = a_texCoord;
    v_texIndex = int(a_texIndex);
#ifdef LIT
    v_worldPos = a_position;
#endif
}
#pragma end

#pragma fragment
// highp: the SDF text branch needs precise distance + fwidth derivatives, and
// sprite sampling is unaffected by the wider range.
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
flat in int v_texIndex;
#ifdef LIT
in highp vec2 v_worldPos;
#endif

// Up to 8 textures bound per multi-texture batch. GLSL ES 3.00 forbids indexing a
// sampler array with a non-uniform expression, so the slot is selected by a constant
// branch chain (the standard WebGL2 multi-texture batching technique).
uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec4 texColor;
    if (v_texIndex == 0) texColor = texture(u_textures[0], v_texCoord);
    else if (v_texIndex == 1) texColor = texture(u_textures[1], v_texCoord);
    else if (v_texIndex == 2) texColor = texture(u_textures[2], v_texCoord);
    else if (v_texIndex == 3) texColor = texture(u_textures[3], v_texCoord);
    else if (v_texIndex == 4) texColor = texture(u_textures[4], v_texCoord);
    else if (v_texIndex == 5) texColor = texture(u_textures[5], v_texCoord);
    else if (v_texIndex == 6) texColor = texture(u_textures[6], v_texCoord);
    else texColor = texture(u_textures[7], v_texCoord);
#ifdef SDF
    // The glyph atlas stores a signed distance in the alpha channel (RGB = 1).
    // Distance ÷ fwidth = screen px from the edge; the ±0.5px clamp is exactly
    // one pixel of linear coverage ramp (the msdfgen standard).
    float dist = texColor.a;
    float screenPxDist = (dist - 0.5) / max(fwidth(dist), 1e-6);
    float coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    fragColor = vec4(v_color.rgb, v_color.a * coverage);
#elif defined(LIT)
    // Flat normal; the tinted color is the albedo. Normal maps need a material.
    vec4 base = texColor * v_color;
    fragColor = vec4(applyLighting2D(base.rgb, vec3(0.0, 0.0, 1.0), v_worldPos), base.a);
#else
    fragColor = texColor * v_color;
#endif
}
#pragma end

#pragma vertex wgsl
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn {
    @location(0) a_position : vec2f,
    @location(1) a_color : vec4f,
    @location(2) a_texCoord : vec2f,
    @location(3) a_texIndex : f32,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_color : vec4f,
    @location(1) v_texCoord : vec2f,
    @location(2) v_texIndex : f32,
#ifdef LIT
    @location(3) v_worldPos : vec2f,
#endif
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.a_position, 0.0, 1.0);
    out.v_color = v.a_color;
    out.v_texCoord = v.a_texCoord;
    out.v_texIndex = v.a_texIndex;
#ifdef LIT
    out.v_worldPos = v.a_position;
#endif
    return out;
}
#pragma end

#pragma fragment wgsl
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
    @location(0) v_color : vec4f,
    @location(1) v_texCoord : vec2f,
    @location(2) v_texIndex : f32,
#ifdef LIT
    @location(3) v_worldPos : vec2f,
#endif
};

// textureSampleLevel(…, 0) keeps sampling uniform-flow-legal inside the
// constant branch chain; 2D sprites sample mip 0.
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let idx = i32(v.v_texIndex + 0.5);
    var texColor : vec4f;
    if (idx == 0) { texColor = textureSampleLevel(t0, s0, v.v_texCoord, 0.0); }
    else if (idx == 1) { texColor = textureSampleLevel(t1, s1, v.v_texCoord, 0.0); }
    else if (idx == 2) { texColor = textureSampleLevel(t2, s2, v.v_texCoord, 0.0); }
    else if (idx == 3) { texColor = textureSampleLevel(t3, s3, v.v_texCoord, 0.0); }
    else if (idx == 4) { texColor = textureSampleLevel(t4, s4, v.v_texCoord, 0.0); }
    else if (idx == 5) { texColor = textureSampleLevel(t5, s5, v.v_texCoord, 0.0); }
    else if (idx == 6) { texColor = textureSampleLevel(t6, s6, v.v_texCoord, 0.0); }
    else { texColor = textureSampleLevel(t7, s7, v.v_texCoord, 0.0); }
#ifdef SDF
    // Same coverage math as the GLSL stage; fwidth here is in uniform control
    // flow (main scope), which WGSL requires of derivative builtins.
    let dist = texColor.a;
    let screenPxDist = (dist - 0.5) / max(fwidth(dist), 1e-6);
    let coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    return vec4f(v.v_color.rgb, v.v_color.a * coverage);
#elif defined(LIT)
    let base = texColor * v.v_color;
    return vec4f(applyLighting2D(base.rgb, vec3f(0.0, 0.0, 1.0), v.v_worldPos), base.a);
#else
    return texColor * v.v_color;
#endif
}
#pragma end
)esshader";

inline constexpr const char* BLIT = R"esshader(#pragma shader "Blit"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    fragColor = texture(u_texture, v_texCoord);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
}
#pragma end
)esshader";

inline constexpr const char* PARTICLE = R"esshader(#pragma shader "ParticleInstance"
#pragma version 300 es

#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

layout(location = 2) in vec2 a_inst_position;
layout(location = 3) in vec2 a_inst_size;
layout(location = 4) in float a_inst_rotation;
layout(location = 5) in vec4 a_inst_color;
layout(location = 6) in vec2 a_inst_uv_offset;
layout(location = 7) in vec2 a_inst_uv_scale;

layout(std140) uniform FrameConstants {
    mat4 u_projection;
};

out vec2 v_texCoord;
out vec4 v_color;

void main() {
    vec2 scaled = a_position * a_inst_size;

    float cosR = cos(a_inst_rotation);
    float sinR = sin(a_inst_rotation);
    vec2 rotated = vec2(
        scaled.x * cosR - scaled.y * sinR,
        scaled.x * sinR + scaled.y * cosR
    );

    vec2 worldPos = rotated + a_inst_position;
    gl_Position = u_projection * vec4(worldPos, 0.0, 1.0);

    v_texCoord = a_texCoord * a_inst_uv_scale + a_inst_uv_offset;
    v_color = a_inst_color;
}
#pragma end

#pragma fragment
precision mediump float;

in vec2 v_texCoord;
in vec4 v_color;

uniform sampler2D u_texture;

out vec4 fragColor;

void main() {
    vec4 texColor = texture(u_texture, v_texCoord);
    fragColor = texColor * v_color;
}
#pragma end

#pragma vertex wgsl
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn {
    @location(0) a_position : vec2f,
    @location(1) a_texCoord : vec2f,
    @location(2) a_inst_position : vec2f,
    @location(3) a_inst_size : vec2f,
    @location(4) a_inst_rotation : f32,
    @location(5) a_inst_color : vec4f,
    @location(6) a_inst_uv_offset : vec2f,
    @location(7) a_inst_uv_scale : vec2f,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_texCoord : vec2f,
    @location(1) v_color : vec4f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    let scaled = v.a_position * v.a_inst_size;

    let cosR = cos(v.a_inst_rotation);
    let sinR = sin(v.a_inst_rotation);
    let rotated = vec2f(
        scaled.x * cosR - scaled.y * sinR,
        scaled.x * sinR + scaled.y * cosR
    );

    let worldPos = rotated + v.a_inst_position;

    var out : VSOut;
    out.pos = frame.projection * vec4f(worldPos, 0.0, 1.0);
    out.v_texCoord = v.a_texCoord * v.a_inst_uv_scale + v.a_inst_uv_offset;
    out.v_color = v.a_inst_color;
    return out;
}
#pragma end

#pragma fragment wgsl
@group(1) @binding(0) var t0 : texture_2d<f32>;
@group(1) @binding(8) var s0 : sampler;

struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_texCoord : vec2f,
    @location(1) v_color : vec4f,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texColor = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    return texColor * v.v_color;
}
#pragma end
)esshader";

inline constexpr const char* SHAPE = R"esshader(#pragma shader "Shape"
#pragma version 300 es

#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
layout(location = 2) in vec4 a_color;
layout(location = 3) in vec4 a_shapeInfo;

layout(std140) uniform FrameConstants {
    mat4 u_projection;
};

out vec2 v_uv;
out vec4 v_color;
out vec4 v_shapeInfo;

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_uv = a_texCoord;
    v_color = a_color;
    v_shapeInfo = a_shapeInfo;
}
#pragma end

#pragma fragment
precision mediump float;

in vec2 v_uv;
in vec4 v_color;
in vec4 v_shapeInfo;

out vec4 fragColor;

void main() {
    vec2 halfSize = v_shapeInfo.yz;
    float cornerRadius = v_shapeInfo.w;
    vec2 p = v_uv * halfSize;

    float dist;
    float shapeType = v_shapeInfo.x;

    if (shapeType < 0.5) {
        float r = min(halfSize.x, halfSize.y);
        dist = length(p) - r;
    } else if (shapeType < 1.5) {
        float r = min(halfSize.x, halfSize.y);
        vec2 elongation = halfSize - vec2(r);
        vec2 q = abs(p) - elongation;
        dist = length(max(q, 0.0)) - r;
    } else {
        float r = min(cornerRadius, min(halfSize.x, halfSize.y));
        vec2 q = abs(p) - halfSize + vec2(r);
        dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    float fw = fwidth(dist);
    float alpha = 1.0 - smoothstep(-fw, fw, dist);
    if (alpha < 0.001) discard;
    fragColor = vec4(v_color.rgb, v_color.a * alpha);
}
#pragma end

#pragma vertex wgsl
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn {
    @location(0) a_position : vec2f,
    @location(1) a_texCoord : vec2f,
    @location(2) a_color : vec4f,
    @location(3) a_shapeInfo : vec4f,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_uv : vec2f,
    @location(1) v_color : vec4f,
    @location(2) v_shapeInfo : vec4f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.a_position, 0.0, 1.0);
    out.v_uv = v.a_texCoord;
    out.v_color = v.a_color;
    out.v_shapeInfo = v.a_shapeInfo;
    return out;
}
#pragma end

#pragma fragment wgsl
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_uv : vec2f,
    @location(1) v_color : vec4f,
    @location(2) v_shapeInfo : vec4f,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let halfSize = v.v_shapeInfo.yz;
    let cornerRadius = v.v_shapeInfo.w;
    let p = v.v_uv * halfSize;
    let shapeType = v.v_shapeInfo.x;

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
    return vec4f(v.v_color.rgb, v.v_color.a * alpha);
}
#pragma end
)esshader";

}  // namespace esengine::ShaderEmbeds
