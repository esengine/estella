#pragma once

namespace esengine::ShaderEmbeds {

inline constexpr const char* BATCH = R"esshader(#pragma shader "Batch"
#pragma version 300 es

// Compile-time variant: when enabled the fragment stage treats the sampled
// alpha as a signed distance field (runtime glyph atlas, REARCH_GUI P1) and
// derives crisp, resolution-independent coverage instead of sampling RGBA.
#pragma feature SDF

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

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_color = a_color;
    v_texCoord = a_texCoord;
    v_texIndex = int(a_texIndex);
}
#pragma end

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
flat in int v_texIndex;

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
    // Recover ~1px screen-space coverage with a smoothstep around the 0.5 edge;
    // fwidth tracks the on-screen scale so glyphs stay crisp at any size.
    float dist = texColor.a;
    float aa = fwidth(dist);
    float coverage = smoothstep(0.5 - aa, 0.5 + aa, dist);
    fragColor = vec4(v_color.rgb, v_color.a * coverage);
#else
    fragColor = texColor * v_color;
#endif
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
)esshader";

}  // namespace esengine::ShaderEmbeds
