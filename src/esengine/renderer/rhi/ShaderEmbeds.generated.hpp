#pragma once

namespace esengine::ShaderEmbeds {

inline constexpr const char* BATCH = R"esshader(#pragma shader "Batch"
#pragma version 300 es




#pragma feature SDF



#pragma feature LIT






#pragma feature ALPHA_CLIP

#pragma vertex
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_texCoord;
layout(location = 3) in float a_texIndex;
#ifdef SDF
layout(location = 4) in float a_sdfBias;
#endif

out vec4 v_color;
out vec2 v_texCoord;
flat out int v_texIndex;
#ifdef SDF
out float v_sdfBias;
#endif
#ifdef LIT
out highp vec2 v_worldPos;
#endif

void main() {
    gl_Position = u_projection * vec4(a_position, 1.0);
    v_color = a_color;
    v_texCoord = a_texCoord;
    v_texIndex = int(a_texIndex);
#ifdef SDF
    v_sdfBias = a_sdfBias;
#endif
#ifdef LIT
    v_worldPos = a_position.xy;
#endif
}
#pragma end

#pragma fragment


precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
flat in int v_texIndex;
#ifdef SDF
in float v_sdfBias;
#endif
#ifdef LIT
in highp vec2 v_worldPos;
#endif




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
#ifdef ES_LINEAR


    vec4 tint = vec4(srgbToLinear(v_color.rgb), v_color.a);
#else
    vec4 tint = v_color;
#endif
#ifdef SDF






    float dist = texColor.a;
    float screenPxDist = (dist - 0.5 + v_sdfBias) / max(fwidth(dist), 1e-6);
    float coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    fragColor = vec4(tint.rgb, tint.a * coverage);
#elif defined(LIT)

    vec4 base = texColor * tint;
    fragColor = vec4(applyLighting2D(base.rgb, vec3(0.0, 0.0, 1.0), v_worldPos), base.a);
#else
  #ifdef ALPHA_CLIP



    if (texColor.a < 0.5) discard;
  #endif
    fragColor = texColor * tint;
#endif
}
#pragma end

#pragma vertex wgsl
struct VSIn {
    @location(0) a_position : vec3f,
    @location(1) a_color : vec4f,
    @location(2) a_texCoord : vec2f,
    @location(3) a_texIndex : f32,
#ifdef SDF
    @location(4) a_sdfBias : f32,
#endif
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_color : vec4f,
    @location(1) v_texCoord : vec2f,
    @location(2) v_texIndex : f32,
#ifdef LIT
    @location(3) v_worldPos : vec2f,
#endif
#ifdef SDF
    @location(4) v_sdfBias : f32,
#endif
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.a_position, 1.0);
    out.v_color = v.a_color;
    out.v_texCoord = v.a_texCoord;
    out.v_texIndex = v.a_texIndex;
#ifdef SDF
    out.v_sdfBias = v.a_sdfBias;
#endif
#ifdef LIT
    out.v_worldPos = v.a_position.xy;
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
#ifdef SDF
    @location(4) v_sdfBias : f32,
#endif
};



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
#ifdef ES_LINEAR
    let tint = vec4f(srgbToLinear(v.v_color.rgb), v.v_color.a);
#else
    let tint = v.v_color;
#endif
#ifdef SDF


    let dist = texColor.a;
    let screenPxDist = (dist - 0.5 + v.v_sdfBias) / max(fwidth(dist), 1e-6);
    let coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    return vec4f(tint.rgb, tint.a * coverage);
#elif defined(LIT)
    let base = texColor * tint;
    return vec4f(applyLighting2D(base.rgb, vec3f(0.0, 0.0, 1.0), v.v_worldPos), base.a);
#else
  #ifdef ALPHA_CLIP

    if (texColor.a < 0.5) { discard; }
  #endif
    return texColor * tint;
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
    vec4 c = texture(u_texture, v_texCoord);
#ifdef ES_TONEMAP



    c = vec4(acesFilmic(c.rgb), c.a);
#endif
#ifdef ES_LINEAR


    fragColor = vec4(linearToSrgb(c.rgb), c.a);
#else
    fragColor = c;
#endif
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    var c = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
#ifdef ES_TONEMAP
    c = vec4f(acesFilmic(c.rgb), c.a);
