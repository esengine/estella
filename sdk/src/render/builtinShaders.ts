// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtinShaders.ts
 * @brief   Built-in .esshader templates — the engine's stock material starting points.
 * @details Each template carries a `#pragma fragment wgsl` twin so it compiles
 *          on the WebGPU backend. Twins run under the canonical fragment-only
 *          contract: `fs_main(v : VSOut)` with v.v_color / v.v_texCoord
 *          (+ v.v_worldPos on Lit), the batch textures as t0..t7 / s0..s7,
 *          params as mc.<name>, texture params as <name> + <name>_s, and the
 *          frame clock as tc.u_time / tc.u_viewport.
 */

import { paramDefaultValue, reflectEsshader } from './shaderReflect';

export interface BuiltinShaderTemplate {
    id: string;
    /** Menu / picker label, e.g. "Lit". */
    label: string;
    description: string;
    source: string;
    /** Initial .esmaterial `properties` for a material born from this template — DERIVED
     *  from `source`, never written down beside it (see {@link templateDefaults}). */
    defaults: Record<string, unknown>;
}

/**
 * The `properties` a new material of this template starts with: every declared non-texture
 * param at its shader default.
 *
 * Derived rather than listed, because a hand-kept copy is a second place to remember. Five
 * of the seven templates carried `defaults: {}` — their parameter vocabulary existed only
 * inside the shader string, so a material made from Dissolve came out with no `u_progress`
 * in it, and nothing anywhere named that word to whoever went looking for the slider.
 *
 * A texture param is skipped: its default is a name the engine resolves (`white`,
 * `flatnormal`), and storing that as a property would make it look like an asset ref.
 */
function templateDefaults(source: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const param of reflectEsshader(source).params) {
        if (param.type === 'texture') continue;
        out[param.name] = paramDefaultValue(param);
    }
    return out;
}

export const makeBuiltinShaderTemplate = (id: string, label: string, description: string, source: string): BuiltinShaderTemplate =>
    ({ id, label, description, source, defaults: templateDefaults(source) });
const template = makeBuiltinShaderTemplate;

const SPRITE_UNLIT = `#pragma shader "Sprite Unlit"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_tint color default(1,1,1,1)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    fragColor = texture(u_textures[0], v_texCoord) * v_color * u_tint;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    return textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
}
#pragma end
`;

const SPRITE_LIT = `#pragma shader "Sprite Lit"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Unset u_normalMap = flat normal, so lighting works with no normal map assigned.
// Geometry that CARRIES normals is lit by them, and the map then perturbs that
// frame instead of replacing it with the flat one a sprite has.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
#ifdef MESH_NORMALS
    highp vec3 N = perturbNormal(normalize(v_worldNormal), v_worldXYZ, v_texCoord,
                                 sampleNormal(u_normalMap, v_texCoord));
    // A double-sided surface is lit from the side it is seen from (glTF's rule).
    if (!gl_FrontFacing) N = -N;
#else
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
#endif
    fragColor = vec4(applyLighting2D(base.rgb, N, v_worldPos), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
#ifdef MESH_NORMALS
    var N = perturbNormal(normalize(v.v_worldNormal), v.v_worldXYZ, v.v_texCoord,
                          sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy));
    if (!front) { N = -N; }
#else
    let N = sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy);
#endif
    return vec4f(applyLighting2D(base.rgb, N, v.v_worldPos), base.a);
}
#pragma end
`;

// Grass, reeds, hanging cloth: the sprite's top leans and returns, its foot stays. A sprite shader is a fragment shader, so the lean is a shift of where
// the texture is read, growing from nothing at the bottom edge to u_swayStrength (a share of the sprite's width) at the top; the sprite's picture should
// leave a margin at the sides for it to lean into. u_swayWind is the weather's wind, written by the engine each frame (1 with none).
const SPRITE_SWAY = `#pragma shader "Sway"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)
#pragma param u_swayStrength float default(0.12) range(0,0.5) ui(slider)
#pragma param u_swaySpeed float default(1.6) range(0,8) ui(slider)
#pragma param u_swayScale float default(260) range(20,2000)
#pragma param u_swayWind float default(1) range(0,4)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    // The gust travels across the world, so neighbouring plants lean in turn and not together.
    highp float t = u_time.x * u_swaySpeed;
    highp float phase = (v_worldPos.x + v_worldPos.y * 0.5) / u_swayScale;
    float gust = sin(t + phase) + 0.5 * sin(t * 2.3 + phase * 1.7);
    float tip = pow(clamp(v_texCoord.y, 0.0, 1.0), 1.5);
    vec2 uv = vec2(v_texCoord.x - gust * u_swayStrength * u_swayWind * tip, v_texCoord.y);
    vec4 base = texture(u_textures[0], uv) * v_color * u_tint;
    if (uv.x < 0.0 || uv.x > 1.0) base.a = 0.0;
    vec3 N = sampleNormal(u_normalMap, uv);
    fragColor = vec4(applyLighting2D(base.rgb, N, v_worldPos), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let t = tc.u_time.x * mc.u_swaySpeed;
    let phase = (v.v_worldPos.x + v.v_worldPos.y * 0.5) / mc.u_swayScale;
    let gust = sin(t + phase) + 0.5 * sin(t * 2.3 + phase * 1.7);
    let tip = pow(clamp(v.v_texCoord.y, 0.0, 1.0), 1.5);
    let uv = vec2f(v.v_texCoord.x - gust * mc.u_swayStrength * mc.u_swayWind * tip, v.v_texCoord.y);
    var base = textureSampleGrad(t0, s0, uv, duvx, duvy) * v.v_color * mc.u_tint;
    if (uv.x < 0.0 || uv.x > 1.0) { base.a = 0.0; }
    let N = sampleNormalGrad(u_normalMap, u_normalMap_s, uv, duvx, duvy);
    return vec4f(applyLighting2D(base.rgb, N, v.v_worldPos), base.a);
}
#pragma end
`;

