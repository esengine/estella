// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtinShaders.ts
 * @brief   Built-in .esshader templates — the engine's stock material starting points.
 * @details Each template carries a `#pragma fragment wgsl` twin so it compiles
 *          on the WebGPU backend. Twins run under the canonical fragment-only
 *          contract: `fs_main(v : VSOut)` with v.v_color / v.v_texCoord
 *          (+ v.v_worldPos on Lit2D), the batch textures as t0..t7 / s0..s7,
 *          params as mc.<name>, texture params as <name> + <name>_s, and the
 *          frame clock as tc.u_time / tc.u_viewport.
 */

export interface BuiltinShaderTemplate {
    id: string;
    /** Menu / picker label, e.g. "Lit". */
    label: string;
    description: string;
    source: string;
    /** Initial .esmaterial `properties` for a material born from this template. */
    defaults: Record<string, unknown>;
}

const SPRITE_UNLIT = `#pragma shader "Sprite Unlit"
#pragma version 300 es
#pragma domain Unlit2D
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
#pragma domain Lit2D
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Unset u_normalMap = flat normal, so lighting works with no normal map assigned.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
    fragColor = vec4(applyLighting2D(base.rgb, N, v_worldPos), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_tint;
    let N = sampleNormal(u_normalMap, u_normalMap_s, v.v_texCoord);
    return vec4f(applyLighting2D(base.rgb, N, v.v_worldPos), base.a);
}
#pragma end
`;

const SPRITE_HIT_FLASH = `#pragma shader "Hit Flash"
#pragma version 300 es
#pragma domain Unlit2D
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
#pragma domain Unlit2D
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
#pragma domain Unlit2D
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
#pragma domain Unlit2D
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
#pragma domain Unlit2D
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

export const BUILTIN_SHADER_TEMPLATES: readonly BuiltinShaderTemplate[] = [
    {
        id: 'sprite-unlit',
        label: 'Unlit',
        description: 'Texture × vertex color × tint, no lighting.',
        source: SPRITE_UNLIT,
        defaults: { u_tint: { r: 1, g: 1, b: 1, a: 1 } },
    },
    {
        id: 'sprite-lit',
        label: 'Lit',
        description: 'Lit by the scene\'s 2D lights; optional normal map.',
        source: SPRITE_LIT,
        defaults: { u_tint: { r: 1, g: 1, b: 1, a: 1 } },
    },
    {
        id: 'sprite-hit-flash',
        label: 'Hit Flash',
        description: 'Blend toward a flash color; drive u_flash from code for damage blinks.',
        source: SPRITE_HIT_FLASH,
        defaults: {},
    },
    {
        id: 'sprite-outline',
        label: 'Outline',
        description: 'Colored silhouette outline around the sprite\'s opaque pixels.',
        source: SPRITE_OUTLINE,
        defaults: {},
    },
    {
        id: 'sprite-dissolve',
        label: 'Dissolve',
        description: 'Noise-driven burn-away with a glowing edge (u_progress 0→1).',
        source: SPRITE_DISSOLVE,
        defaults: {},
    },
    {
        id: 'sprite-pixelate',
        label: 'Pixelate',
        description: 'Quantizes UVs to a coarse pixel grid.',
        source: SPRITE_PIXELATE,
        defaults: {},
    },
    {
        id: 'sprite-uv-scroll',
        label: 'UV Scroll',
        description: 'Scrolls the texture over time (conveyors, water, clouds).',
        source: SPRITE_UV_SCROLL,
        defaults: {},
    },
];

export function builtinShaderTemplate(id: string): BuiltinShaderTemplate | undefined {
    return BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id);
}