#endif
#ifdef ES_LINEAR
    return vec4f(linearToSrgb(c.rgb), c.a);
#else
    return c;
#endif
}
#pragma end
)esshader";

inline constexpr const char* LIGHTSHAPE2D = R"esshader(#pragma shader "LightShape2D"
#pragma version 300 es








#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
layout(location = 2) in vec4 a_channel;

out vec2 v_texCoord;
out vec4 v_channel;

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
    v_channel = a_channel;
}
#pragma end

#pragma fragment
precision highp float;

in vec2 v_texCoord;
in vec4 v_channel;

uniform sampler2D u_cookie;

out vec4 fragColor;

void main() {


    fragColor = v_channel * texture(u_cookie, v_texCoord).a;
}
#pragma end

#pragma vertex wgsl
struct VSIn {
    @location(0) a_position : vec2f,
    @location(1) a_texCoord : vec2f,
    @location(2) a_channel : vec4f,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_texCoord : vec2f,
    @location(1) v_channel : vec4f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.a_position, 0.0, 1.0);
    out.v_texCoord = v.a_texCoord;
    out.v_channel = v.a_channel;
    return out;
}
#pragma end

#pragma fragment wgsl
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_texCoord : vec2f,
    @location(1) v_channel : vec4f,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return v.v_channel * textureSample(t0, s0, v.v_texCoord).a;
}
#pragma end
)esshader";

inline constexpr const char* MESH = R"esshader(#pragma shader "Mesh"
#pragma version 300 es





#pragma domain Lit




#pragma feature MESH_NORMALS




#pragma feature LIT




#pragma feature SKINNED




#pragma feature NORMAL_MAP





#pragma feature SHADOW_DEPTH






#pragma vertex
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_texCoord;
#ifdef MESH_NORMALS
layout(location = 3) in vec3 a_normal;
#endif
#ifdef SKINNED
layout(location = 5) in uvec4 a_joints;
layout(location = 6) in vec4 a_weights;
#endif



#ifndef SKINNED
layout(location = 8)  in vec4 a_model0;
layout(location = 9)  in vec4 a_model1;
layout(location = 10) in vec4 a_model2;
layout(location = 11) in vec4 a_model3;
#endif
layout(location = 12) in vec4 a_instTint;
#if defined(MESH_NORMALS) && !defined(SKINNED)



layout(location = 13) in vec3 a_nrm0;
layout(location = 14) in vec3 a_nrm1;
layout(location = 15) in vec3 a_nrm2;
#endif

#ifdef SKINNED

layout(std140) uniform SkinConstants {
    mat4 u_bones[64];
};
#endif

out vec2 v_texCoord;
out vec4 v_color;
#ifdef LIT
out highp vec3 v_worldNormal;


out highp vec3 v_worldPos;
#endif
#ifdef SHADOW_DEPTH






out highp vec4 v_shadowClip;
#endif

void main() {
#ifdef SKINNED


    mat4 skin = a_weights.x * u_bones[a_joints.x]
              + a_weights.y * u_bones[a_joints.y]
              + a_weights.z * u_bones[a_joints.z]
              + a_weights.w * u_bones[a_joints.w];
    vec4 world = skin * vec4(a_position, 1.0);
#else
    mat4 model = mat4(a_model0, a_model1, a_model2, a_model3);
    vec4 world = model * vec4(a_position, 1.0);
#endif
    gl_Position = u_projection * world;
    v_texCoord = a_texCoord;
    v_color = a_color * a_instTint;
#ifdef SHADOW_DEPTH
    v_shadowClip = gl_Position;
#endif
#ifdef LIT
#if defined(MESH_NORMALS) && defined(SKINNED)
    v_worldNormal = mat3(skin) * a_normal;
#elif defined(MESH_NORMALS)
    v_worldNormal = mat3(a_nrm0, a_nrm1, a_nrm2) * a_normal;
#else

    v_worldNormal = vec3(0.0, 0.0, 1.0);
#endif
    v_worldPos = world.xyz;
#endif
}
#pragma end

#pragma fragment
precision mediump float;

in vec2 v_texCoord;
in vec4 v_color;
#ifdef LIT
in highp vec3 v_worldNormal;
in highp vec3 v_worldPos;
#endif
#ifdef SHADOW_DEPTH
in highp vec4 v_shadowClip;
#endif

