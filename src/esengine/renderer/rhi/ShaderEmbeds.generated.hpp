#pragma once

namespace esengine::ShaderEmbeds {

inline constexpr const char* BATCH = R"esshader(#pragma shader "Batch"
#pragma version 300 es




#pragma feature SDF



#pragma feature LIT






#pragma feature ALPHA_CLIP


#pragma feature PREMULTIPLIED_COLOR

#pragma vertex
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_texCoord;
layout(location = 3) in float a_texIndex;


#if defined(SDF) || defined(LIT)
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
flat out highp float v_lightLayer;
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
    v_lightLayer = a_sdfBias;
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
flat in highp float v_lightLayer;
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
#ifdef PREMULTIPLIED_COLOR
    tint.rgb *= tint.a;
#endif
#ifdef SDF






    float dist = texColor.a;
    float screenPxDist = (dist - 0.5 + v_sdfBias) / max(fwidth(dist), 1e-6);
    float coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    fragColor = vec4(tint.rgb, tint.a * coverage);
#elif defined(LIT)

    vec4 base = texColor * tint;
    fragColor = vec4(applyLighting2DLayer(base.rgb, vec3(0.0, 0.0, 1.0), v_worldPos, v_lightLayer), base.a);
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
#elif defined(LIT)
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
    @location(5) @interpolate(flat) v_lightLayer : f32,
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
    out.v_lightLayer = v.a_sdfBias;
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
    @location(5) @interpolate(flat) v_lightLayer : f32,
#endif
#ifdef SDF
    @location(4) v_sdfBias : f32,
#endif
};




@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let idx = i32(v.v_texIndex + 0.5);
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    var texColor : vec4f;
    if (idx == 0) { texColor = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy); }
    else if (idx == 1) { texColor = textureSampleGrad(t1, s1, v.v_texCoord, duvx, duvy); }
    else if (idx == 2) { texColor = textureSampleGrad(t2, s2, v.v_texCoord, duvx, duvy); }
    else if (idx == 3) { texColor = textureSampleGrad(t3, s3, v.v_texCoord, duvx, duvy); }
    else if (idx == 4) { texColor = textureSampleGrad(t4, s4, v.v_texCoord, duvx, duvy); }
    else if (idx == 5) { texColor = textureSampleGrad(t5, s5, v.v_texCoord, duvx, duvy); }
    else if (idx == 6) { texColor = textureSampleGrad(t6, s6, v.v_texCoord, duvx, duvy); }
    else { texColor = textureSampleGrad(t7, s7, v.v_texCoord, duvx, duvy); }
#ifdef ES_LINEAR
    var tint = vec4f(srgbToLinear(v.v_color.rgb), v.v_color.a);
#else
    var tint = v.v_color;
#endif
#ifdef PREMULTIPLIED_COLOR
    tint = vec4f(tint.rgb * tint.a, tint.a);
#endif
#ifdef SDF


    let dist = texColor.a;
    let screenPxDist = (dist - 0.5 + v.v_sdfBias) / max(fwidth(dist), 1e-6);
    let coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    return vec4f(tint.rgb, tint.a * coverage);
#elif defined(LIT)
    let base = texColor * tint;
    return vec4f(applyLighting2DLayer(base.rgb, vec3f(0.0, 0.0, 1.0), v.v_worldPos, v.v_lightLayer), base.a);
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


#pragma param u_displayLut texture default(white)
#pragma param u_displayLutAmount float default(0)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
#ifdef ES_COPY_DEPTH
uniform highp sampler2D u_sceneDepth;
#endif
out vec4 fragColor;

#ifdef ES_UPSCALE



