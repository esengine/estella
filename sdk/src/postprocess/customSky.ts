// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    customSky.ts
 * @brief   A sky a project writes itself, drawn behind the scene and, when it asks, lighting it.
 *
 * @details The author writes one function, the sky's radiance along a direction, in GLSL and WGSL. Around it this builds a
 *          post-process effect that draws it where nothing else was drawn, as Sky Atmosphere does, and that can draw the
 *          same function as a small panorama for the engine to read back: that panorama is made into the scene's
 *          environment (its diffuse light and its reflections) exactly as Sky Atmosphere's is, at most once a second. So a
 *          stylised sky lights the scene with the light it shows, as Unreal's sky material does under a real-time Sky Light.
 *
 *          The function is `skyRadiance(dir, sun, sunColor, env)`: `dir` and `sun` unit world directions (the sun is the
 *          first directional light, or straight up without one), `sunColor` that light's colour times intensity, and `env`
 *          1 while the panorama is drawn — when a sun disc should be left out, since the directional light is the sun's
 *          direct light there. It returns linear radiance, before exposure. The effect's own params are uniforms like any
 *          effect's: in GLSL by name, in WGSL as `mc.<name>`; the time is `u_time.x` / `tc.u_time.x`.
 *
 *          A sky with clouds can shade the ground under them, as Sky Atmosphere's do: with `groundShadow` the author writes a
 *          second function, `skyShadow(world, sun)`, how much of the scene's light is left at a world position (1 is all of
 *          it), and every surface the pass finds is multiplied by it.
 */

import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { registerEffect, type EffectColorDef, type EffectUniformDef } from './effects';
import type { BuiltinTexture } from './effects';

export interface SkyEffectSource {
    /** The effect's type, as a volume names it. */
    type: string;
    label: string;
    /** The sky's own float params. Brightness (`u_intensity`) and Light the Scene (`u_lightScene`) are added. */
    uniforms?: EffectUniformDef[];
    /** Colour params (vec4). */
    colors?: EffectColorDef[];
    /** Textures the sky brings itself (a noise table), by sampler name: GLSL `name`, WGSL `name` with `name_s`. */
    textures?: Record<string, () => BuiltinTexture>;
    /** GLSL declarations and `vec3 skyRadiance(vec3 dir, vec3 sun, vec3 sunColor, float env)`. */
    glsl: string;
    /** The same in WGSL: `fn skyRadiance(dir : vec3f, sun : vec3f, sunColor : vec3f, env : f32) -> vec3f`. */
    wgsl: string;
    /**
     * The sky shades the ground: the sources also hold `float skyShadow(vec3 world, vec3 sun)` and
     * `fn skyShadow(world : vec3f, sun : vec3f) -> f32`, what is left of a surface's light at a world position, 0 to 1.
     */
    groundShadow?: boolean;
}

/** The sky types defined here: what the volumes look for, beside Sky Atmosphere, to light the scene. */
const skyTypes = new Set<string>();

export function isCustomSky(type: string): boolean {
    return skyTypes.has(type);
}

/** The panorama's size: the light a sky sends is smooth. Equal to Sky Atmosphere's. */
export const CUSTOM_SKY_WIDTH = 64;
export const CUSTOM_SKY_HEIGHT = 32;
/** The panorama is stored as RGBM over this range (the environment's own reflection range). */
export const CUSTOM_SKY_RANGE = 8;

function pragmaLine(u: EffectUniformDef): string {
    return `#pragma param ${u.name} float default(${u.defaultValue}) range(${u.min},${u.max})`;
}

function colorPragma(c: EffectColorDef): string {
    const v = c.defaultValue;
    return `#pragma param ${c.name} color default(${v.r},${v.g},${v.b},${v.a})`;
}