uniform sampler2D u_texture;
#ifdef NORMAL_MAP
uniform sampler2D u_normalMap;
#endif

out vec4 fragColor;

void main() {
#ifdef SHADOW_DEPTH



    fragColor = vec4(packDepth(clamp(v_shadowClip.z / v_shadowClip.w * 0.5 + 0.5,
                                     0.0, 1.0)), 1.0);
#else
    vec4 base = texture(u_texture, v_texCoord) * v_color;
#ifdef LIT
    highp vec3 N = normalize(v_worldNormal);
#ifdef NORMAL_MAP
    N = perturbNormal(N, v_worldPos, v_texCoord, sampleNormal(u_normalMap, v_texCoord));
#endif




    fragColor = vec4(applyLightingPBR(base.rgb, N, v_worldPos, viewDirection(v_worldPos),
                                      0.0, 1.0, 1.0, 1.0), base.a);
#else
    fragColor = base;
#endif
#endif
}
#pragma end

#pragma vertex wgsl
#ifdef SKINNED
struct SkinConstants { bones : array<mat4x4f, 64> };
@group(0) @binding(5) var<uniform> skin : SkinConstants;
#endif

struct VSIn {
    @location(0) a_position : vec3f,
    @location(1) a_color : vec4f,
    @location(2) a_texCoord : vec2f,
#ifdef MESH_NORMALS
    @location(3) a_normal : vec3f,
#endif
#ifdef SKINNED
    @location(5) a_joints : vec4u,
    @location(6) a_weights : vec4f,
#else
    @location(8)  a_model0 : vec4f,
    @location(9)  a_model1 : vec4f,
    @location(10) a_model2 : vec4f,
    @location(11) a_model3 : vec4f,
#endif
    @location(12) a_instTint : vec4f,
#ifdef MESH_NORMALS
#ifndef SKINNED
    @location(13) a_nrm0 : vec3f,
    @location(14) a_nrm1 : vec3f,
    @location(15) a_nrm2 : vec3f,
#endif
#endif
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_texCoord : vec2f,
    @location(1) v_color : vec4f,
#ifdef LIT
    @location(2) v_worldNormal : vec3f,
    @location(3) v_worldPos : vec3f,
#endif
#ifdef SHADOW_DEPTH

    @location(4) v_shadowClip : vec4f,
#endif
};

@vertex fn vs_main(v : VSIn) -> VSOut {
#ifdef SKINNED


    let pose = v.a_weights.x * skin.bones[v.a_joints.x]
             + v.a_weights.y * skin.bones[v.a_joints.y]
             + v.a_weights.z * skin.bones[v.a_joints.z]
             + v.a_weights.w * skin.bones[v.a_joints.w];
    let world = pose * vec4f(v.a_position, 1.0);
#else
    let model = mat4x4f(v.a_model0, v.a_model1, v.a_model2, v.a_model3);
    let world = model * vec4f(v.a_position, 1.0);
#endif

    var out : VSOut;
    out.pos = frame.projection * world;
    out.v_texCoord = v.a_texCoord;
    out.v_color = v.a_color * v.a_instTint;
#ifdef SHADOW_DEPTH
    out.v_shadowClip = out.pos;
#endif
#ifdef LIT
#ifdef MESH_NORMALS
#ifdef SKINNED
    out.v_worldNormal = mat3x3f(pose[0].xyz, pose[1].xyz, pose[2].xyz) * v.a_normal;
#else
    out.v_worldNormal = mat3x3f(v.a_nrm0, v.a_nrm1, v.a_nrm2) * v.a_normal;
#endif
#else

    out.v_worldNormal = vec3f(0.0, 0.0, 1.0);
#endif
    out.v_worldPos = world.xyz;
#endif
    return out;
}
#pragma end

#pragma fragment wgsl
@group(1) @binding(0) var t0 : texture_2d<f32>;
@group(1) @binding(8) var s0 : sampler;
#ifdef NORMAL_MAP
@group(1) @binding(1) var t1 : texture_2d<f32>;
@group(1) @binding(9) var s1 : sampler;
#endif
#ifdef ES_RECEIVE_SHADOW


