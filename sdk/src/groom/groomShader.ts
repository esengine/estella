// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomShader.ts
 * @brief The Strands built-in shader: a groom's curves drawn as ribbons that face the eye, lit along the strand.
 *
 * A strand's mesh is a line of points, each twice (one per edge), with the strand's direction in the normal: the vertex hook moves each
 * copy out to its side, across the strand and square to the eye, by the strand's half width there. The direction stays in the normal so
 * the fragment has it, and lights along it as the Hair shader does (Kajiya-Kay diffuse, two shifted highlights, light through from behind).
 *
 * The shader source lives with the module that installs it, not in the core's list of built-in shaders: a package that does not install
 * the module carries none of it.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';
import { PACK_NORMAL_GLSL } from '../render/shaderLib';

const WIDTH_GLSL = `
highp float strandWorldPerPixel(highp float dist) {
    highp float sy = length(vec3(u_projection[0][1], u_projection[1][1], u_projection[2][1]));
    highp float px = 2.0 / max(sy * u_viewport.y, 1e-6);
    return u_camera.w > 0.5 ? px * dist : px;
}
// The strand's own half width at t (0 the root, 1 the tip), in world units: the group's width where it sets one, the curve's own radius
// (the vertex colour's alpha, a share of u_maxRadius) where it does not, scaled from the root's scale to the tip's.
highp float strandHalfWidth(float radiusShare, float t) {
    highp float half_ = u_hairWidth > 0.0 ? u_hairWidth * 0.5 : radiusShare * u_maxRadius;
    return half_ * mix(u_rootScale, u_tipScale, t);
}
`;


