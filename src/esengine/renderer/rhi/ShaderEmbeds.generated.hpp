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

// Compile-time variant: discard fragments the sprite draws as (near-)transparent.
// Selected for a STENCIL MASK draw, which runs this shader with color writes off:
// without the discard every transparent corner of the quad still writes stencil,
// so a circular mask sprite would clip a rectangle. Off for ordinary sprites, so
// they keep an unconditional (early-Z friendly) fragment path.
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
// highp: the SDF text branch needs precise distance + fwidth derivatives, and
// sprite sampling is unaffected by the wider range.
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
#ifdef ES_LINEAR
    // Vertex colors are authored sRGB; the sampled texel is already linear
    // (sRGB texture formats decode in hardware). Alpha is coverage — never encoded.
    vec4 tint = vec4(srgbToLinear(v_color.rgb), v_color.a);
#else
    vec4 tint = v_color;
#endif
#ifdef SDF
    // The glyph atlas stores a signed distance in the alpha channel (RGB = 1).
    // Distance ÷ fwidth = screen px from the edge; the ±0.5px clamp is exactly
    // one pixel of linear coverage ramp (the msdfgen standard).
    // v_sdfBias moves the edge outward before the ramp, which grows the glyph's
    // own shape by that many distance units — an outline pass draws the same
    // quads with it raised and its colour in the vertices.
    float dist = texColor.a;
    float screenPxDist = (dist - 0.5 + v_sdfBias) / max(fwidth(dist), 1e-6);
    float coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    fragColor = vec4(tint.rgb, tint.a * coverage);
#elif defined(LIT)
    // Flat normal; the tinted color is the albedo. Normal maps need a material.
    vec4 base = texColor * tint;
    fragColor = vec4(applyLighting2D(base.rgb, vec3(0.0, 0.0, 1.0), v_worldPos), base.a);
#else
  #ifdef ALPHA_CLIP
    // The SPRITE's alpha, not the tinted result: a mask graphic is routinely
    // tinted to near-zero alpha so it masks without being seen, and testing the
    // tinted value would discard the whole mask and clip everything away.
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
#ifdef ES_LINEAR
    let tint = vec4f(srgbToLinear(v.v_color.rgb), v.v_color.a);
#else
    let tint = v.v_color;
#endif
#ifdef SDF
    // Same coverage math as the GLSL stage; fwidth here is in uniform control
    // flow (main scope), which WGSL requires of derivative builtins.
    let dist = texColor.a;
    let screenPxDist = (dist - 0.5 + v.v_sdfBias) / max(fwidth(dist), 1e-6);
    let coverage = clamp(screenPxDist + 0.5, 0.0, 1.0);
    return vec4f(tint.rgb, tint.a * coverage);
#elif defined(LIT)
    let base = texColor * tint;
    return vec4f(applyLighting2D(base.rgb, vec3f(0.0, 0.0, 1.0), v.v_worldPos), base.a);
#else
  #ifdef ALPHA_CLIP
    // See the GLSL stage: test the sprite's alpha, not the tinted result.
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
#ifdef ES_LINEAR
    // The one mandatory OETF: the chain upstream is linear (sRGB attachments
    // decode on sample), the canvas backbuffer is plain UNORM.
    fragColor = vec4(linearToSrgb(c.rgb), c.a);
#else
    fragColor = c;
#endif
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let c = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
#ifdef ES_LINEAR
    return vec4f(linearToSrgb(c.rgb), c.a);
#else
    return c;
#endif
}
#pragma end
)esshader";

inline constexpr const char* MESH = R"esshader(#pragma shader "Mesh"
#pragma version 300 es
// Lit2D domain for the LIGHTING it injects (LightConstants + applyLighting2D),
// not for its canonical vertex stage — that is only supplied to a shader which
// writes none, and this one writes its own to place local vertices by a model
// matrix. So the light math is shared with every 2D lit surface rather than
// copied, and the std140 block stays the engine's to own.
#pragma domain Lit2D

// What the GEOMETRY carries. A layout may not declare an attribute its shader
// does not consume, so the normal channel and the per-object normal matrix are
// inside this switch on both sides — whether or not the draw asks to be lit.
#pragma feature MESH_NORMALS

// What the DRAW asks for. Orthogonal to the above on purpose: geometry with
// normals can be drawn unlit, and geometry without them can still take light
// (off a constant normal, which is what a 2D surface has).
#pragma feature LIT

// Geometry deformed by joints. Its own transform is NOT read: a skinned mesh's
// node placement is ignored (glTF requires it) because the bones are already
// world-space, so the per-object record carries only a tint.
#pragma feature SKINNED

// A normal map on top of those normals. Its tangent frame comes from the shared
// perturbNormal (screen-space derivatives), so the geometry needs no tangent
// channel — which is why this rides LIT rather than a vertex attribute.
#pragma feature NORMAL_MAP