const SPRITE_HIT_FLASH = `#pragma shader "Hit Flash"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_flash float default(0) range(0,1) ui(slider)
#pragma param u_flashColor color default(1,1,1,1)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Drive u_flash 1 → 0 from code (tween) for the classic damage blink.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    fragColor = vec4(mix(base.rgb, u_flashColor.rgb, u_flash), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color;
    return vec4f(mix(base.rgb, mc.u_flashColor.rgb, mc.u_flash), base.a);
}
#pragma end
`;

const SPRITE_OUTLINE = `#pragma shader "Outline"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_outlineColor color default(1,1,1,1)
#pragma param u_outlineWidth float default(1) range(0,8)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    highp vec2 texel = u_outlineWidth / vec2(textureSize(u_textures[0], 0));
    float edge = 0.0;
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x, 0.0)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x, 0.0)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(0.0,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(0.0, -texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x, -texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x, -texel.y)).a);
    fragColor = mix(vec4(u_outlineColor.rgb, edge * u_outlineColor.a), base, base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color;
    let texel = mc.u_outlineWidth / vec2f(textureDimensions(t0, 0));
    var edge = 0.0;
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f( texel.x, 0.0), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(-texel.x, 0.0), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(0.0,  texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(0.0, -texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f( texel.x,  texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f( texel.x, -texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(-texel.x,  texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(-texel.x, -texel.y), duvx, duvy).a);
    return mix(vec4f(mc.u_outlineColor.rgb, edge * mc.u_outlineColor.a), base, base.a);
}
#pragma end
`;

const SPRITE_DISSOLVE = `#pragma shader "Dissolve"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_progress float default(0) range(0,1) ui(slider)
#pragma param u_edgeColor color default(1,0.5,0,1)
#pragma param u_edgeWidth float default(0.08) range(0,0.5)
#pragma param u_noiseScale float default(12) range(1,64)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

float hash2d(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2(0.0, 1.0)), hash2d(i + vec2(1.0, 1.0)), f.x), f.y);
}

// u_progress 0 = intact, 1 = fully dissolved; a glowing edge leads the cut.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    float n = noise2d(v_texCoord * u_noiseScale);
    float cut = u_progress * (1.0 + u_edgeWidth);
    if (n < cut - u_edgeWidth) discard;
    vec3 rgb = (n < cut) ? u_edgeColor.rgb : base.rgb;
    fragColor = vec4(rgb, base.a);
}
#pragma end

#pragma fragment wgsl
fn hash2d(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn noise2d(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2f(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2f(0.0, 1.0)), hash2d(i + vec2f(1.0, 1.0)), f.x), f.y);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color;
    let n = noise2d(v.v_texCoord * mc.u_noiseScale);
    let cut = mc.u_progress * (1.0 + mc.u_edgeWidth);
    if (n < cut - mc.u_edgeWidth) { discard; }
    let rgb = select(base.rgb, mc.u_edgeColor.rgb, n < cut);
    return vec4f(rgb, base.a);
}
#pragma end
`;

const SPRITE_PIXELATE = `#pragma shader "Pixelate"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_pixels float default(32) range(2,256)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec2 uv = (floor(v_texCoord * u_pixels) + 0.5) / u_pixels;
    fragColor = texture(u_textures[0], uv) * v_color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = (floor(v.v_texCoord * mc.u_pixels) + 0.5) / mc.u_pixels;
    return textureSampleLevel(t0, s0, uv, 0.0) * v.v_color;
}
#pragma end
`;

const SPRITE_UV_SCROLL = `#pragma shader "UV Scroll"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_scrollSpeed vec2 default(0.1,0)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// u_time.x is the engine frame clock (seconds), injected into every shader.
void main() {
    vec2 uv = fract(v_texCoord + u_time.x * u_scrollSpeed);
    fragColor = texture(u_textures[0], uv) * v_color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let uv = fract(v.v_texCoord + tc.u_time.x * mc.u_scrollSpeed);
    return textureSampleGrad(t0, s0, uv, duvx, duvy) * v.v_color;
}
#pragma end
`;