vec4 upscale(vec2 uv) {
    vec2 size = vec2(textureSize(u_texture, 0));
    vec2 pos = uv * size;
    vec2 centre = floor(pos - 0.5) + 0.5;
    vec2 f = pos - centre;
    vec2 f2 = f * f;
    vec2 f3 = f2 * f;
    vec2 w0 = f2 - 0.5 * (f3 + f);
    vec2 w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
    vec2 w3 = 0.5 * (f3 - f2);
    vec2 w2 = 1.0 - w0 - w1 - w3;
    vec2 w12 = w1 + w2;
    vec2 t0 = (centre - 1.0) / size;
    vec2 t3 = (centre + 2.0) / size;
    vec2 t12 = (centre + w2 / w12) / size;
    vec4 sum = texture(u_texture, vec2(t12.x, t0.y)) * (w12.x * w0.y)
             + texture(u_texture, vec2(t0.x, t12.y)) * (w0.x * w12.y)
             + texture(u_texture, t12) * (w12.x * w12.y)
             + texture(u_texture, vec2(t3.x, t12.y)) * (w3.x * w12.y)
             + texture(u_texture, vec2(t12.x, t3.y)) * (w12.x * w3.y);
    sum /= (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y);
    ivec2 base = ivec2(centre - 0.5);
    ivec2 hi = ivec2(size) - 1;
    vec4 a = texelFetch(u_texture, clamp(base, ivec2(0), hi), 0);
    vec4 b = texelFetch(u_texture, clamp(base + ivec2(1, 0), ivec2(0), hi), 0);
    vec4 d = texelFetch(u_texture, clamp(base + ivec2(0, 1), ivec2(0), hi), 0);
    vec4 e = texelFetch(u_texture, clamp(base + ivec2(1, 1), ivec2(0), hi), 0);
    return clamp(sum, min(min(a, b), min(d, e)), max(max(a, b), max(d, e)));
}
#endif

#ifdef ES_DISPLAY_LUT
vec3 displayLookup(vec3 c) {
    const float size = 32.0;
    float b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    float slice0 = floor(b);
    float slice1 = min(slice0 + 1.0, size - 1.0);
    float u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    float v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    vec3 a = texture(u_displayLut, vec2(u + slice0 / size, v)).rgb;
    vec3 d = texture(u_displayLut, vec2(u + slice1 / size, v)).rgb;
    return mix(a, d, b - slice0);
}
#endif

void main() {
#ifdef ES_COPY_DEPTH


    ivec2 depthSize = textureSize(u_sceneDepth, 0);
    float rawDepth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(depthSize)), ivec2(0), depthSize - ivec2(1)), 0).r;
    vec3 scenePoint = worldFromDepth(v_texCoord, rawDepth);
    float eyeDistance = u_camera.w > 0.5 ? length(scenePoint - u_camera.xyz) : -dot(scenePoint, u_camera.xyz);
    fragColor = vec4(rawDepth >= 1.0 ? 60000.0 : eyeDistance, 0.0, 0.0, 0.5);
    return;
#endif
#ifdef ES_UPSCALE
    vec4 c = upscale(v_texCoord);
#else
    vec4 c = texture(u_texture, v_texCoord);
#endif


#ifdef ES_COPY


    fragColor = vec4(c.rgb, 0.5);
    return;
#endif
    c = vec4(c.rgb * exp2(u_time.z), c.a);
#ifdef ES_TONEMAP



    c = vec4(acesFilmic(c.rgb), c.a);
#endif
#ifdef ES_TONEMAP_NEUTRAL
    c = vec4(pbrNeutral(c.rgb), c.a);
#endif
#ifdef ES_LINEAR


    vec3 shown = linearToSrgb(c.rgb);
#else
    vec3 shown = c.rgb;
#endif
#ifdef ES_DISPLAY_LUT

    shown = mix(shown, displayLookup(shown), clamp(u_displayLutAmount, 0.0, 1.0));
#endif
    fragColor = vec4(shown, c.a);
}
#pragma end

