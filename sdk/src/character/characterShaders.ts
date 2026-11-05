// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  characterShaders.ts
 * @brief The Hair, Skin and Eye built-in shaders a character is shaded with.
 *
 * The shader source lives with the module that installs it, not in the core's list of built-in shaders: a package that does not install the module carries none of it.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';


// Hair: lit as strands. The flow map gives the strand direction; the lighting does Kajiya-Kay diffuse and two shifted highlights along it
// (misc.y above zero is the switch). Two-sided and translucent; the base colour is the mesh's own texture, as in the Model shader.
const HAIR = `#pragma shader "Hair"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)
#pragma param u_ormMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
// Which way each strand runs: red and green are a direction across the texture, the way an authored flow map writes it.
#pragma param u_flowMap texture default(white) texel(data)
// A texture that shifts the highlight along the strand from one place to the next, and how far, and how often it repeats.
#pragma param u_shiftMap texture default(white) texel(data)
#pragma param u_shiftAmount float default(0.35) range(0,1) ui(slider)
#pragma param u_shiftTile float default(6) range(0.1,64) ui(slider)
// How tightly each highlight is drawn (roughness: lower is a narrower line), how strong they are, and how far each rides off the strand's
// centre line. The second is the coloured one, tinted by u_secondaryTint.
#pragma param u_roughness float default(0.3) range(0.05,1) ui(slider)
#pragma param u_specular float default(1) range(0,2) ui(slider)
// How much of the strand highlight the lamps draw, apart from the reflection of the environment (which u_specular alone sets): 1 is the authored lobe.
#pragma param u_lobeGain float default(1) range(0,2) ui(slider)
#pragma param u_shiftPrimary float default(-0.1) range(-1,1) ui(slider)
#pragma param u_shiftSecondary float default(0.2) range(-1,1) ui(slider)
#pragma param u_secondaryTint color default(0.75,0.45,0.25,1)
// Light that comes through the strands from behind.
#pragma param u_translucency float default(0.4) range(0,1) ui(slider)
// How much of the diffuse is the strand's own (Kajiya-Kay: how far the light is from along the strand, with a soft wrap) against a surface's N dot L: 0 is the Principled
// shader's diffuse, which goes dark where a card turns from the light; more keeps a card lit edge-on, which flattens locks into one tone.
#pragma param u_strandDiffuse float default(0.6) range(0,1) ui(slider)
// Above zero, the highlight is the Principled shader's instead of the two strand lobes: GGX stretched along the strand by this anisotropy
// (Blender's), with u_specular as the specular factor (F0 = 0.04 x it). A card authored in Blender with an anisotropy shades as it did there.
#pragma param u_anisotropy float default(0) range(0,1) ui(slider)
// A negative bias on the colour's mip level keeps the fine strands a hair card is covered in from washing out at a slant, which they do at once.
#pragma param u_sharpen float default(-0.8) range(-3,1) ui(slider)
// How much darker the roots are than the tips: the occlusion map's red, pushed.
#pragma param u_rootDark float default(0.5) range(0,1) ui(slider)
// A card's alpha cut at this level, and sharpened to about a texel so alpha-to-coverage feathers the edge of every strand instead of stair-stepping it; 0 keeps the card opaque.
#pragma param u_alphaCutoff float default(0) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff
// The soft outer band of a card: where its alpha falls from the cutoff down by this much, a second, blended pass draws the strand's tip fading out
// (the opaque pass keeps what is above the cutoff, feathered by coverage). Sorted with the other blended draws; 0 leaves it out.
#pragma param u_tipSoftness float default(0) range(0,0.5) ui(slider)
#pragma tips u_tipSoftness
// A card's strands are drawn as locks: this many across the card's width (0 leaves the card as authored), each lock lighter or darker than the next by
// u_clumpTone, its highlight pushed along the strand by u_clumpShift so it breaks from lock to lock, and darkened toward the seam between locks by u_clumpGap.
#pragma param u_clumpCount float default(0) range(0,200) ui(slider)
#pragma param u_clumpTone float default(0.25) range(0,0.6) ui(slider)
#pragma param u_clumpShift float default(0.3) range(0,1) ui(slider)
#pragma param u_clumpGap float default(0.3) range(0,1) ui(slider)
// How much of the light a layer of strands takes, per world unit along it (an opacity density; 0 shades like any surface, with a hard shadow). Above zero
// the frame also gives the hair a shadow cascade fitted to it alone, so the layers of cards a few millimetres apart are told apart, and the light left
// after them falls off with the depth of hair it passed through.
#pragma param u_hairShadow float default(0) range(0,2000) ui(slider)
#pragma hairshadow u_hairShadow

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
uniform sampler2D u_textures[1];

#ifdef ES_GBUFFER
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

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
#ifdef MESH_NORMALS
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 P = v_worldXYZ;
    highp vec3 N = perturbNormal(Ng, P, v_texCoord, sampleNormal(u_normalMap, v_texCoord));
    if (!gl_FrontFacing) { N = -N; Ng = -Ng; }
    // The strand: the flow map's direction across the texture, put onto the surface and made to lie across the normal.
    vec2 flow = texture(u_flowMap, v_texCoord).rg * 2.0 - 1.0;
    highp vec3 T = perturbNormal(Ng, P, v_texCoord, vec3(flow, 0.0));
    T -= N * dot(N, T);
    if (dot(T, T) < 1e-6) T = cross(N, abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
    T = normalize(T);
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 N = vec3(0.0, 0.0, 1.0);
    highp vec3 T = vec3(0.0, 1.0, 0.0);
#endif
    vec4 base = texture(u_textures[0], v_texCoord, u_sharpen) * v_color * u_tint;
    // Before any discard: a derivative needs every fragment of its quad.
    float alpha = 1.0;
#ifdef ES_TIP_PASS
    // The band below the cutoff, fading in toward it, and a texel past it so it meets the opaque card without a gap.
    alpha = (base.a - (u_alphaCutoff - u_tipSoftness)) / max(u_tipSoftness, 1e-4);
    if (base.a >= u_alphaCutoff + fwidth(base.a) || alpha <= 0.0) discard;
    alpha = min(alpha, 1.0);
#else
    if (u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, u_alphaCutoff, fwidth(base.a));
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
#endif
    float root = texture(u_ormMap, v_texCoord).r;
    float ao = mix(1.0, root, u_occlusionStrength);
    base.rgb *= mix(1.0, 0.35 + 0.65 * root, u_rootDark);
    float noise = (texture(u_shiftMap, v_texCoord * u_shiftTile).r - 0.5) * u_shiftAmount;
    if (u_clumpCount > 0.0) {
        float cu = v_texCoord.x * u_clumpCount;
        float cr = fract(sin(floor(cu) * 127.1 + 311.7) * 43758.5453);
        float cf = fract(cu);
        float seam = smoothstep(0.0, 0.35, cf) * smoothstep(0.0, 0.35, 1.0 - cf);
        base.rgb *= 1.0 + (cr - 0.5) * 2.0 * u_clumpTone;
        ao *= mix(1.0 - u_clumpGap, 1.0, seam);
        noise += (cr - 0.5) * u_clumpShift;
    }
    SurfaceExt ext = surfaceExtNone(N);
    ext.aniso = vec4(T, 0.0);
    float principled = step(1e-4, u_anisotropy);
    ext.misc = vec4(mix(0.046, 0.04 * u_specular, principled), max(u_lobeGain, 0.001), u_shiftPrimary + noise, u_shiftSecondary + noise);
    ext.strand = vec4(u_strandDiffuse, u_anisotropy, 0.0, 0.0);
    ext.scatter = vec4(base.rgb * u_secondaryTint.rgb * 1.6, 0.35);
    ext.trans = vec4(u_translucency, 0.25, 0.0, 0.0);
    vec3 viewDir = viewDirection(P);
    g_hairShadow = u_hairShadow;
    vec3 lit = applyLightingSurface(base.rgb, N, P, viewDir, 0.0, u_roughness, mix(u_specular, 1.0, principled), ao, ext);
    fragColor = vec4(lit, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), u_roughness, 0.75);
    fragAlbedo = vec4(base.rgb, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
    @location(2) albedo : vec4f,
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
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_TANGENTS
    g_worldTangent = v.v_worldTangent;
#endif
    var base = textureSampleBias(t0, s0, v.v_texCoord, mc.u_sharpen) * v.v_color * mc.u_tint;
    let edge = max(abs(dpdx(base.a)) + abs(dpdy(base.a)), 1e-4);
    let flowTex = textureSampleGrad(u_flowMap, u_flowMap_s, v.v_texCoord, duvx, duvy).rg * 2.0 - vec2f(1.0);
    let orm = textureSampleGrad(u_ormMap, u_ormMap_s, v.v_texCoord, duvx, duvy);
    let shiftTex = textureSampleGrad(u_shiftMap, u_shiftMap_s, v.v_texCoord * mc.u_shiftTile, duvx * mc.u_shiftTile, duvy * mc.u_shiftTile).r;
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    let P = v.v_worldXYZ;
    var N = perturbNormal(Ng, P, v.v_texCoord, sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy));
    if (!front) { N = -N; Ng = -Ng; }
    var T = perturbNormal(Ng, P, v.v_texCoord, vec3f(flowTex, 0.0));
    T = T - N * dot(N, T);
    if (dot(T, T) < 1e-6) {
        var seed = vec3f(1.0, 0.0, 0.0);
        if (abs(N.y) < 0.99) { seed = vec3f(0.0, 1.0, 0.0); }
        T = cross(N, seed);
    }
    T = normalize(T);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 0.0, 1.0);
    let T = vec3f(0.0, 1.0, 0.0);
#endif
    var alpha = 1.0;
#ifdef ES_TIP_PASS
    alpha = (base.a - (mc.u_alphaCutoff - mc.u_tipSoftness)) / max(mc.u_tipSoftness, 1e-4);
    if (base.a >= mc.u_alphaCutoff + edge || alpha <= 0.0) { discard; }
    alpha = min(alpha, 1.0);
#else
    if (mc.u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, mc.u_alphaCutoff, edge);
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#endif
    var ao = mix(1.0, orm.r, mc.u_occlusionStrength);
    base = vec4f(base.rgb * mix(1.0, 0.35 + 0.65 * orm.r, mc.u_rootDark), base.a);
    var noise = (shiftTex - 0.5) * mc.u_shiftAmount;
    if (mc.u_clumpCount > 0.0) {
        let cu = v.v_texCoord.x * mc.u_clumpCount;
        let cr = fract(sin(floor(cu) * 127.1 + 311.7) * 43758.5453);
        let cf = fract(cu);
        let seam = smoothstep(0.0, 0.35, cf) * smoothstep(0.0, 0.35, 1.0 - cf);
        base = vec4f(base.rgb * (1.0 + (cr - 0.5) * 2.0 * mc.u_clumpTone), base.a);
        ao = ao * mix(1.0 - mc.u_clumpGap, 1.0, seam);
        noise = noise + (cr - 0.5) * mc.u_clumpShift;
    }
    var ext = surfaceExtNone(N);
    ext.aniso = vec4f(T, 0.0);
    let principled = step(1e-4, mc.u_anisotropy);
    ext.misc = vec4f(mix(0.046, 0.04 * mc.u_specular, principled), max(mc.u_lobeGain, 0.001), mc.u_shiftPrimary + noise, mc.u_shiftSecondary + noise);
    ext.strand = vec4f(mc.u_strandDiffuse, mc.u_anisotropy, 0.0, 0.0);
    ext.scatter = vec4f(base.rgb * mc.u_secondaryTint.rgb * 1.6, 0.35);
    ext.trans = vec4f(mc.u_translucency, 0.25, 0.0, 0.0);
    let viewDir = viewDirection(P);
    g_hairShadow = mc.u_hairShadow;
    let lit = applyLightingSurface(base.rgb, N, P, viewDir, 0.0, mc.u_roughness, mix(mc.u_specular, 1.0, principled), ao, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), mc.u_roughness, 0.75);
    frag.albedo = vec4f(base.rgb, 1.0);
    return frag;
#else
    return vec4f(lit, alpha);
#endif
}
#pragma end
`;