// The shading a glTF material says beyond its base colour. Those channels are
// per-material constants and per-material samplers, which is what a material has
// and a component does not — a MeshRenderer's per-object attributes are full.
const MODEL = `#pragma shader "Model"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)
#pragma param u_emissive color default(0,0,0,1)
#pragma param u_emissiveMap texture default(white)
#pragma param u_occlusionMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
#pragma param u_alphaCutoff float default(0) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff
#pragma param u_metallic float default(0) range(0,1) ui(slider)
#pragma param u_roughness float default(1) range(0,1) ui(slider)
#pragma param u_metallicRoughnessMap texture default(white) texel(data)
// What a surface has beyond a metal/rough pair. Every one is zero (or glTF's own default) for a surface that has none of it,
// and the lighting skips a layer whose strength is zero, so a plain material pays nothing for these.
#pragma param u_ior float default(1.5) range(1,3) ui(slider)
#pragma param u_specular float default(1) range(0,1) ui(slider)
#pragma param u_clearcoat float default(0) range(0,1) ui(slider)
#pragma param u_clearcoatRoughness float default(0.03) range(0,1) ui(slider)
#pragma param u_sheenColor color default(0,0,0,1)
#pragma param u_sheenRoughness float default(0.5) range(0,1) ui(slider)
#pragma param u_anisotropy float default(0) range(-1,1) ui(slider)
#pragma param u_anisotropyRotation float default(0) range(-3.1416,3.1416) ui(slider)
#pragma param u_translucency float default(0) range(0,1) ui(slider)
#pragma param u_translucencyColor color default(1,1,1,1)
#pragma param u_thickness float default(0) range(0,1) ui(slider)
#pragma param u_transmission float default(0) range(0,1) ui(slider)
#pragma param u_attenuationColor color default(1,1,1,1)
// Marks this surface as one light scatters through (skin, wax, a leaf): its pixels are drawn with alpha 0.996, which the
// Subsurface Scattering effect reads and blurs along the surface. Does nothing without that effect; the effect gives alpha back.
#pragma param u_subsurface float default(0) range(0,1) ui(slider)
// The picture of the opaque scene as it stood behind this surface, which the frame takes a copy of before it draws a material
// that holds a transmission above zero (and only then: a draw that reads it is made after the copy). The white it falls back
// to has alpha 1, and a real copy has 0.5 — which is how this tells whether it has one.
#pragma param u_sceneColor texture default(white)
#pragma param u_refractionStrength float default(1) range(0,4) ui(slider)
#pragma param u_iridescence float default(0) range(0,1) ui(slider)
#pragma param u_iridescenceIor float default(1.3) range(1,2.5) ui(slider)
#pragma param u_iridescenceThickness float default(400) range(0,1200) ui(slider)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

// One, not the batch stream's eight: a sampler array counts whole against the
// sixteen units a stage may use, and this stage also takes four maps, four the
// engine injects and a bake.
uniform sampler2D u_textures[1];

#ifdef ES_GBUFFER
// The frame draws a second attachment beside the colour: what this surface IS, for the post effects
// that need to know (reflections: how rough, how metal, which way it faces). Only a pass that has the
// attachment asks for this variant.
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;

// Octahedral normal: a unit vector in two channels, which is what an 8-bit target can hold.
vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

// Geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019, as Filament spells it).
// Where the vertex normal turns quickly across a pixel — a bevel, a curved rail, a
// bolt-head — the highlight is the sum of many normals the pixel cannot resolve, and
// shading it with ONE normal makes it sparkle from frame to frame. The turn rate is the
// screen-space derivative of the normal; it widens the lobe by that variance, so the
// sparkle becomes a steady, slightly rougher highlight. Taken from the vertex normal, not
// the perturbed one: a normal map's detail is the texture filter's to average.
float specularAA(highp vec3 dndx, highp vec3 dndy, float roughness) {
    float variance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
    float kernel = min(2.0 * variance, 0.18);
    float alpha = roughness * roughness;
    return sqrt(sqrt(clamp(alpha * alpha + kernel, 0.0, 1.0)));
}

// Base colour rides the draw itself (slot 0 x vertex colour) — glTF's baseColor
// is what a MeshRenderer already carries. Emission is added AFTER lighting (it is light
// this surface makes) and occlusion scales only the ambient term.
// Metal-roughness packing is glTF's: roughness in green, metal in blue.
void main() {
#ifdef MESH_NORMALS
    // Before any branch: a derivative needs every fragment of its quad.
    highp vec3 dndx = dFdx(v_worldNormal);
    highp vec3 dndy = dFdy(v_worldNormal);
#endif
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    // A cutout is glTF's MASK (cutoutCoverage): cut at the cutoff, sharpened to a pixel so alpha-to-coverage feathers the edge.
    float alpha = base.a;
    if (u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, u_alphaCutoff, fwidth(base.a));
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 N = perturbNormal(Ng, v_worldXYZ, v_texCoord,
                                 sampleNormal(u_normalMap, v_texCoord));
    // A double-sided surface is lit from the side it is seen from (glTF's rule).
    if (!gl_FrontFacing) { N = -N; Ng = -Ng; }
#else
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
#endif
    float ao = mix(1.0, texture(u_occlusionMap, v_texCoord).r, u_occlusionStrength);
    vec3 mr = texture(u_metallicRoughnessMap, v_texCoord).rgb;
#ifdef MESH_NORMALS
    // The surface's OWN place, which a point light, a probe volume and a
    // reflection's box projection all measure against; z = 0 is a plane's answer.
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
#endif
    // specular 1: a glTF material reflects unless KHR_materials_specular says less.
    float roughness = u_roughness * mr.g;
#ifdef MESH_NORMALS
    roughness = specularAA(dndx, dndy, roughness);
#endif
    SurfaceExt ext = surfaceExtNone(N);
    if (u_ior != 1.5) {
        float r = (u_ior - 1.0) / (u_ior + 1.0);
        ext.misc.x = r * r;
    }
#ifdef MESH_NORMALS
    // The coat's normal is the surface's own, not the bump map's: a coat is smooth over whatever it covers.
    if (u_clearcoat > 0.0) {
        ext.coat = vec4(u_clearcoat, max(u_clearcoatRoughness, 0.045), 0.0, 0.0);
        ext.coatN = vec4(Ng, 0.0);
    }
    if (u_anisotropy != 0.0) {
        // The direction the grooves run, from the UV frame turned by the rotation, then made to lie across N.
        highp vec3 T = perturbNormal(Ng, P, v_texCoord, vec3(cos(u_anisotropyRotation), sin(u_anisotropyRotation), 0.0));
        T -= N * dot(N, T);
        if (dot(T, T) < 1e-6) T = cross(N, abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
        ext.aniso = vec4(normalize(T), clamp(u_anisotropy, -0.99, 0.99));
    }
#endif
    if (dot(u_sheenColor.rgb, vec3(1.0)) > 0.0) ext.sheen = vec4(u_sheenColor.rgb, max(u_sheenRoughness, 0.07));
    if (u_translucency > 0.0) {
        ext.scatter = vec4(u_translucencyColor.rgb * base.rgb, u_translucency * 0.5);
        ext.trans = vec4(u_translucency, u_thickness, 0.0, 0.0);
    }
    if (u_iridescence > 0.0) ext.film = vec4(u_iridescence, max(u_iridescenceIor, 1.0), u_iridescenceThickness, 0.0);
    vec3 viewDir = viewDirection(P);
    // Light that passes through: what stands behind the surface, bent by the glass and tinted by it, and less of it where the
    // surface reflects instead. The frame took a copy of the opaque scene for this draw; the ray is refracted through the
    // surface's thickness, and the copy is read where it lands, blurred by the roughness.
    vec3 seen = vec3(0.0);
    float refracted = 0.0;
    if (u_transmission > 0.0) {
        float cosV = clamp(dot(N, viewDir), 0.0, 1.0);
        float fresnel = ext.misc.x + (1.0 - ext.misc.x) * pow(1.0 - cosV, 5.0);
        if (texture(u_sceneColor, vec2(0.5)).a < 0.75) {
            vec3 bent = refract(-viewDir, N, 1.0 / max(u_ior, 1.0));
            float depth = max(u_thickness, 0.15) * 60.0 * u_refractionStrength;
            vec4 landed = u_projection * vec4(P + bent * depth, 1.0);
            vec2 uv = landed.xy / max(landed.w, 1e-4) * 0.5 + 0.5;
            float spread = roughness * roughness * 0.04;
            vec3 behind = texture(u_sceneColor, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
            for (int i = 0; i < 8; ++i) {
                float a = float(i) * 2.39996;
                vec2 o = vec2(cos(a), sin(a)) * (spread * sqrt((float(i) + 0.5) / 8.0));
                behind += texture(u_sceneColor, clamp(uv + o, vec2(0.001), vec2(0.999))).rgb;
            }
            seen = behind / 9.0 * u_attenuationColor.rgb * (1.0 - fresnel) * u_transmission;
            refracted = 1.0;
        } else {
            // No picture to refract (the scene is not a texture here): the surface lets that much of the scene show instead,
            // by its own coverage, which dims what it reflects with it.
            alpha *= 1.0 - u_transmission * (1.0 - fresnel);
            base.rgb = mix(base.rgb, base.rgb * u_attenuationColor.rgb, u_transmission);
        }
    }
    vec3 lit = applyLightingSurface(base.rgb * (1.0 - u_transmission * refracted), N, P, viewDir,
                                    u_metallic * mr.b, roughness, u_specular, ao, ext);
    if (u_subsurface > 0.0 && u_alphaCutoff <= 0.0) alpha = min(alpha, 0.996);
    fragColor = vec4(lit + seen + u_emissive.rgb * texture(u_emissiveMap, v_texCoord).rgb, alpha);
#ifdef ES_GBUFFER
    // Alpha says something was drawn here (0 is "nothing wrote"), and carries the metalness above 0.75: a pixel that
    // multisampling averaged with an unwritten one falls below it, and an effect can tell such an edge from a surface.
    fragSurface = vec4(packNormal(normalize(N)), roughness, 0.75 + 0.25 * clamp(u_metallic * mr.b, 0.0, 1.0));
#endif
}
#pragma end

#pragma fragment wgsl
// The GLSL twin's geometric specular anti-aliasing, spelled the same.
fn specularAA(dndx : vec3f, dndy : vec3f, roughness : f32) -> f32 {
    let variance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
    let kernel = min(2.0 * variance, 0.18);
    let alpha = roughness * roughness;
    return sqrt(sqrt(clamp(alpha * alpha + kernel, 0.0, 1.0)));
}

#ifdef ES_GBUFFER
// What the frame's second attachment takes, beside the colour (see the GLSL twin).
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
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
#ifdef MESH_NORMALS
    let dndx = dpdx(v.v_worldNormal);
    let dndy = dpdy(v.v_worldNormal);
#endif
    // WGSL has no module varying: the entry point hands the injected header the
    // run its GLSL twin reads straight off one. Without this every material-shaded
    // draw read instance 0's indirect light — one probe volume for the lot.
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_TANGENTS
    g_worldTangent = v.v_worldTangent;
#endif
    var base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
    // Before any discard: a derivative needs every fragment of its quad.
    let edge = max(fwidth(base.a), 1e-4);
    var alpha = base.a;
    if (mc.u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, mc.u_alphaCutoff, edge);
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    var N = perturbNormal(Ng, v.v_worldXYZ, v.v_texCoord,
                          sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy));
    if (!front) { N = -N; Ng = -Ng; }
#else
    let N = sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy);
#endif
    let occl = textureSampleGrad(u_occlusionMap, u_occlusionMap_s, v.v_texCoord, duvx, duvy).r;
    let ao = mix(1.0, occl, mc.u_occlusionStrength);
    let mr = textureSampleGrad(u_metallicRoughnessMap, u_metallicRoughnessMap_s, v.v_texCoord, duvx, duvy).rgb;
#ifdef MESH_NORMALS
    let P = v.v_worldXYZ;
#else
    let P = vec3f(v.v_worldPos, 0.0);
#endif
    var roughness = mc.u_roughness * mr.g;
#ifdef MESH_NORMALS
    roughness = specularAA(dndx, dndy, roughness);
#endif
    var ext = surfaceExtNone(N);
    if (mc.u_ior != 1.5) {
        let r = (mc.u_ior - 1.0) / (mc.u_ior + 1.0);
        ext.misc.x = r * r;
    }
#ifdef MESH_NORMALS
    // See the GLSL twin: the coat's normal is the surface's own, not the bump map's.
    if (mc.u_clearcoat > 0.0) {
        ext.coat = vec4f(mc.u_clearcoat, max(mc.u_clearcoatRoughness, 0.045), 0.0, 0.0);
        ext.coatN = vec4f(Ng, 0.0);
    }
    if (mc.u_anisotropy != 0.0) {
        var T = perturbNormal(Ng, P, v.v_texCoord, vec3f(cos(mc.u_anisotropyRotation), sin(mc.u_anisotropyRotation), 0.0));
        T -= N * dot(N, T);
        if (dot(T, T) < 1e-6) {
            var seed = vec3f(1.0, 0.0, 0.0);
            if (abs(N.y) < 0.99) { seed = vec3f(0.0, 1.0, 0.0); }
            T = cross(N, seed);
        }
        ext.aniso = vec4f(normalize(T), clamp(mc.u_anisotropy, -0.99, 0.99));
    }
#endif
    if (dot(mc.u_sheenColor.rgb, vec3f(1.0)) > 0.0) { ext.sheen = vec4f(mc.u_sheenColor.rgb, max(mc.u_sheenRoughness, 0.07)); }
    if (mc.u_translucency > 0.0) {
        ext.scatter = vec4f(mc.u_translucencyColor.rgb * base.rgb, mc.u_translucency * 0.5);
        ext.trans = vec4f(mc.u_translucency, mc.u_thickness, 0.0, 0.0);
    }
    if (mc.u_iridescence > 0.0) { ext.film = vec4f(mc.u_iridescence, max(mc.u_iridescenceIor, 1.0), mc.u_iridescenceThickness, 0.0); }
    let viewDir = viewDirection(P);
    var seen = vec3f(0.0);
    var refracted = 0.0;
    if (mc.u_transmission > 0.0) {
        let cosV = clamp(dot(N, viewDir), 0.0, 1.0);
        let fresnel = ext.misc.x + (1.0 - ext.misc.x) * pow(1.0 - cosV, 5.0);
        if (textureSampleLevel(u_sceneColor, u_sceneColor_s, vec2f(0.5), 0.0).a < 0.75) {
            let bent = refract(-viewDir, N, 1.0 / max(mc.u_ior, 1.0));
            let depth = max(mc.u_thickness, 0.15) * 60.0 * mc.u_refractionStrength;
            let landed = frame.projection * vec4f(P + bent * depth, 1.0);
            let w = max(landed.w, 1e-4);
            // This device's rows run down the texture, so clip y is flipped on the way to a uv.
            let uv = vec2f(landed.x / w * 0.5 + 0.5, 0.5 - landed.y / w * 0.5);
            let spread = roughness * roughness * 0.04;
            var behind = textureSampleLevel(u_sceneColor, u_sceneColor_s, clamp(uv, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
            for (var i : i32 = 0; i < 8; i = i + 1) {
                let a = f32(i) * 2.39996;
                let o = vec2f(cos(a), sin(a)) * (spread * sqrt((f32(i) + 0.5) / 8.0));
                behind = behind + textureSampleLevel(u_sceneColor, u_sceneColor_s, clamp(uv + o, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
            }
            seen = behind / 9.0 * mc.u_attenuationColor.rgb * (1.0 - fresnel) * mc.u_transmission;
            refracted = 1.0;
        } else {
            alpha *= 1.0 - mc.u_transmission * (1.0 - fresnel);
            base = vec4f(mix(base.rgb, base.rgb * mc.u_attenuationColor.rgb, vec3f(mc.u_transmission)), base.a);
        }
    }
    let lit = applyLightingSurface(base.rgb * (1.0 - mc.u_transmission * refracted), N, P, viewDir,
                                   mc.u_metallic * mr.b, roughness, mc.u_specular, ao, ext);
    if (mc.u_subsurface > 0.0 && mc.u_alphaCutoff <= 0.0) { alpha = min(alpha, 0.996); }
    let emit = mc.u_emissive.rgb
             * textureSampleGrad(u_emissiveMap, u_emissiveMap_s, v.v_texCoord, duvx, duvy).rgb;
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit + seen + emit, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), roughness, 0.75 + 0.25 * clamp(mc.u_metallic * mr.b, 0.0, 1.0));
    return frag;
#else
    return vec4f(lit + seen + emit, alpha);
#endif
}
#pragma end
`;