#pragma fragment wgsl
#ifdef ES_UPSCALE
fn upscale(uv : vec2f) -> vec4f {
    let size = vec2f(textureDimensions(t0, 0));
    let pos = uv * size;
    let centre = floor(pos - vec2f(0.5)) + vec2f(0.5);
    let f = pos - centre;
    let f2 = f * f;
    let f3 = f2 * f;
    let w0 = f2 - 0.5 * (f3 + f);
    let w1 = 1.5 * f3 - 2.5 * f2 + vec2f(1.0);
    let w3 = 0.5 * (f3 - f2);
    let w2 = vec2f(1.0) - w0 - w1 - w3;
    let w12 = w1 + w2;
    let tapLo = (centre - vec2f(1.0)) / size;
    let tapHi = (centre + vec2f(2.0)) / size;
    let tapMid = (centre + w2 / w12) / size;
    var sum = textureSampleLevel(t0, s0, vec2f(tapMid.x, tapLo.y), 0.0) * (w12.x * w0.y)
            + textureSampleLevel(t0, s0, vec2f(tapLo.x, tapMid.y), 0.0) * (w0.x * w12.y)
            + textureSampleLevel(t0, s0, tapMid, 0.0) * (w12.x * w12.y)
            + textureSampleLevel(t0, s0, vec2f(tapHi.x, tapMid.y), 0.0) * (w3.x * w12.y)
            + textureSampleLevel(t0, s0, vec2f(tapMid.x, tapHi.y), 0.0) * (w12.x * w3.y);
    sum = sum / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y);
    let base = vec2i(centre - vec2f(0.5));
    let hi = vec2i(size) - vec2i(1);
    let a = textureLoad(t0, clamp(base, vec2i(0), hi), 0);
    let b = textureLoad(t0, clamp(base + vec2i(1, 0), vec2i(0), hi), 0);
    let d = textureLoad(t0, clamp(base + vec2i(0, 1), vec2i(0), hi), 0);
    let e = textureLoad(t0, clamp(base + vec2i(1, 1), vec2i(0), hi), 0);
    return clamp(sum, min(min(a, b), min(d, e)), max(max(a, b), max(d, e)));
}
#endif

#ifdef ES_DISPLAY_LUT
fn displayLookup(c : vec3f) -> vec3f {
    let size = 32.0;
    let b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    let slice0 = floor(b);
    let slice1 = min(slice0 + 1.0, size - 1.0);
    let u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    let v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    let a = textureSampleLevel(u_displayLut, u_displayLut_s, vec2f(u + slice0 / size, v), 0.0).rgb;
    let d = textureSampleLevel(u_displayLut, u_displayLut_s, vec2f(u + slice1 / size, v), 0.0).rgb;
    return mix(a, d, b - slice0);
}
#endif

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
#ifdef ES_COPY_DEPTH
    let depthSize = vec2i(textureDimensions(t7, 0));
    let rawDepth = textureLoad(t7, clamp(vec2i(v.v_texCoord * vec2f(depthSize)), vec2i(0), depthSize - vec2i(1)), 0);
    let scenePoint = worldFromDepth(v.v_texCoord, rawDepth);
    var eyeDistance = -dot(scenePoint, frame.camera.xyz);
    if (frame.camera.w > 0.5) { eyeDistance = length(scenePoint - frame.camera.xyz); }
    return vec4f(select(eyeDistance, 60000.0, rawDepth >= 1.0), 0.0, 0.0, 0.5);
#endif
#ifdef ES_UPSCALE
    var c = upscale(v.v_texCoord);
#else
    var c = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
#endif
#ifdef ES_COPY
    return vec4f(c.rgb, 0.5);
#endif
    c = vec4f(c.rgb * exp2(tc.u_time.z), c.a);
#ifdef ES_TONEMAP
    c = vec4f(acesFilmic(c.rgb), c.a);
#endif
#ifdef ES_TONEMAP_NEUTRAL
    c = vec4f(pbrNeutral(c.rgb), c.a);
#endif
#ifdef ES_LINEAR
    var shown = linearToSrgb(c.rgb);
#else
    var shown = c.rgb;
#endif
#ifdef ES_DISPLAY_LUT
    shown = mix(shown, displayLookup(shown), clamp(mc.u_displayLutAmount, 0.0, 1.0));
#endif
    return vec4f(shown, c.a);
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





#pragma feature MESH_LIGHTMAP


#pragma feature MESH_TANGENTS





#pragma feature SHADOW_DEPTH




#pragma feature SHADOW_ALPHA



#pragma feature PREPASS_COVERAGE






#pragma feature WEIGHT_HEAT






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
#ifdef MESH_LIGHTMAP
layout(location = 7) in vec2 a_texCoord1;
#endif
#ifdef MESH_TANGENTS
layout(location = 4) in vec4 a_tangent;
#endif






#ifdef SKINNED

layout(std140) uniform SkinConstants {
    mat4 u_bones[64];
};
#endif





layout(std140) uniform MorphConstants {

    vec4 u_morphInfo;
    vec4 u_morphShape[8];
};



uniform highp sampler2D u_morphDeltas;

vec3 morphDelta(float index) {
    float width = u_morphInfo.w;
    return texelFetch(u_morphDeltas, ivec2(int(mod(index, width)), int(index / width)), 0).xyz;
}