// Skin: scattering without blurring the picture. Diffuse light comes from a softer normal than the surface's own (softest for red), the
// terminator is warmed, thin curved places let light through, and the shine is two lobes and a fuzz. Base colour is the mesh's texture.
const SKIN = `#pragma shader "Skin"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)
#pragma param u_ormMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
// A second, fine normal map tiled over the surface (pores, creases) laid on the sharp normal the shine reads: how strongly, and how many times it repeats.
// The soft diffuse normals do not carry it, as they do not carry the baked pores either. Import it with sRGB off and wrap repeat; 0 leaves it out.
#pragma param u_detailMap texture default(flatnormal) texel(data)
#pragma param u_detailStrength float default(0) range(0,2) ui(slider)
#pragma param u_detailTile float default(16) range(1,128) ui(slider)
// How rough the surface is (a scale on the map's own roughness), how much it shines, and the second, tighter lobe.
#pragma param u_roughness float default(1) range(0,2) ui(slider)
#pragma param u_specular float default(1) range(0,2) ui(slider)
#pragma param u_lobe2 float default(0.18) range(0,1) ui(slider)
#pragma param u_lobe2Roughness float default(0.4) range(0.05,1) ui(slider)
// How much softer than the surface's own normal the diffuse light's normal is: for red, then for green and blue (mip levels of the normal map).
#pragma param u_blurRed float default(3.2) range(0,8) ui(slider)
#pragma param u_blurGreen float default(1.6) range(0,8) ui(slider)
// The colour the terminator takes and how far light wraps past it.
#pragma param u_sssColor color default(0.95,0.4,0.3,1)
#pragma param u_sssWrap float default(0.45) range(0,1) ui(slider)
// Light through thin places: how much, and how much of a surface's curvature counts as thin.
#pragma param u_translucency float default(0.5) range(0,1) ui(slider)
#pragma param u_thinness float default(0.5) range(0,1) ui(slider)
// Pre-integrated scattering: the wrap past the terminator is taken per colour (red furthest) and widens where the surface turns sharply, which
// is what makes a nose or an ear glow at its edge while a flat cheek stays crisp. u_curvature is how fast a turn counts as sharp, per world unit.
#pragma param u_preIntegrate float default(0) range(0,1) ui(slider)
#pragma param u_curvature float default(8) range(0,64) ui(slider)
// The fine fuzz that lights a rim.
#pragma param u_fuzz float default(0.1) range(0,1) ui(slider)
// Marks the surface for the Subsurface Scattering effect, which spreads what is left of the light on a larger scale. Off by default.
#pragma param u_subsurface float default(0) range(0,1) ui(slider)

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
uniform sampler2D u_textures[1];

#ifdef ES_GBUFFER
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

vec3 skinNormalAt(float bias) {
    return normalize(texture(u_normalMap, v_texCoord, bias).xyz * 2.0 - 1.0);
}

// The baked normal with the detail's slope added to it, in the tangent frame both are read in.
vec3 skinDetail(vec3 baked, vec2 detail) {
    return normalize(vec3(baked.xy + detail * u_detailStrength, baked.z));
}

void main() {
    // Taken before any branch: a derivative needs every fragment of its quad.
    vec2 detail = texture(u_detailMap, v_texCoord * u_detailTile).xy * 2.0 - 1.0;
#ifdef MESH_NORMALS
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 P = v_worldXYZ;
    if (!gl_FrontFacing) Ng = -Ng;
    highp vec3 N = perturbNormal(Ng, P, v_texCoord, skinDetail(skinNormalAt(0.0), detail));
    highp vec3 Nmid = perturbNormal(Ng, P, v_texCoord, skinNormalAt(u_blurGreen));
    highp vec3 Nsoft = perturbNormal(Ng, P, v_texCoord, skinNormalAt(u_blurRed));
    // How fast the surface turns across a pixel, against how big a pixel is: the thin, strongly curved places.
    float turn = (length(dFdx(Ng)) + length(dFdy(Ng))) / max(length(dFdx(P)) + length(dFdy(P)), 1e-5);
    float thick = 1.0 - clamp(turn * 12.0 * u_thinness, 0.0, 1.0);
    float curv = clamp(turn * u_curvature, 0.0, 1.0);
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 N = vec3(0.0, 0.0, 1.0);
    highp vec3 Nmid = N;
    highp vec3 Nsoft = N;
    float thick = 1.0;
    float curv = 0.0;
#endif
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    vec4 orm = texture(u_ormMap, v_texCoord);
    float ao = mix(1.0, orm.r, u_occlusionStrength);
    float rough = clamp(orm.g * u_roughness, 0.05, 1.0);
    vec3 viewDir = viewDirection(P);

    // The diffuse light, from two softnesses of normal, with the terminator warmed and light let through a thin place.
    SurfaceExt wrapped = surfaceExtNone(Nsoft);
    wrapped.scatter = vec4(u_sssColor.rgb * base.rgb * 1.4, u_sssWrap);
    wrapped.trans = vec4(u_translucency, thick, curv, u_preIntegrate);
    vec3 soft = applyLightingSurface(base.rgb, Nsoft, P, viewDir, 0.0, 1.0, 0.0, ao, wrapped);
    SurfaceExt wrappedMid = surfaceExtNone(Nmid);
    wrappedMid.scatter = wrapped.scatter;
    wrappedMid.trans = wrapped.trans;
    vec3 mid = applyLightingSurface(base.rgb, Nmid, P, viewDir, 0.0, 1.0, 0.0, ao, wrappedMid);
    vec3 diffuse = vec3(soft.r, mid.g, mid.b);

    // The shine: two lobes and a fuzz, on the surface's own normal, with no diffuse under it.
    SurfaceExt shine = surfaceExtNone(N);
    shine.coat = vec4(u_lobe2, u_lobe2Roughness, 0.0, 0.0);
    shine.coatN = vec4(N, 0.0);
    shine.sheen = vec4(vec3(u_fuzz), 0.5);
    vec3 spec = applyLightingSurface(vec3(0.0), N, P, viewDir, 0.0, rough, u_specular, ao, shine);

    float alpha = u_subsurface > 0.0 ? 0.996 : 1.0;
    fragColor = vec4(diffuse + spec, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), rough, 0.75);
    fragAlbedo = vec4(base.rgb, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
    @location(2) albedo : vec4f,
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
    // Every sample is taken here, before any branch.
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_TANGENTS
    g_worldTangent = v.v_worldTangent;
#endif
    let base = textureSample(t0, s0, v.v_texCoord) * v.v_color * mc.u_tint;
    let orm = textureSample(u_ormMap, u_ormMap_s, v.v_texCoord);
    let detail = textureSample(u_detailMap, u_detailMap_s, v.v_texCoord * mc.u_detailTile).xy * 2.0 - vec2f(1.0);
    let bakedSharp = normalize(textureSampleBias(u_normalMap, u_normalMap_s, v.v_texCoord, 0.0).xyz * 2.0 - vec3f(1.0));
    let tangentSharp = normalize(vec3f(bakedSharp.xy + detail * mc.u_detailStrength, bakedSharp.z));
    let tangentMid = normalize(textureSampleBias(u_normalMap, u_normalMap_s, v.v_texCoord, mc.u_blurGreen).xyz * 2.0 - vec3f(1.0));
    let tangentSoft = normalize(textureSampleBias(u_normalMap, u_normalMap_s, v.v_texCoord, mc.u_blurRed).xyz * 2.0 - vec3f(1.0));
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    let P = v.v_worldXYZ;
    if (!front) { Ng = -Ng; }
    let N = perturbNormal(Ng, P, v.v_texCoord, tangentSharp);
    let Nmid = perturbNormal(Ng, P, v.v_texCoord, tangentMid);
    let Nsoft = perturbNormal(Ng, P, v.v_texCoord, tangentSoft);
    let turn = (length(dpdx(Ng)) + length(dpdy(Ng))) / max(length(dpdx(P)) + length(dpdy(P)), 1e-5);
    let thick = 1.0 - clamp(turn * 12.0 * mc.u_thinness, 0.0, 1.0);
    let curv = clamp(turn * mc.u_curvature, 0.0, 1.0);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 0.0, 1.0);
    let Nmid = N;
    let Nsoft = N;
    let thick = 1.0;
    let curv = 0.0;
#endif
    let ao = mix(1.0, orm.r, mc.u_occlusionStrength);
    let rough = clamp(orm.g * mc.u_roughness, 0.05, 1.0);
    let viewDir = viewDirection(P);

    var wrapped = surfaceExtNone(Nsoft);
    wrapped.scatter = vec4f(mc.u_sssColor.rgb * base.rgb * 1.4, mc.u_sssWrap);
    wrapped.trans = vec4f(mc.u_translucency, thick, curv, mc.u_preIntegrate);
    let soft = applyLightingSurface(base.rgb, Nsoft, P, viewDir, 0.0, 1.0, 0.0, ao, wrapped);
    var wrappedMid = surfaceExtNone(Nmid);
    wrappedMid.scatter = wrapped.scatter;
    wrappedMid.trans = wrapped.trans;
    let mid = applyLightingSurface(base.rgb, Nmid, P, viewDir, 0.0, 1.0, 0.0, ao, wrappedMid);
    let diffuse = vec3f(soft.r, mid.g, mid.b);

    var shine = surfaceExtNone(N);
    shine.coat = vec4f(mc.u_lobe2, mc.u_lobe2Roughness, 0.0, 0.0);
    shine.coatN = vec4f(N, 0.0);
    shine.sheen = vec4f(vec3f(mc.u_fuzz), 0.5);
    let spec = applyLightingSurface(vec3f(0.0), N, P, viewDir, 0.0, rough, mc.u_specular, ao, shine);

    var alpha = 1.0;
    if (mc.u_subsurface > 0.0) { alpha = 0.996; }
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(diffuse + spec, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), rough, 0.75);
    frag.albedo = vec4f(base.rgb, 1.0);
    return frag;
#else
    return vec4f(diffuse + spec, alpha);
#endif
}
#pragma end
`;