const TOON = `#pragma shader "Toon"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
// The light a surface keeps where no lamp reaches it, as a colour of its own (times the base colour) whatever the lamps do: black leaves it dark.
#pragma param u_shadeColor color default(0.55,0.5,0.7,1)
// How many steps the light is cut into, and how soft the step between two is (0 is a hard edge).
#pragma param u_bands float default(3) range(1,8) ui(slider)
#pragma param u_bandSoftness float default(0.03) range(0,0.5) ui(slider)
// A highlight is drawn where a lamp's gloss is above this (1 draws none), as a flat shape of its own colour; u_specSize is how glossy the surface is.
#pragma param u_specThreshold float default(0.6) range(0,1) ui(slider)
#pragma param u_specSoftness float default(0.02) range(0,0.5) ui(slider)
#pragma param u_specColor color default(1,1,1,1)
#pragma param u_specSize float default(0.35) range(0,1) ui(slider)
// A band of light at the silhouette, on the side the light reaches.
#pragma param u_rimColor color default(1,1,1,1)
#pragma param u_rimWidth float default(0.35) range(0,1) ui(slider)
#pragma param u_rimSoftness float default(0.05) range(0,0.5) ui(slider)
#pragma param u_rimStrength float default(0) range(0,1) ui(slider)
#pragma param u_occlusionMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
#pragma param u_emissive color default(0,0,0,1)
#pragma param u_emissiveMap texture default(white)
#pragma param u_alphaCutoff float default(0) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff

#pragma fragment
precision mediump float;

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
vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

// A level in 0..1 cut into u_bands steps: each step is flat, and the step between two is a smoothstep as wide as u_bandSoftness.
float toonBand(float level) {
    float t = clamp(level, 0.0, 1.0) * u_bands;
    float i = floor(t);
    float f = t - i;
    float soft = max(u_bandSoftness, 1e-4);
    return min((i + smoothstep(0.5 - soft, 0.5 + soft, f)) / u_bands, 1.0);
}

void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    float alpha = base.a;
    if (u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, u_alphaCutoff, fwidth(base.a));
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    highp vec3 N = normalize(v_worldNormal);
    if (!gl_FrontFacing) N = -N;
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 N = vec3(0.0, 0.0, 1.0);
    highp vec3 P = vec3(v_worldPos, 0.0);
#endif
    float ao = mix(1.0, texture(u_occlusionMap, v_texCoord).r, u_occlusionStrength);
    vec3 V = viewDirection(P);
    float NdotV = max(dot(N, V), 1e-4);
    // A glossy dielectric for the lamps' highlight to be read from; how it looks is this material's own, not a metal-rough pair's.
    float roughness = mix(0.7, 0.1, clamp(u_specSize, 0.0, 1.0));
    float a = max(roughness * roughness, 1e-3);
    vec3 F0 = vec3(0.04);
    SurfaceExt ext = surfaceExtNone(N);
    // Each lamp is cut into steps by itself, and the shadow it casts is part of its step.
    vec3 lit = vec3(0.0);
    float glossLevel = 0.0;
    vec3 glossTint = vec3(0.0);
    for (int i = 0; i < 16; ++i) {
        vec3 l = vec3(0.0), g = vec3(0.0), x = vec3(0.0);
        shadeLight(u_lights[i].posDir, u_lights[i].color, u_lights[i].spot, u_lights[i].shadow,
                   u_lights[i].shadowMap, u_lights[i].falloff, N, V, P, a, F0, NdotV, 1.0, roughness, ext, l, g, x, true);
        float level = max(l.r, max(l.g, l.b));
        if (level > 1e-4) lit += l * (toonBand(level) / level);
        float gl = max(g.r, max(g.g, g.b));
        if (gl > glossLevel) { glossLevel = gl; glossTint = g / max(gl, 1e-4); }
    }
    float lightAmount = clamp(max(lit.r, max(lit.g, lit.b)), 0.0, 1.0);
    vec3 ambient = indirectIrradiance(N) * ao;
    // The shade colour fills in where the steps leave off, so the cut between lit and shaded is a change of colour and not only of brightness.
    vec3 colour = base.rgb * (ambient + lit + u_shadeColor.rgb * (1.0 - lightAmount));
    float spec = smoothstep(u_specThreshold - u_specSoftness, u_specThreshold + u_specSoftness, glossLevel);
    colour = mix(colour, u_specColor.rgb * glossTint, spec * u_specColor.a * float(u_specThreshold < 1.0));
    float rim = smoothstep(1.0 - u_rimWidth - u_rimSoftness, 1.0 - u_rimWidth + u_rimSoftness, 1.0 - NdotV);
    colour += u_rimColor.rgb * rim * lightAmount * u_rimStrength;
    fragColor = vec4(colour + u_emissive.rgb * texture(u_emissiveMap, v_texCoord).rgb, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), roughness, 0.75);
#endif
}
#pragma end

#pragma fragment wgsl
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
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
    let edge = max(fwidth(base.a), 1e-4);
    var alpha = base.a;
    if (mc.u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, mc.u_alphaCutoff, edge);
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    var N = normalize(v.v_worldNormal);
    if (!front) { N = -N; }
    let P = v.v_worldXYZ;
#else
    let N = vec3f(0.0, 0.0, 1.0);
    let P = vec3f(v.v_worldPos, 0.0);
#endif
    let occl = textureSampleGrad(u_occlusionMap, u_occlusionMap_s, v.v_texCoord, duvx, duvy).r;
    let ao = mix(1.0, occl, mc.u_occlusionStrength);
    let V = viewDirection(P);
    let NdotV = max(dot(N, V), 1e-4);
    let roughness = mix(0.7, 0.1, clamp(mc.u_specSize, 0.0, 1.0));
    let a = max(roughness * roughness, 1e-3);
    let F0 = vec3f(0.04);
    let ext = surfaceExtNone(N);
    var lit = vec3f(0.0);
    var glossLevel = 0.0;
    var glossTint = vec3f(0.0);
    for (var i = 0; i < 16; i++) {
        let term = shadeLight(lc.u_lights[i].posDir, lc.u_lights[i].color, lc.u_lights[i].spot, lc.u_lights[i].shadow,
                              lc.u_lights[i].shadowMap, lc.u_lights[i].falloff, N, V, P, a, F0, NdotV, 1.0, roughness, ext, true);
        let level = max(term.lit.r, max(term.lit.g, term.lit.b));
        if (level > 1e-4) { lit += term.lit * (toonBand(level) / level); }
        let gl = max(term.gloss.r, max(term.gloss.g, term.gloss.b));
        if (gl > glossLevel) { glossLevel = gl; glossTint = term.gloss / max(gl, 1e-4); }
    }
    let lightAmount = clamp(max(lit.r, max(lit.g, lit.b)), 0.0, 1.0);
    let ambient = indirectIrradiance(N) * ao;
    var colour = base.rgb * (ambient + lit + mc.u_shadeColor.rgb * (1.0 - lightAmount));
    let spec = smoothstep(mc.u_specThreshold - mc.u_specSoftness, mc.u_specThreshold + mc.u_specSoftness, glossLevel);
    colour = mix(colour, mc.u_specColor.rgb * glossTint, vec3f(spec * mc.u_specColor.a * select(0.0, 1.0, mc.u_specThreshold < 1.0)));
    let rim = smoothstep(1.0 - mc.u_rimWidth - mc.u_rimSoftness, 1.0 - mc.u_rimWidth + mc.u_rimSoftness, 1.0 - NdotV);
    colour += mc.u_rimColor.rgb * rim * lightAmount * mc.u_rimStrength;
    let emit = mc.u_emissive.rgb * textureSampleGrad(u_emissiveMap, u_emissiveMap_s, v.v_texCoord, duvx, duvy).rgb;
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(colour + emit, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), roughness, 0.75);
    return frag;
#else
    return vec4f(colour + emit, alpha);
#endif
}

// A level in 0..1 cut into u_bands steps (see the GLSL twin).
fn toonBand(level : f32) -> f32 {
    let t = clamp(level, 0.0, 1.0) * mc.u_bands;
    let i = floor(t);
    let f = t - i;
    let soft = max(mc.u_bandSoftness, 1e-4);
    return min((i + smoothstep(0.5 - soft, 0.5 + soft, f)) / mc.u_bands, 1.0);
}
#pragma end
`;