void applyMorph(inout vec3 position, inout vec3 normal) {
    int live = int(u_morphInfo.x);
    float perVertex = u_morphInfo.z;
    for (int i = 0; i < 8; i++) {
        if (i >= live) break;
        float at = (u_morphShape[i].x * u_morphInfo.y + float(gl_VertexID)) * perVertex;
        position += u_morphShape[i].y * morphDelta(at);
        if (perVertex > 1.5) normal += u_morphShape[i].y * morphDelta(at + 1.0);
    }
}



invariant gl_Position;

out vec2 v_texCoord;
out vec4 v_color;
#ifdef MESH_LIGHTMAP







out highp vec3 v_lightmap;
#endif
#ifdef LIT
out highp vec3 v_worldNormal;


out highp vec3 v_worldPos;
#ifdef MESH_TANGENTS
out highp vec4 v_worldTangent;
#endif
#endif
#ifdef SHADOW_DEPTH






out highp vec4 v_shadowClip;
#endif
#ifdef ES_VELOCITY




out highp vec4 v_velCur;
out highp vec4 v_velPrev;
#endif




#ifdef ES_MATERIAL_VERTEX

highp vec4 es_vertexColor;
@@ES_VERTEX_HOOK@@
#endif

#if defined(ES_VELOCITY) && defined(SKINNED)

highp mat4 esPrevBone(uint joint) {
    int at = 8 + int(joint) * 3;
    highp vec4 r0 = esInstanceTexel(at);
    highp vec4 r1 = esInstanceTexel(at + 1);
    highp vec4 r2 = esInstanceTexel(at + 2);
    return mat4(vec4(r0.x, r1.x, r2.x, 0.0), vec4(r0.y, r1.y, r2.y, 0.0),
                vec4(r0.z, r1.z, r2.z, 0.0), vec4(r0.w, r1.w, r2.w, 1.0));
}
#endif