// The shadow-map pass: the same geometry, from the light, writing depth as colour
// instead of shading. A feature and not a second shader, because what has to be
// identical between the two passes is the VERTEX stage — a skinned occluder must
// land where its skinned self lands, and one copy of that is one that cannot drift.
#pragma feature SHADOW_DEPTH

// GPU-resident geometry. Slot 0 is the mesh's own vertices, which are LOCAL
// space and are never rewritten; slot 1 is the per-object record the frame
// streams, so the same mesh drawn twice costs one more transform rather than
// one more copy of its vertices.

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

// 8.. and not 3..: a channel's semantic IS its location, so adding normals to a
// mesh must not move the per-object record (see MESH_INSTANCE_FIRST_LOCATION).
#ifndef SKINNED
layout(location = 8)  in vec4 a_model0;
layout(location = 9)  in vec4 a_model1;
layout(location = 10) in vec4 a_model2;
layout(location = 11) in vec4 a_model3;
#endif
layout(location = 12) in vec4 a_instTint;
#if defined(MESH_NORMALS) && !defined(SKINNED)
// The normal matrix (inverse transpose of the model's 3x3), per object: under a
// non-uniform scale the model matrix skews a normal, and inverting one per
// vertex is the alternative.
layout(location = 13) in vec3 a_nrm0;
layout(location = 14) in vec3 a_nrm1;
layout(location = 15) in vec3 a_nrm2;
#endif

#ifdef SKINNED
// This draw's pose, rewritten immediately before it (SkinConstants, binding 5).
layout(std140) uniform SkinConstants {
    mat4 u_bones[64];
};
#endif

out vec2 v_texCoord;
out vec4 v_color;
#ifdef LIT
out highp vec3 v_worldNormal;
// The full position, not just the plane's: a tangent frame is derived from how
// it changes across a fragment, which xy alone cannot say for a tilted surface.
out highp vec3 v_worldPos;
#endif
#ifdef SHADOW_DEPTH
// The clip position, and not the depth it divides down to. z/w is not affine across a
// triangle, so a stage that divides here hands the fragment an interpolation of the
// corners' quotients rather than the quotient at the fragment — off by more, the wider
// the depth range one triangle spans. An orthographic map never showed it (w is 1
// throughout), and a cube face looking along a floor is the case that does: the error
// there is worth several world units, which shadows the caster against itself.
out highp vec4 v_shadowClip;
#endif

void main() {
#ifdef SKINNED
    // The four bones this vertex is bound to, blended by their weights. The
    // result is world-space, so no model matrix follows it.
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
    // A surface with no normal channel faces the viewer, exactly as a sprite does.
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
    // The expression the receiver evaluates on u_shadowMatrix, evaluated here on the
    // same matrix and at the same point: whatever each backend's clip z means, both
    // sides mean it alike.
    fragColor = vec4(packDepth(clamp(v_shadowClip.z / v_shadowClip.w * 0.5 + 0.5,
                                     0.0, 1.0)), 1.0);
#else
    vec4 base = texture(u_texture, v_texCoord) * v_color;
#ifdef LIT
    highp vec3 N = normalize(v_worldNormal);
#ifdef NORMAL_MAP
    N = perturbNormal(N, v_worldPos, v_texCoord, sampleNormal(u_normalMap, v_texCoord));
#endif
    // The general form at a 2D surface's own parameters, but with the position it
    // really has: a shadow is cast on a point in space, and xy is not one.
    fragColor = vec4(applyLightingPBR(base.rgb, N, v_worldPos, viewDirection(v_worldPos),
                                      0.0, 1.0, 0.0, 1.0), base.a);
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
    // The clip position, not the depth it divides down to — see the GLSL twin.
    @location(4) v_shadowClip : vec4f,
#endif
};