@group(1) @binding(2) var t2 : texture_2d<f32>;
@group(1) @binding(10) var s2 : sampler;
#endif
#ifdef ES_ENV_MAP



@group(1) @binding(3) var t3 : texture_2d<f32>;
@group(1) @binding(11) var s3 : sampler;
#endif


@group(1) @binding(7) var t7 : texture_2d<f32>;
@group(1) @binding(15) var s7 : sampler;

struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_texCoord : vec2f,
    @location(1) v_color : vec4f,
#ifdef LIT
    @location(2) v_worldNormal : vec3f,
    @location(3) v_worldPos : vec3f,
#endif
#ifdef SHADOW_DEPTH
    @location(4) v_shadowClip : vec4f,
#endif
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
#ifdef SHADOW_DEPTH



    return vec4f(packDepth(clamp(v.v_shadowClip.z / v.v_shadowClip.w * 0.5 + 0.5,
                                 0.0, 1.0)), 1.0);
#else
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
#ifdef LIT
    var N = normalize(v.v_worldNormal);
#ifdef NORMAL_MAP
    N = perturbNormal(N, v.v_worldPos, v.v_texCoord, sampleNormal(t1, s1, v.v_texCoord));
#endif




    return vec4f(applyLightingPBR(base.rgb, N, v.v_worldPos, viewDirection(v.v_worldPos),
                                  0.0, 1.0, 1.0, 1.0), base.a);
#else
    return base;
#endif
#endif
}
#pragma end
)esshader";

inline constexpr const char* PARTICLE = R"esshader(#pragma shader "ParticleInstance"
#pragma version 300 es





#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec4 texColor = texture(u_textures[0], v_texCoord);
    fragColor = texColor * v_color;
}
#pragma end



#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texColor = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    return texColor * v.v_color;
}
#pragma end
)esshader";

inline constexpr const char* SHADOW2D = R"esshader(#pragma shader "Shadow2D"
#pragma version 300 es










#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in float a_shadow;
layout(location = 2) in vec4 a_channel;

out float v_shadow;
out vec4 v_channel;

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_shadow = a_shadow;
    v_channel = a_channel;
}
#pragma end

#pragma fragment
precision highp float;

in float v_shadow;
in vec4 v_channel;

out vec4 fragColor;

void main() {
    fragColor = v_channel * v_shadow;
}
#pragma end

#pragma vertex wgsl
struct VSIn {
    @location(0) a_position : vec2f,
    @location(1) a_shadow : f32,
    @location(2) a_channel : vec4f,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_shadow : f32,
    @location(1) v_channel : vec4f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.a_position, 0.0, 1.0);
    out.v_shadow = v.a_shadow;
    out.v_channel = v.a_channel;
    return out;
}
#pragma end

#pragma fragment wgsl
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_shadow : f32,
    @location(1) v_channel : vec4f,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return v.v_channel * v.v_shadow;
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

inline constexpr const char* SKY = R"esshader(#pragma shader "Sky"
#pragma version 300 es
#pragma domain Lit









#pragma vertex
layout(location = 0) in vec3 a_position;

out highp vec3 v_worldPos;

void main() {
    gl_Position = u_projection * vec4(a_position, 1.0);
    v_worldPos = a_position;
}
#pragma end

#pragma fragment
precision highp float;

in highp vec3 v_worldPos;
out vec4 fragColor;

void main() {


    fragColor = vec4(envSampleMip(-viewDirection(v_worldPos), 0.0), 1.0);
}
#pragma end

#pragma vertex wgsl
struct VSIn {
    @location(0) a_position : vec3f,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_worldPos : vec3f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.a_position, 1.0);
    out.v_worldPos = v.a_position;
    return out;
}
#pragma end

#pragma fragment wgsl




@group(1) @binding(0) var t0 : texture_2d<f32>;
@group(1) @binding(8) var s0 : sampler;
@group(1) @binding(3) var t3 : texture_2d<f32>;
@group(1) @binding(11) var s3 : sampler;

@group(1) @binding(7) var t7 : texture_2d<f32>;
@group(1) @binding(15) var s7 : sampler;




struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_worldPos : vec3f,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return vec4f(envSampleMip(-viewDirection(v.v_worldPos), 0.0), 1.0);
}
#pragma end
)esshader";

}  // namespace esengine::ShaderEmbeds