const STRANDS = `#pragma shader "Strands"
#pragma version 300 es
#pragma domain Lit
// The colour at the root and at the tip, times the colour each point carries (white where the groom has none).
#pragma param u_rootColor color default(0.32,0.22,0.14,1)
#pragma param u_tipColor color default(0.62,0.48,0.32,1)
// The strand's width in world units; 0 takes each curve's own radius. The Groom component writes it, from the group's Hair Width.
#pragma param u_hairWidth float default(0) range(0,100) ui(slider)
// The widest radius the group's curves carry, in world units: the vertex colour's alpha is a share of it. The Groom component writes it.
#pragma param u_maxRadius float default(0) range(0,100) ui(slider)
// A scale on the width at the root, interpolated to the tip's scale along the strand.
#pragma param u_rootScale float default(1) range(0,4) ui(slider)
#pragma param u_tipScale float default(1) range(0,4) ui(slider)
// The narrowest a strand is drawn, in pixels: narrower, it is drawn this wide with its coverage cut to the width it has (alpha to coverage),
// so a sparse strand fades rather than breaking into dashes. 0 draws every strand as wide as it is.
#pragma param u_strandMinPx float default(0) range(0,4) ui(slider)
#pragma coverage u_strandMinPx
// How tightly each highlight is drawn, how strong they are, and how far each rides off the strand. The second is the coloured one.
#pragma param u_roughness float default(0.35) range(0.05,1) ui(slider)
#pragma param u_specular float default(1) range(0,2) ui(slider)
#pragma param u_lobeGain float default(1) range(0,2) ui(slider)
#pragma param u_shiftPrimary float default(-0.1) range(-1,1) ui(slider)
#pragma param u_shiftSecondary float default(0.2) range(-1,1) ui(slider)
#pragma param u_secondaryTint color default(0.75,0.45,0.25,1)
// Light that comes through the strands from behind, and how much of the diffuse is the strand's own (Kajiya-Kay) against a surface's.
#pragma param u_translucency float default(0.4) range(0,1) ui(slider)
#pragma param u_strandDiffuse float default(0.8) range(0,1) ui(slider)
// Above zero alpha, the strands are this one colour, unlit: an editor showing which group is which.
#pragma param u_groupColor color default(0,0,0,0)
// How much darker the roots are than the tips.
#pragma param u_rootDark float default(0.35) range(0,1) ui(slider)
// How much of the light a depth of strands takes, per world unit along it. The Groom component writes it from the group's Hair Shadow Density.
#pragma param u_hairShadow float default(1) range(0,2000) ui(slider)
#pragma hairshadow u_hairShadow
#pragma vertexbounds 4
#pragma vertexoffset
${WIDTH_GLSL}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    mat4 model = esInstanceModel();
    highp vec3 at = (model * vec4(local, 1.0)).xyz;
    highp vec3 along = normalize(mat3(model) * localNormal + vec3(1e-9, 0.0, 0.0));
    highp vec3 toEye = u_camera.w > 0.5 ? u_camera.xyz - at : -vec3(u_projection[0][2], u_projection[1][2], u_projection[2][2]);
    highp vec3 side = cross(along, toEye);
    if (dot(side, side) < 1e-12) side = cross(along, abs(along.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
    side = normalize(side);
    highp float half_ = strandHalfWidth(es_vertexColor.a, uv.y);
#ifndef SHADOW_DEPTH
    // Only for the eye: a shadow map's texel is far wider than a strand, and a strand widened to one there casts a shadow as wide as a finger.
    if (u_strandMinPx > 0.0) half_ = max(half_, u_strandMinPx * 0.5 * strandWorldPerPixel(length(toEye)));
#endif
    highp vec3 moved = side * (half_ * (uv.x * 2.0 - 1.0));
    // In the world, then into the groom's own space: it is placed, turned and scaled, and a world unit across is not one of its own.
    local += (moved * mat3(model)) / max(dot(model[0].xyz, model[0].xyz), 1e-12);
}
#pragma end

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

#ifdef ES_GBUFFER
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

${PACK_NORMAL_GLSL}
#else
out vec4 fragColor;
#endif
${WIDTH_GLSL}

void main() {
    float t = clamp(v_texCoord.y, 0.0, 1.0);
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    // The strand's direction came in the normal; the normal it is lit with lies across it, facing the eye.
    highp vec3 T = normalize(v_worldNormal + vec3(1e-9, 0.0, 0.0));
    vec3 viewDir = viewDirection(P);
    highp vec3 N = viewDir - T * dot(viewDir, T);
    N = dot(N, N) > 1e-8 ? normalize(N) : cross(T, abs(T.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
    // Rounded: across the ribbon the normal turns from one side of the strand to the other, as it would on a cylinder.
    float across = v_texCoord.x * 2.0 - 1.0;
    highp vec3 B = normalize(cross(T, N));
    N = normalize(N * sqrt(max(1.0 - across * across, 0.0)) + B * across);
    float alpha = 1.0;
    if (u_strandMinPx > 0.0) {
        highp float need = u_strandMinPx * 0.5 * strandWorldPerPixel(max(length(P - u_camera.xyz), 1e-3));
        alpha = clamp(strandHalfWidth(v_color.a, t) / max(need, 1e-9), 0.0, 1.0);
    }
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 N = vec3(0.0, 0.0, 1.0);
    highp vec3 T = vec3(0.0, 1.0, 0.0);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float alpha = 1.0;
#endif
    vec3 base = mix(u_rootColor.rgb, u_tipColor.rgb, t) * v_color.rgb;
    base *= mix(1.0, 0.35 + 0.65 * t, u_rootDark);
    SurfaceExt ext = surfaceExtNone(N);
    ext.aniso = vec4(T, 0.0);
    ext.misc = vec4(0.046, max(u_lobeGain, 0.001), u_shiftPrimary, u_shiftSecondary);
    ext.strand = vec4(u_strandDiffuse, 0.0, 0.0, 0.0);
    ext.scatter = vec4(base * u_secondaryTint.rgb * 1.6, 0.35);
    ext.trans = vec4(u_translucency, 0.25, 0.0, 0.0);
    g_hairShadow = u_hairShadow;
    vec3 lit = applyLightingSurface(base, N, P, viewDir, 0.0, u_roughness, u_specular, mix(0.6, 1.0, t), ext);
    if (u_groupColor.a > 0.0) lit = u_groupColor.rgb;
    fragColor = vec4(lit, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(N), u_roughness, 0.75);
    fragAlbedo = vec4(base, 1.0);
#endif
}
#pragma end

`;

export const STRANDS_SHADER_TEMPLATE = makeBuiltinShaderTemplate('strands', 'Strands',
    'A groom\'s curves drawn as ribbons that face the eye, as wide as the group says from root to tip, lit along the strand.', STRANDS);