const MATCAP = `#pragma shader "Matcap"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
// A picture of a lit sphere: what the surface shows is looked up by which way it faces the camera, so the lighting is the picture's
// and no lamp is asked. Costs one texture read, which is why it suits a phone.
#pragma param u_matcap texture default(white)
#pragma param u_matcapStrength float default(1) range(0,2) ui(slider)
#pragma param u_baseBlend float default(0) range(0,1) ui(slider)
#pragma param u_alphaCutoff float default(0) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff

#pragma fragment
precision mediump float;

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
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    float alpha = base.a;
    if (u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, u_alphaCutoff, fwidth(base.a));
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    highp vec3 N = normalize(v_worldNormal);
    if (!gl_FrontFacing) N = -N;
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 N = vec3(0.0, 0.0, 1.0);
    highp vec3 P = vec3(v_worldPos, 0.0);
#endif
    // The camera's own axes, found from where it looks: the picture is of a sphere as the camera sees it, whichever way the camera turns.
    vec3 V = viewDirection(P);
    vec3 right = normalize(cross(abs(V.y) > 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0), V));
    vec3 up = cross(V, right);
    vec2 uv = vec2(dot(N, right), dot(N, up)) * 0.5 + 0.5;
    vec3 sphere = texture(u_matcap, uv).rgb * u_matcapStrength;
    vec3 colour = mix(sphere, sphere * base.rgb, u_baseBlend);
    fragColor = vec4(colour, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), 1.0, 0.75);
#endif
}
#pragma end

#pragma fragment wgsl
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
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
    let edge = max(fwidth(base.a), 1e-4);
    var alpha = base.a;
    if (mc.u_alphaCutoff > 0.0) {
        alpha = cutoutCoverage(base.a, mc.u_alphaCutoff, edge);
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    var N = normalize(v.v_worldNormal);
    if (!front) { N = -N; }
    let P = v.v_worldXYZ;
#else
    let N = vec3f(0.0, 0.0, 1.0);
    let P = vec3f(v.v_worldPos, 0.0);
#endif
    let V = viewDirection(P);
    var seed = vec3f(0.0, 1.0, 0.0);
    if (abs(V.y) > 0.99) { seed = vec3f(0.0, 0.0, 1.0); }
    let right = normalize(cross(seed, V));
    let up = cross(V, right);
    let uv = vec2f(dot(N, right) * 0.5 + 0.5, dot(N, up) * 0.5 + 0.5);
    let sphere = textureSampleLevel(u_matcap, u_matcap_s, uv, 0.0).rgb * mc.u_matcapStrength;
    let colour = mix(sphere, sphere * base.rgb, vec3f(mc.u_baseBlend));
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(colour, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), 1.0, 0.75);
    return frag;
#else
    return vec4f(colour, alpha);
#endif
}
#pragma end
`;