void main() {
    vec3 local = a_position;
#ifdef MESH_NORMALS
    vec3 localNormal = a_normal;
#else
    vec3 localNormal = vec3(0.0, 0.0, 1.0);
#endif
    applyMorph(local, localNormal);
#ifdef ES_MATERIAL_VERTEX
    es_vertexColor = a_color;
    esMaterialVertex(local, localNormal, a_texCoord);
#endif
#ifdef SKINNED


    mat4 skin = a_weights.x * u_bones[a_joints.x]
              + a_weights.y * u_bones[a_joints.y]
              + a_weights.z * u_bones[a_joints.z]
              + a_weights.w * u_bones[a_joints.w];
    vec4 world = skin * vec4(local, 1.0);
#else
    mat4 model = esInstanceModel();
    vec4 world = model * vec4(local, 1.0);
#endif
    gl_Position = u_projection * world;
    v_texCoord = a_texCoord;

#ifdef ES_MATERIAL_VERTEX
    v_color = es_vertexColor * esInstanceTint();
#else
    v_color = a_color * esInstanceTint();
#endif
#if defined(WEIGHT_HEAT) && defined(SKINNED)
    {
        uint chosen = uint(esInstanceTint().x);
        vec4 own = vec4(equal(a_joints, uvec4(chosen)));
        float heat = dot(own, a_weights);

        v_color = vec4(heat < 0.01 ? vec3(0.1) : mix(vec3(0.2, 0.4, 1.0), vec3(1.0, 0.25, 0.2), clamp(heat, 0.0, 1.0)), 1.0);
    }
#endif
#ifdef MESH_LIGHTMAP
    highp vec4 lmRect = esInstanceLightmapRect();
    v_lightmap = vec3(a_texCoord1 * lmRect.xy + lmRect.zw,
                      lmRect.x > 0.0 ? 1.0 : 0.0);
#endif
#ifdef SHADOW_DEPTH
    v_shadowClip = gl_Position;
#endif
#ifdef ES_VELOCITY
    {


#ifdef SKINNED

        highp mat4 prevSkin = a_weights.x * esPrevBone(a_joints.x) + a_weights.y * esPrevBone(a_joints.y)
                            + a_weights.z * esPrevBone(a_joints.z) + a_weights.w * esPrevBone(a_joints.w);
        highp vec4 L = prevSkin * vec4(local, 1.0);
#else
        highp vec4 L = vec4(local, 1.0);
#endif
        highp vec4 before = esInstanceTint();
        v_velCur = gl_Position;
        highp vec4 prev = vec4(dot(esInstanceTexel(4), L), dot(esInstanceTexel(5), L),
                               dot(esInstanceTexel(6), L), dot(esInstanceTexel(7), L));
        v_velPrev = vec4(prev.xy + before.xy * prev.w, prev.zw);
    }
#endif


    v_probeSlot = float(ES_INSTANCE_ID);
#ifdef LIT
#if defined(MESH_NORMALS) && defined(SKINNED)
    v_worldNormal = mat3(skin) * localNormal;
#elif defined(MESH_NORMALS)
    v_worldNormal = esInstanceNormalMatrix() * localNormal;
#else

    v_worldNormal = vec3(0.0, 0.0, 1.0);
#endif
    v_worldPos = world.xyz;
#ifdef MESH_TANGENTS
#ifdef SKINNED
    v_worldTangent = vec4(mat3(skin) * a_tangent.xyz, a_tangent.w);
#else
    mat3 tangentModel = mat3(esInstanceModel());

    v_worldTangent = vec4(tangentModel * a_tangent.xyz, determinant(tangentModel) < 0.0 ? -a_tangent.w : a_tangent.w);
#endif
#endif
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
#ifdef ES_VELOCITY
in highp vec4 v_velCur;
in highp vec4 v_velPrev;
#endif

uniform sampler2D u_texture;
#ifdef NORMAL_MAP
uniform sampler2D u_normalMap;
#endif

#ifdef ES_GBUFFER




layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;

vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

void main() {
#ifdef ES_VELOCITY



    highp vec2 now = v_velCur.xy / v_velCur.w;
    highp vec2 was = v_velPrev.xy / max(v_velPrev.w, 1e-6);
    fragColor = vec4((was - now) * 0.5, gl_FragCoord.z, v_velPrev.w > 1e-6 ? 1.0 : 0.0);
#elif defined(SHADOW_DEPTH)
#ifdef PREPASS_COVERAGE


    highp float baseAlpha = texture(u_texture, v_texCoord).a * v_color.a * u_tint.a;
    highp float coverage = (baseAlpha - u_alphaCutoff) / max(fwidth(baseAlpha), 1e-4) + 0.5;
    if (coverage <= 0.0) discard;
    fragColor = vec4(0.0, 0.0, 0.0, min(coverage, 1.0));
#else
#ifdef SHADOW_ALPHA


    if (texture(u_texture, v_texCoord).a * v_color.a < u_alphaCutoff) discard;
#endif



    fragColor = vec4(packDepth(clamp(v_shadowClip.z / v_shadowClip.w * 0.5 + 0.5,
                                     0.0, 1.0)), 1.0);
#endif
#else
    vec4 base = texture(u_texture, v_texCoord) * v_color;
#ifdef LIT
    highp vec3 N = normalize(v_worldNormal);
#ifdef NORMAL_MAP
    N = perturbNormal(N, v_worldPos, v_texCoord, sampleNormal(u_normalMap, v_texCoord));
#endif

    if (!gl_FrontFacing) N = -N;






    vec3 shaded = applyLightingPBR(base.rgb, N, v_worldPos, viewDirection(v_worldPos),
                                   0.0, 1.0, 1.0, 1.0);
    fragColor = vec4(shaded, base.a);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), 1.0, 0.75);
#endif
#else
#ifdef MESH_LIGHTMAP



    fragColor = vec4(base.rgb * mix(vec3(1.0), bakedIrradiance(), v_lightmap.z), base.a);
#else
    fragColor = base;
#endif
#endif
#endif
}
#pragma end

#pragma vertex wgsl
#ifdef SKINNED
struct SkinConstants { bones : array<mat4x4f, 64> };
@group(0) @binding(5) var<uniform> skin : SkinConstants;
#endif





struct MorphConstants { info : vec4f, shape : array<vec4f, 8> };
@group(0) @binding(6) var<uniform> morph : MorphConstants;
@group(1) @binding(4) var t4 : texture_2d<f32>;