/** The effect's shader: the author's function, drawn under the scene or, with u_skyCapture, as the panorama. */
export function skyEffectSource(src: SkyEffectSource): string {
    const params = [
        '#pragma param u_intensity float default(1) range(0,8)',
        '#pragma param u_lightScene float default(0) range(0,1)',
        '#pragma param u_skyCapture float default(0) range(0,1)',
        // A marker the engine reads (see Sky Atmosphere): the scene is cleared to nothing, so its alpha is its coverage.
        '#pragma param u_sceneCoverage float default(1) range(0,1)',
        ...(src.uniforms ?? []).map(pragmaLine),
        ...(src.colors ?? []).map(colorPragma),
        ...Object.keys(src.textures ?? {}).map((name) => `#pragma param ${name} texture default(black)`),
    ].join('\n');
    // The panorama's direction for a texel, in Panorama's own mapping (lightmap/panorama.ts). Its v runs down from the
    // zenith; the readback lands rows bottom-up on both backends while the pass's uv runs up the target on GL and down it
    // on WebGPU, so v is 1 - uv.y there and uv.y here, and the reader turns the rows over.
    return `#pragma shader "Sky ${src.label}"
#pragma version 300 es
#pragma domain PostProcess
#pragma lights
${params}

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${src.glsl}

vec3 esSkyPanoramaDir(vec2 uv) {
    float phi = (uv.x - 0.5) * 6.28318531;
    float theta = (1.0 - uv.y) * 3.14159265;
    float s = sin(theta);
    return vec3(-s * sin(phi), cos(theta), s * cos(phi));
}

void main() {
    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    vec3 sun = lightDir.w > 0.5 ? lightDir.xyz : vec3(0.0, 1.0, 0.0);
    vec3 sunColor = lightColor.rgb * lightColor.a;
    if (u_skyCapture > 0.5) {
        vec3 c = clamp(skyRadiance(esSkyPanoramaDir(v_texCoord), sun, sunColor, 1.0) * u_intensity, vec3(0.0), vec3(${CUSTOM_SKY_RANGE.toFixed(1)}));
        float m = clamp(max(max(c.r, c.g), max(c.b, 1e-6)) / ${CUSTOM_SKY_RANGE.toFixed(1)}, 1.0 / 255.0, 1.0);
        m = ceil(m * 255.0) / 255.0;
        fragColor = vec4(c / (m * ${CUSTOM_SKY_RANGE.toFixed(1)}), m);
        return;
    }
    vec4 src = texture(u_sceneTexture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1)), 0).r;
    if (depth < 1.0 && src.a > 0.999) { fragColor = ${src.groundShadow ? 'vec4(src.rgb * clamp(skyShadow(worldFromDepth(v_texCoord, depth) + u_renderOrigin.xyz, sun), 0.0, 1.0), src.a)' : 'src'}; return; }
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    vec3 dir = normalize(worldFromDepth(v_texCoord, 1.0) - entry);
    vec3 col = skyRadiance(dir, sun, sunColor, 0.0) * u_intensity;
    fragColor = vec4(src.rgb + (1.0 - src.a) * col, src.a > 0.99 ? src.a : 1.0);
}
#pragma end

#pragma fragment wgsl
${src.wgsl}

fn esSkyPanoramaDir(uv : vec2f) -> vec3f {
    let phi = (uv.x - 0.5) * 6.28318531;
    let theta = uv.y * 3.14159265;
    let s = sin(theta);
    return vec3f(-s * sin(phi), cos(theta), s * cos(phi));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let found = findSun();
    var sun = vec3f(0.0, 1.0, 0.0);
    if (found.dir.w > 0.5) { sun = found.dir.xyz; }
    let sunColor = found.color.rgb * found.color.a;
    if (mc.u_skyCapture > 0.5) {
        let c = clamp(skyRadiance(esSkyPanoramaDir(v.v_texCoord), sun, sunColor, 1.0) * mc.u_intensity, vec3f(0.0), vec3f(${CUSTOM_SKY_RANGE.toFixed(1)}));
        var m = clamp(max(max(c.r, c.g), max(c.b, 1e-6)) / ${CUSTOM_SKY_RANGE.toFixed(1)}, 1.0 / 255.0, 1.0);
        m = ceil(m * 255.0) / 255.0;
        return vec4f(c / (m * ${CUSTOM_SKY_RANGE.toFixed(1)}), m);
    }
    let src = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let depth = textureLoad(t7, clamp(vec2i(v.v_texCoord * vec2f(size)), vec2i(0), size - vec2i(1)), 0);
    if (depth < 1.0 && src.a > 0.999) { return ${src.groundShadow ? 'vec4f(src.rgb * clamp(skyShadow(worldFromDepth(v.v_texCoord, depth) + frame.renderOrigin.xyz, sun), 0.0, 1.0), src.a)' : 'src'}; }
    let entry = worldFromDepth(v.v_texCoord, 0.0);
    let dir = normalize(worldFromDepth(v.v_texCoord, 1.0) - entry);
    let col = skyRadiance(dir, sun, sunColor, 0.0) * mc.u_intensity;
    var a = 1.0;
    if (src.a > 0.99) { a = src.a; }
    return vec4f(src.rgb + (1.0 - src.a) * col, a);
}
#pragma end
`;
}

/**
 * Registers a sky a project wrote: an effect of `type` a PostProcessVolume can carry, with Brightness and Light the
 * Scene beside the sky's own params. One per type; defining a type again replaces it.
 */
export function defineSkyEffect(src: SkyEffectSource): void {
    let shader: ShaderHandle | null = null;
    skyTypes.add(src.type);
    registerEffect({
        type: src.type,
        label: src.label,
        factory: () => (shader ??= Material.compileShader(skyEffectSource(src))),
        uniforms: [
            { name: 'u_intensity', label: 'Brightness', min: 0, max: 8, step: 0.01, defaultValue: 1 },
            { name: 'u_lightScene', label: 'Light the Scene', min: 0, max: 1, step: 1, defaultValue: 0, neutralValue: 0 },
            ...(src.uniforms ?? []),
        ],
        colors: src.colors,
        builtinTextures: src.textures,
    });
}

/**
 * The capture as a panorama of linear radiance, top row the zenith (Panorama's layout): the RGBM pixels decoded and the
 * readback's bottom-up rows turned over.
 */
export function decodeSkyCapture(rgba: Uint8Array, width: number, height: number): { width: number; height: number; rgb: Float32Array } {
    const rgb = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        const from = (height - 1 - y) * width;
        for (let x = 0; x < width; x++) {
            const i = (from + x) * 4;
            const m = (rgba[i + 3]! / 255) * CUSTOM_SKY_RANGE;
            const o = (y * width + x) * 3;
            rgb[o] = (rgba[i]! / 255) * m;
            rgb[o + 1] = (rgba[i + 1]! / 255) * m;
            rgb[o + 2] = (rgba[i + 2]! / 255) * m;
        }
    }
    return { width, height, rgb };
}
