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

const template = (id: string, label: string, description: string, source: string): BuiltinShaderTemplate =>
    ({ id, label, description, source, defaults: templateDefaults(source) });

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
    return textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_tint;
}
#pragma end
`;

const SPRITE_LIT = `#pragma shader "Sprite Lit"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal)

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
#else
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
#endif
    fragColor = vec4(applyLighting2D(base.rgb, N, v_worldPos), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_tint;
#ifdef MESH_NORMALS
    let N = perturbNormal(normalize(v.v_worldNormal), v.v_worldXYZ, v.v_texCoord,
                          sampleNormal(u_normalMap, u_normalMap_s, v.v_texCoord));
#else
    let N = sampleNormal(u_normalMap, u_normalMap_s, v.v_texCoord);
#endif
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
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
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
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
    let texel = mc.u_outlineWidth / vec2f(textureDimensions(t0, 0));
    var edge = 0.0;
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f( texel.x, 0.0), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(-texel.x, 0.0), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(0.0,  texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(0.0, -texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f( texel.x,  texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f( texel.x, -texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(-texel.x,  texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(-texel.x, -texel.y), 0.0).a);
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
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
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
    let uv = fract(v.v_texCoord + tc.u_time.x * mc.u_scrollSpeed);
    return textureSampleLevel(t0, s0, uv, 0.0) * v.v_color;
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
#pragma param u_normalMap texture default(flatnormal)
#pragma param u_emissive color default(0,0,0,1)
#pragma param u_emissiveMap texture default(white)
#pragma param u_occlusionMap texture default(white)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
#pragma param u_alphaCutoff float default(0) range(0,1) ui(slider)
#pragma param u_metallic float default(0) range(0,1) ui(slider)
#pragma param u_roughness float default(1) range(0,1) ui(slider)
#pragma param u_metallicRoughnessMap texture default(white)

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

// Base colour rides the draw itself (slot 0 x vertex colour) — glTF's baseColor
// is what a MeshRenderer already carries. Emission is added AFTER lighting (it is light
// this surface makes) and occlusion scales only the ambient term.
// Metal-roughness packing is glTF's: roughness in green, metal in blue.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    if (base.a < u_alphaCutoff) discard;
#ifdef MESH_NORMALS
    highp vec3 N = perturbNormal(normalize(v_worldNormal), v_worldXYZ, v_texCoord,
                                 sampleNormal(u_normalMap, v_texCoord));
#else
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
#endif
    float ao = mix(1.0, texture(u_occlusionMap, v_texCoord).r, u_occlusionStrength);
    vec3 mr = texture(u_metallicRoughnessMap, v_texCoord).rgb;
    highp vec3 P = vec3(v_worldPos, 0.0);
    // specular 1: a glTF material reflects unless KHR_materials_specular says less.
    vec3 lit = applyLightingPBR(base.rgb, N, P, viewDirection(P),
                                u_metallic * mr.b, u_roughness * mr.g, 1.0, ao);
    fragColor = vec4(lit + u_emissive.rgb * texture(u_emissiveMap, v_texCoord).rgb, base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_tint;
    if (base.a < mc.u_alphaCutoff) { discard; }
#ifdef MESH_NORMALS
    let N = perturbNormal(normalize(v.v_worldNormal), v.v_worldXYZ, v.v_texCoord,
                          sampleNormal(u_normalMap, u_normalMap_s, v.v_texCoord));
#else
    let N = sampleNormal(u_normalMap, u_normalMap_s, v.v_texCoord);
#endif
    let occl = textureSampleLevel(u_occlusionMap, u_occlusionMap_s, v.v_texCoord, 0.0).r;
    let ao = mix(1.0, occl, mc.u_occlusionStrength);
    let mr = textureSampleLevel(u_metallicRoughnessMap, u_metallicRoughnessMap_s,
                                v.v_texCoord, 0.0).rgb;
    let P = vec3f(v.v_worldPos, 0.0);
    let lit = applyLightingPBR(base.rgb, N, P, viewDirection(P),
                               mc.u_metallic * mr.b, mc.u_roughness * mr.g, 1.0, ao);
    let emit = mc.u_emissive.rgb
             * textureSampleLevel(u_emissiveMap, u_emissiveMap_s, v.v_texCoord, 0.0).rgb;
    return vec4f(lit + emit, base.a);
}
#pragma end
`;

export const BUILTIN_SHADER_TEMPLATES: readonly BuiltinShaderTemplate[] = [
    template('sprite-unlit', 'Unlit', 'Texture × vertex color × tint, no lighting.', SPRITE_UNLIT),
    template('sprite-lit', 'Lit', 'Lit by the scene\'s 2D lights; optional normal map.', SPRITE_LIT),
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
];

export function builtinShaderTemplate(id: string): BuiltinShaderTemplate | undefined {
    return BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id);
}