fn morphDelta(index : f32) -> vec3f {
    let width = morph.info.w;
    return textureLoad(t4, vec2i(i32(index % width), i32(index / width)), 0).xyz;
}

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
#endif
#ifdef MESH_LIGHTMAP
    @location(7) a_texCoord1 : vec2f,
#endif
#ifdef MESH_TANGENTS
    @location(4) a_tangent : vec4f,
#endif

    @builtin(vertex_index) vertexIndex : u32,
};
struct VSOut {
    @builtin(position) @invariant pos : vec4f,
    @location(0) v_texCoord : vec2f,
    @location(1) v_color : vec4f,
#ifdef LIT
    @location(2) v_worldNormal : vec3f,
    @location(3) v_worldPos : vec3f,
#ifdef MESH_TANGENTS
    @location(8) v_worldTangent : vec4f,
#endif
#endif
#ifdef SHADOW_DEPTH

    @location(4) v_shadowClip : vec4f,
#endif
#ifdef ES_VELOCITY
    @location(4) v_velCur : vec4f,
    @location(7) v_velPrev : vec4f,
#endif
#ifdef MESH_LIGHTMAP
    @location(5) v_lightmap : vec3f,
#endif


    @location(6) @interpolate(flat) v_probeSlot : f32,
};

#ifdef ES_MATERIAL_VERTEX
var<private> es_vertexColor : vec4f;
@@ES_VERTEX_HOOK@@
#endif

#ifdef ES_VELOCITY
#ifdef SKINNED

fn esPrevBone(joint : u32) -> mat4x4f {
    let at = 8 + i32(joint) * 3;
    let r0 = esInstanceTexel(at);
    let r1 = esInstanceTexel(at + 1);
    let r2 = esInstanceTexel(at + 2);
    return mat4x4f(vec4f(r0.x, r1.x, r2.x, 0.0), vec4f(r0.y, r1.y, r2.y, 0.0),
                   vec4f(r0.z, r1.z, r2.z, 0.0), vec4f(r0.w, r1.w, r2.w, 1.0));
}
#endif
#endif