const EYE = `#pragma shader "Eye"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
// The iris is built from two maps and the numbers below: a mask that is white over the iris and the dome of the cornea
// (u_depthMap), and that dome's normals (u_irisNormalMap). A painted eye texture on the mesh multiplies the result.
#pragma param u_depthMap texture default(black) texel(data)
#pragma param u_irisNormalMap texture default(flatnormal) texel(data)
#pragma param u_scleraColor color default(0.92,0.9,0.87,1)
// The iris from the pupil's edge out to the limbus, and how dark its rim is.
#pragma param u_irisColor color default(0.22,0.4,0.52,1)
#pragma param u_irisColor2 color default(0.08,0.17,0.22,1)
#pragma param u_irisSize float default(0.42) range(0.1,0.6) ui(slider)
#pragma param u_pupilSize float default(0.3) range(0,0.8) ui(slider)
#pragma param u_limbal float default(0.7) range(0,1) ui(slider)
// How far behind the cornea the iris lies (in uv), and the cornea's index of refraction, which bend what is seen of it.
#pragma param u_irisDepth float default(0.06) range(0,0.2) ui(slider)
#pragma param u_ior float default(1.336) range(1,1.6) ui(slider)
// The wet cornea is nearly a mirror; the white of the eye is a duller sheen with light that wraps past the terminator.
#pragma param u_corneaRoughness float default(0.04) range(0.01,0.3) ui(slider)
#pragma param u_scleraRoughness float default(0.45) range(0.1,1) ui(slider)
#pragma param u_specular float default(1) range(0,2) ui(slider)
#pragma param u_scleraWrap float default(0.35) range(0,1) ui(slider)
// The lids shade the eye they sit on. u_lidMap is an authored occlusion map (white where the eye is open); u_lidShadow also darkens, and fades the
// cornea's reflections, where the surface faces up from u_lidStart (a dot with the world's up) to straight up: the upper lid, for an upright head.
#pragma param u_lidMap texture default(white) texel(data)
#pragma param u_lidShadow float default(0.5) range(0,1) ui(slider)
#pragma param u_lidStart float default(0.2) range(-1,1) ui(slider)

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
uniform sampler2D u_textures[1];

#ifdef ES_GBUFFER
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

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
    vec2 uv = v_texCoord;
    // Every sample that takes part in a derivative is taken here, before any branch.
    float h = texture(u_depthMap, uv).r;
    float lid = texture(u_lidMap, uv).r;
    vec3 dome = normalize(texture(u_irisNormalMap, uv).xyz * 2.0 - 1.0);
#ifdef MESH_NORMALS
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 P = v_worldXYZ;
    if (!gl_FrontFacing) Ng = -Ng;
    highp vec3 T = perturbNormal(Ng, P, uv, vec3(1.0, 0.0, 0.0));
    highp vec3 B = perturbNormal(Ng, P, uv, vec3(0.0, 1.0, 0.0));
    highp vec3 Ndome = perturbNormal(Ng, P, uv, dome);
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 Ng = vec3(0.0, 0.0, 1.0);
    highp vec3 T = vec3(1.0, 0.0, 0.0);
    highp vec3 B = vec3(0.0, 1.0, 0.0);
    highp vec3 Ndome = Ng;
#endif
    vec3 viewDir = viewDirection(P);
    // The ray from the eye, in the surface's own frame, bent into the cornea and carried down to the iris: that is where on
    // the iris this pixel looks, which moves as the eye turns.
    vec3 vt = normalize(vec3(dot(viewDir, T), dot(viewDir, B), max(dot(viewDir, Ng), 0.05)));
    vec3 R = refract(-vt, dome, 1.0 / u_ior);
    vec2 uvI = uv + R.xy * (u_irisDepth * h / max(-R.z, 0.2));
    float m = texture(u_depthMap, uvI).r;
    float irisMask = smoothstep(0.15, 0.85, m);
    float surfaceMask = smoothstep(0.15, 0.85, h);

    vec2 c = uvI - vec2(0.5);
    float rr = length(c) / max(u_irisSize, 1e-3);
    float ang = atan(c.y, c.x);
    float fibers = 0.82 + 0.18 * sin(ang * 70.0 + sin(ang * 13.0 + rr * 9.0) * 2.0);
    vec3 iris = mix(u_irisColor.rgb, u_irisColor2.rgb, smoothstep(0.2, 0.95, rr)) * fibers;
    iris *= 1.0 - u_limbal * smoothstep(0.78, 1.0, rr);
    iris *= smoothstep(u_pupilSize - 0.05, u_pupilSize + 0.03, rr);
    vec4 painted = texture(u_textures[0], uv) * v_color * u_tint;
    vec3 albedo = mix(u_scleraColor.rgb, iris, irisMask) * painted.rgb;

    float ao = 1.0;
    float lidShade = lid * (1.0 - u_lidShadow * smoothstep(u_lidStart, 1.0, Ng.y));
    vec3 Nd = normalize(mix(Ng, Ndome, 0.5 * surfaceMask));
    SurfaceExt body = surfaceExtNone(Nd);
    body.scatter = vec4(vec3(0.9, 0.5, 0.4) * albedo, u_scleraWrap * (1.0 - surfaceMask));
    vec3 diffuse = applyLightingSurface(albedo, Nd, P, viewDir, 0.0, 1.0, 0.0, ao, body);

    // The cornea: a clear dome, so its normal is the dome's, and it shows every light and the sky as a small bright shape.
    vec3 Nc = normalize(mix(Ng, Ndome, surfaceMask));
    SurfaceExt shine = surfaceExtNone(Nc);
    shine.coat = vec4(0.25 * (1.0 - surfaceMask), u_scleraRoughness, 0.0, 0.0);
    shine.coatN = vec4(Ng, 0.0);
    vec3 spec = applyLightingSurface(vec3(0.0), Nc, P, viewDir, 0.0, u_corneaRoughness, u_specular, ao, shine);

    fragColor = vec4((diffuse + spec) * lidShade, 1.0);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(Nc)), u_corneaRoughness, 0.75);
    fragAlbedo = vec4(albedo, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
    @location(2) albedo : vec4f,
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
    g_worldTangent = v.v_worldTangent;
#endif
    let uv = v.v_texCoord;
    // Every sample is taken here, before any branch.
    let h = textureSample(u_depthMap, u_depthMap_s, uv).r;
    let lid = textureSample(u_lidMap, u_lidMap_s, uv).r;
    let dome = normalize(textureSample(u_irisNormalMap, u_irisNormalMap_s, uv).xyz * 2.0 - vec3f(1.0));
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    let P = v.v_worldXYZ;
    if (!front) { Ng = -Ng; }
    let T = perturbNormal(Ng, P, uv, vec3f(1.0, 0.0, 0.0));
    let B = perturbNormal(Ng, P, uv, vec3f(0.0, 1.0, 0.0));
    let Ndome = perturbNormal(Ng, P, uv, dome);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let Ng = vec3f(0.0, 0.0, 1.0);
    let T = vec3f(1.0, 0.0, 0.0);
    let B = vec3f(0.0, 1.0, 0.0);
    let Ndome = Ng;
#endif
    let viewDir = viewDirection(P);
    let vt = normalize(vec3f(dot(viewDir, T), dot(viewDir, B), max(dot(viewDir, Ng), 0.05)));
    let R = refract(-vt, dome, 1.0 / mc.u_ior);
    let uvI = uv + R.xy * (mc.u_irisDepth * h / max(-R.z, 0.2));
    let m = textureSample(u_depthMap, u_depthMap_s, uvI).r;
    let irisMask = smoothstep(0.15, 0.85, m);
    let surfaceMask = smoothstep(0.15, 0.85, h);

    let c = uvI - vec2f(0.5);
    let rr = length(c) / max(mc.u_irisSize, 1e-3);
    let ang = atan2(c.y, c.x);
    let fibers = 0.82 + 0.18 * sin(ang * 70.0 + sin(ang * 13.0 + rr * 9.0) * 2.0);
    var iris = mix(mc.u_irisColor.rgb, mc.u_irisColor2.rgb, smoothstep(0.2, 0.95, rr)) * fibers;
    iris = iris * (1.0 - mc.u_limbal * smoothstep(0.78, 1.0, rr));
    iris = iris * smoothstep(mc.u_pupilSize - 0.05, mc.u_pupilSize + 0.03, rr);
    let painted = textureSample(t0, s0, uv) * v.v_color * mc.u_tint;
    let albedo = mix(mc.u_scleraColor.rgb, iris, irisMask) * painted.rgb;

    let ao = 1.0;
    let lidShade = lid * (1.0 - mc.u_lidShadow * smoothstep(mc.u_lidStart, 1.0, Ng.y));
    let Nd = normalize(mix(Ng, Ndome, 0.5 * surfaceMask));
    var body = surfaceExtNone(Nd);
    body.scatter = vec4f(vec3f(0.9, 0.5, 0.4) * albedo, mc.u_scleraWrap * (1.0 - surfaceMask));
    let diffuse = applyLightingSurface(albedo, Nd, P, viewDir, 0.0, 1.0, 0.0, ao, body);

    let Nc = normalize(mix(Ng, Ndome, surfaceMask));
    var shine = surfaceExtNone(Nc);
    shine.coat = vec4f(0.25 * (1.0 - surfaceMask), mc.u_scleraRoughness, 0.0, 0.0);
    shine.coatN = vec4f(Ng, 0.0);
    let spec = applyLightingSurface(vec3f(0.0), Nc, P, viewDir, 0.0, mc.u_corneaRoughness, mc.u_specular, ao, shine);

#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f((diffuse + spec) * lidShade, 1.0);
    frag.surface = vec4f(packNormal(normalize(Nc)), mc.u_corneaRoughness, 0.75);
    frag.albedo = vec4f(albedo, 1.0);
    return frag;
#else
    return vec4f((diffuse + spec) * lidShade, 1.0);
#endif
}
#pragma end
`;

export const CHARACTER_SHADER_TEMPLATES = [
    makeBuiltinShaderTemplate('hair', 'Hair',
        'Strand lighting: Kajiya-Kay diffuse, two shifted highlights along a flow map, and light through the strands.', HAIR),
    makeBuiltinShaderTemplate('skin', 'Skin',
        'Soft diffuse by colour, a warm terminator, light through thin places, two shine lobes and a fuzz — without blurring the picture.', SKIN),
    makeBuiltinShaderTemplate('eye', 'Eye',
        'A wet cornea over an iris that moves as the eye turns: refracted depth, a pupil, a dark limbal ring, and catchlights of every light.', EYE),
];