export const BUILTIN_SHADER_TEMPLATES: readonly BuiltinShaderTemplate[] = [
    template('sprite-unlit', 'Unlit', 'Texture × vertex color × tint, no lighting.', SPRITE_UNLIT),
    template('sprite-lit', 'Lit', 'Lit by the scene\'s 2D lights; optional normal map.', SPRITE_LIT),
    template('sprite-sway', 'Sway',
        'Leans in the wind, foot fixed and tip free: grass, reeds, hanging cloth. Takes the weather wind.', SPRITE_SWAY),
    template('sprite-hit-flash', 'Hit Flash',
        'Blend toward a flash color; drive u_flash from code for damage blinks.', SPRITE_HIT_FLASH),
    template('sprite-outline', 'Outline',
        'Colored silhouette outline around the sprite\'s opaque pixels.', SPRITE_OUTLINE),
    template('sprite-dissolve', 'Dissolve',
        'Noise-driven burn-away with a glowing edge (u_progress 0→1).', SPRITE_DISSOLVE),
    template('sprite-pixelate', 'Pixelate', 'Quantizes UVs to a coarse pixel grid.', SPRITE_PIXELATE),
    template('sprite-uv-scroll', 'UV Scroll',
        'Scrolls the texture over time (conveyors, water, clouds).', SPRITE_UV_SCROLL),
    template('model', 'Model',
        'What an imported model\'s material says: normal map, emission, occlusion, alpha cutoff.',
        MODEL),
    template('toon', 'Toon',
        'Lit in steps: the light cut into flat bands, a shade colour where it does not reach, a flat highlight and a rim. Shadows are part of a step.',
        TOON),
    template('matcap', 'Matcap',
        'What a picture of a lit sphere shows, looked up by which way the surface faces the camera. No lamps, one texture read.',
        MATCAP),
];