@vertex fn vs_main(v : VSIn, @builtin(instance_index) inst : u32) -> VSOut {
    g_instanceId = i32(inst);
    var local = v.a_position;
#ifdef MESH_NORMALS
    var localNormal = v.a_normal;
#else
    var localNormal = vec3f(0.0, 0.0, 1.0);
#endif


    let live = i32(morph.info.x);
    for (var i = 0; i < 8; i = i + 1) {
        if (i >= live) { break; }
        let at = (morph.shape[i].x * morph.info.y + f32(v.vertexIndex)) * morph.info.z;
        local = local + morph.shape[i].y * morphDelta(at);
        if (morph.info.z > 1.5) {
            localNormal = localNormal + morph.shape[i].y * morphDelta(at + 1.0);
        }
    }
#ifdef ES_MATERIAL_VERTEX
    es_vertexColor = v.a_color;
    esMaterialVertex(&local, &localNormal, v.a_texCoord);
#endif
#ifdef SKINNED


    let pose = v.a_weights.x * skin.bones[v.a_joints.x]
             + v.a_weights.y * skin.bones[v.a_joints.y]
             + v.a_weights.z * skin.bones[v.a_joints.z]
             + v.a_weights.w * skin.bones[v.a_joints.w];
    let world = pose * vec4f(local, 1.0);
#else
    let world = esInstanceModel() * vec4f(local, 1.0);
#endif

    var out : VSOut;
    out.pos = frame.projection * world;
    out.v_texCoord = v.a_texCoord;
#ifdef ES_MATERIAL_VERTEX
    out.v_color = es_vertexColor * esInstanceTint();
#else
    out.v_color = v.a_color * esInstanceTint();
#endif
#ifdef WEIGHT_HEAT
#ifdef SKINNED
    {
        let chosen = u32(esInstanceTint().x);
        let own = vec4f(v.a_joints == vec4u(chosen));
        let heat = dot(own, v.a_weights);
        out.v_color = vec4f(select(mix(vec3f(0.2, 0.4, 1.0), vec3f(1.0, 0.25, 0.2), clamp(heat, 0.0, 1.0)),
                                   vec3f(0.1), heat < 0.01), 1.0);
    }
#endif
#endif
#ifdef MESH_LIGHTMAP
    let lmRect = esInstanceLightmapRect();
    out.v_lightmap = vec3f(v.a_texCoord1 * lmRect.xy + lmRect.zw,
                           select(0.0, 1.0, lmRect.x > 0.0));
#endif
#ifdef SHADOW_DEPTH
    out.v_shadowClip = out.pos;
#endif
#ifdef ES_VELOCITY
    {

#ifdef SKINNED

        let prevSkin = v.a_weights.x * esPrevBone(v.a_joints.x) + v.a_weights.y * esPrevBone(v.a_joints.y)
                     + v.a_weights.z * esPrevBone(v.a_joints.z) + v.a_weights.w * esPrevBone(v.a_joints.w);
        let L = prevSkin * vec4f(local, 1.0);
#else
        let L = vec4f(local, 1.0);
#endif
        let before = esInstanceTint();
        out.v_velCur = out.pos;
        let prev = vec4f(dot(esInstanceTexel(4), L), dot(esInstanceTexel(5), L),
                         dot(esInstanceTexel(6), L), dot(esInstanceTexel(7), L));
        out.v_velPrev = vec4f(prev.xy + before.xy * prev.w, prev.zw);
    }
#endif

    out.v_probeSlot = f32(inst);
#ifdef LIT
#ifdef MESH_NORMALS
#ifdef SKINNED
    out.v_worldNormal = mat3x3f(pose[0].xyz, pose[1].xyz, pose[2].xyz) * localNormal;
#else
    out.v_worldNormal = esInstanceNormalMatrix() * localNormal;
#endif
#else

    out.v_worldNormal = vec3f(0.0, 0.0, 1.0);
#endif
    out.v_worldPos = world.xyz;
#ifdef MESH_TANGENTS
#ifdef SKINNED
    out.v_worldTangent = vec4f(mat3x3f(pose[0].xyz, pose[1].xyz, pose[2].xyz) * v.a_tangent.xyz, v.a_tangent.w);
#else
    let tangentModel = mat3x3f(esInstanceModel()[0].xyz, esInstanceModel()[1].xyz, esInstanceModel()[2].xyz);
    out.v_worldTangent = vec4f(tangentModel * v.a_tangent.xyz,
                               select(v.a_tangent.w, -v.a_tangent.w, determinant(tangentModel) < 0.0));
#endif
#endif
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
#ifdef MESH_LIGHTMAP

@group(1) @binding(5) var t5 : texture_2d<f32>;
@group(1) @binding(13) var s5 : sampler;
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
#ifdef MESH_TANGENTS
    @location(8) v_worldTangent : vec4f,
#endif
#endif
#ifdef SHADOW_DEPTH
    @location(4) v_shadowClip : vec4f,
#endif
#ifdef ES_VELOCITY
    @location(4) v_velCur : vec4f,
    @location(7) v_velPrev : vec4f,
#endif
#ifdef MESH_LIGHTMAP
    @location(5) v_lightmap : vec3f,
#endif


    @location(6) @interpolate(flat) v_probeSlot : f32,
};

#ifdef ES_GBUFFER

struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
};

fn packNormal(n : vec3f) -> vec2f {
    let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
    let sgn = vec2f(select(-1.0, 1.0, a.x >= 0.0), select(-1.0, 1.0, a.y >= 0.0));
    var e = a.xy;
    if (a.z < 0.0) { e = (vec2f(1.0) - abs(a.yx)) * sgn; }
    return e * 0.5 + 0.5;
}

@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> FragOut {
#else
@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
#endif


    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_TANGENTS
#ifdef LIT
    g_worldTangent = v.v_worldTangent;
#endif
#endif
#ifdef ES_VELOCITY

    let now = v.v_velCur.xy / v.v_velCur.w;
    let was = v.v_velPrev.xy / max(v.v_velPrev.w, 1e-6);
    return vec4f((was - now) * 0.5, v.pos.z, select(0.0, 1.0, v.v_velPrev.w > 1e-6));
#elif defined(SHADOW_DEPTH)
#ifdef PREPASS_COVERAGE

    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let baseAlpha = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy).a * v.v_color.a * mc.u_tint.a;
    let edge = max(fwidth(baseAlpha), 1e-4);
    let coverage = (baseAlpha - mc.u_alphaCutoff) / max(edge, 1e-4) + 0.5;
    if (coverage <= 0.0) { discard; }
    return vec4f(0.0, 0.0, 0.0, min(coverage, 1.0));