@vertex fn vs_main(v : VSIn) -> VSOut {
#ifdef SKINNED
    // The four bones this vertex is bound to, blended by their weights. The
    // result is world-space, so no model matrix follows it.
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
    // A surface with no normal channel faces the viewer, exactly as a sprite does.
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
// The shadow map, on the slot the injected header samples. A fragment-only twin
// gets these from the batch texture contract; one that writes its own says so.
@group(1) @binding(2) var t2 : texture_2d<f32>;
@group(1) @binding(10) var s2 : sampler;
#endif
#ifdef ES_ENV_MAP
// The environment's reflection, one slot on. Same reason as above — and without
// it the injected sampler names an identifier this twin never declared, which
// reaches anyone as an invalid pipeline that does not mention a shader.
@group(1) @binding(3) var t3 : texture_2d<f32>;
@group(1) @binding(11) var s3 : sampler;
#endif

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
    // The expression the receiver evaluates on u_shadowMatrix, evaluated here on the
    // same matrix and at the same point: whatever each backend's clip z means, both
    // sides mean it alike.
    return vec4f(packDepth(clamp(v.v_shadowClip.z / v.v_shadowClip.w * 0.5 + 0.5,
                                 0.0, 1.0)), 1.0);
#else
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
#ifdef LIT
    var N = normalize(v.v_worldNormal);
#ifdef NORMAL_MAP
    N = perturbNormal(N, v.v_worldPos, v.v_texCoord, sampleNormal(t1, s1, v.v_texCoord));
#endif
    // The general form at a 2D surface's own parameters, but with the position it
    // really has: a shadow is cast on a point in space, and xy is not one.
    return vec4f(applyLightingPBR(base.rgb, N, v.v_worldPos, viewDirection(v.v_worldPos),
                                  0.0, 1.0, 0.0, 1.0), base.a);
#else
    return base;
#endif
#endif
}
#pragma end
)esshader";

inline constexpr const char* PARTICLE = R"esshader(#pragma shader "ParticleInstance"
#pragma version 300 es

#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

layout(location = 2) in vec3 a_inst_position;
layout(location = 3) in vec2 a_inst_size;
layout(location = 4) in float a_inst_rotation;
layout(location = 5) in vec4 a_inst_color;
layout(location = 6) in vec2 a_inst_uv_offset;
layout(location = 7) in vec2 a_inst_uv_scale;

out vec2 v_texCoord;
out vec4 v_color;

// The quad's own axes in world space: a particle faces the viewer wherever it is
// seen from. Head-on and orthographic these come out (1,0,0) and (0,1,0), which
// is the flat quad every 2D scene has always drawn — a billboard is not a second
// path, it is the general case the flat one is a corner of.
void billboardAxes(in highp vec3 worldCenter, out highp vec3 right, out highp vec3 up) {
    highp vec3 fwd = viewDirection(worldCenter);
    // Looking straight down the world up, that axis cannot orient the quad.
    highp vec3 refUp = abs(fwd.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    right = normalize(cross(refUp, fwd));
    up = cross(fwd, right);
}

void main() {
    vec2 scaled = a_position * a_inst_size;

    float cosR = cos(a_inst_rotation);
    float sinR = sin(a_inst_rotation);
    vec2 rotated = vec2(
        scaled.x * cosR - scaled.y * sinR,
        scaled.x * sinR + scaled.y * cosR
    );

    highp vec3 right;
    highp vec3 up;
    billboardAxes(a_inst_position, right, up);
    vec3 worldPos = a_inst_position + right * rotated.x + up * rotated.y;
    gl_Position = u_projection * vec4(worldPos, 1.0);

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
struct VSIn {
    @location(0) a_position : vec2f,
    @location(1) a_texCoord : vec2f,
    @location(2) a_inst_position : vec3f,
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

    // The GLSL stage's billboardAxes, in the dialect: face the viewer, and fall
    // back to world +Z as the reference when looking straight down world up.
    let fwd = viewDirection(v.a_inst_position);
    var refUp = vec3f(0.0, 1.0, 0.0);
    if (abs(fwd.y) > 0.999) { refUp = vec3f(0.0, 0.0, 1.0); }
    let right = normalize(cross(refUp, fwd));
    let up = cross(fwd, right);
    let worldPos = v.a_inst_position + right * rotated.x + up * rotated.y;

    var out : VSOut;
    out.pos = frame.projection * vec4f(worldPos, 1.0);
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
#pragma domain Lit2D

// The background half of an environment. The reflection in a metal ball and the
// sky behind it are the same baked panorama; without this only one of them was
// ever visible, and a scene lit by a sky sat in front of a flat clear colour.
//
// Geometry is a quad on the far plane, so the vertex stage needs no matrix of its
// own — the fragment's direction is the one from the eye through it, which is
// what viewDirection() already answers (negated: it points AT the viewer).

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
    // Mip 0: the sharpest level of the prefiltered atlas is the sky as it was
    // photographed. The rougher ones exist to be reflected, not to be looked at.
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
// Slot 0 is bound and never read — a draw fills it so the walk that pins the
// atlas one slot on has somewhere to start. The atlas itself is on 3, and
// without these two the injected sampler names identifiers this twin never
// declared: an invalid pipeline that does not mention a shader.
@group(1) @binding(0) var t0 : texture_2d<f32>;
@group(1) @binding(8) var s0 : sampler;
@group(1) @binding(3) var t3 : texture_2d<f32>;
@group(1) @binding(11) var s3 : sampler;

// Declared again: each WGSL block is compiled on its own, so a struct defined in
// the vertex one is an undeclared name here — and that reaches anyone as an
// invalid pipeline with nothing in the log about a shader.
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