/** Where the templates that are not the core's sit in a list, so a menu reads the same whichever order the modules were installed in. */
const MODULE_TEMPLATE_ORDER = ['water', 'terrain', 'foliage', 'hair', 'skin', 'eye'];

/** The module a built-in shader ships in, for the error a project gets when its material names a shader whose module it did not install. */
export const BUILTIN_SHADER_MODULE: Readonly<Record<string, string>> = {
    water: 'esengine/water', terrain: 'esengine/terrain', foliage: 'esengine/foliage',
    hair: 'esengine/character-shaders', skin: 'esengine/character-shaders', eye: 'esengine/character-shaders',
};

/**
 * Adds a module's shader template to the built-in list. A module calls it when it is installed, so a package that does not install water carries none of its
 * 38 KB of shader source. Registering the same id again replaces it.
 */
export function registerBuiltinShaderTemplate(entry: BuiltinShaderTemplate): void {
    const at = BUILTIN_SHADER_TEMPLATES.findIndex((t) => t.id === entry.id);
    if (at >= 0) { (BUILTIN_SHADER_TEMPLATES as BuiltinShaderTemplate[])[at] = entry; return; }
    const list = BUILTIN_SHADER_TEMPLATES as BuiltinShaderTemplate[];
    list.push(entry);
    const rank = (id: string): number => { const i = MODULE_TEMPLATE_ORDER.indexOf(id); return i < 0 ? -1 : i; };
    // Core templates keep their places; the module ones follow them in a fixed order.
    const core = list.filter((t) => rank(t.id) < 0), modules = list.filter((t) => rank(t.id) >= 0).sort((a, b) => rank(a.id) - rank(b.id));
    list.splice(0, list.length, ...core, ...modules);
}

export function builtinShaderTemplate(id: string): BuiltinShaderTemplate | undefined {
    return BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id);
}