#else
#ifdef SHADOW_ALPHA

    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    if (textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy).a * v.v_color.a < mc.u_alphaCutoff) { discard; }
#endif



    return vec4f(packDepth(clamp(v.v_shadowClip.z / v.v_shadowClip.w * 0.5 + 0.5,
                                 0.0, 1.0)), 1.0);
#endif
#else


    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color;
#ifdef LIT
    var N = normalize(v.v_worldNormal);
#ifdef NORMAL_MAP
    N = perturbNormal(N, v.v_worldPos, v.v_texCoord, sampleNormalGrad(t1, s1, v.v_texCoord, duvx, duvy));
#endif
    if (!front) { N = -N; }




    let shaded = applyLightingPBR(base.rgb, N, v.v_worldPos, viewDirection(v.v_worldPos),
                                  0.0, 1.0, 1.0, 1.0);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(shaded, base.a);
    frag.surface = vec4f(packNormal(normalize(N)), 1.0, 0.75);
    return frag;
#else
    return vec4f(shaded, base.a);
#endif
#else
#ifdef MESH_LIGHTMAP

    return vec4f(base.rgb * mix(vec3f(1.0), bakedIrradiance(), vec3f(v.v_lightmap.z)), base.a);
#else
    return base;
#endif
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

    let texColor = textureSampleGrad(t0, s0, v.v_texCoord, dpdx(v.v_texCoord), dpdy(v.v_texCoord));
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

#ifdef ES_SKY_PANORAMA
uniform sampler2D u_texture;



highp vec3 skyTexel(in ivec2 p, in ivec2 size) {
    ivec2 q = ivec2(((p.x % size.x) + size.x) % size.x, clamp(p.y, 0, size.y - 1));
    highp vec4 t = texelFetch(u_texture, q, 0);
    return t.rgb * t.rgb * (t.a * t.a * u_envParams.y);
}



highp vec3 skyPanorama(in highp vec3 d) {
    ivec2 size = textureSize(u_texture, 0);
    highp float u = 0.5 - atan(d.x, d.z) / 6.28318530718;
    highp float v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359;
    highp vec2 f = vec2(u * float(size.x), v * float(size.y)) - 0.5;
    ivec2 i = ivec2(floor(f));
    highp vec2 t = f - floor(f);
    return mix(mix(skyTexel(i, size), skyTexel(i + ivec2(1, 0), size), t.x),
               mix(skyTexel(i + ivec2(0, 1), size), skyTexel(i + ivec2(1, 1), size), t.x), t.y);
}
#endif

void main() {
#ifdef ES_SKY_PANORAMA
    fragColor = vec4(skyPanorama(envDirection(-viewDirection(v_worldPos))), 1.0);
#else


    fragColor = vec4(envSampleMip(-viewDirection(v_worldPos), 0.0), 1.0);
#endif
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

#ifdef ES_SKY_PANORAMA
fn skyTexel(p : vec2i, size : vec2i) -> vec3f {
    let q = vec2i(((p.x % size.x) + size.x) % size.x, clamp(p.y, 0, size.y - 1));
    let t = textureLoad(t0, q, 0);
    return t.rgb * t.rgb * (t.a * t.a * lc.u_envParams.y);
}

fn skyPanorama(d : vec3f) -> vec3f {
    let size = vec2i(textureDimensions(t0, 0));
    let u = 0.5 - atan2(d.x, d.z) / 6.28318530718;
    let v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359;
    let f = vec2f(u * f32(size.x), v * f32(size.y)) - 0.5;
    let i = vec2i(floor(f));
    let t = f - floor(f);
    return mix(mix(skyTexel(i, size), skyTexel(i + vec2i(1, 0), size), t.x),
               mix(skyTexel(i + vec2i(0, 1), size), skyTexel(i + vec2i(1, 1), size), t.x), t.y);
}
#endif

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
#ifdef ES_SKY_PANORAMA
    return vec4f(skyPanorama(envDirection(-viewDirection(v.v_worldPos))), 1.0);
#else
    return vec4f(envSampleMip(-viewDirection(v.v_worldPos), 0.0), 1.0);
#endif
}
#pragma end
)esshader";

}  // namespace esengine::ShaderEmbeds
