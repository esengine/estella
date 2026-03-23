/**
 * @file    spriteFilter.ts
 * @brief   Per-sprite filter effects using custom materials
 */

import { Material, type MaterialHandle, type ShaderHandle } from './material';

// =============================================================================
// Outline/Glow Shader (single-pass, samples 8 neighbors)
// =============================================================================

const OUTLINE_VERT = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
attribute vec4 a_color;
uniform mat4 u_projection;
varying vec2 v_texCoord;
varying vec4 v_color;
void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
    v_color = a_color;
}
`;

const OUTLINE_FRAG = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec4 u_outlineColor;
uniform float u_outlineWidth;
varying vec2 v_texCoord;
varying vec4 v_color;
void main() {
    vec4 texColor = texture2D(u_texture, v_texCoord) * v_color;
    float maxAlpha = 0.0;
    for (float x = -1.0; x <= 1.0; x += 1.0) {
        for (float y = -1.0; y <= 1.0; y += 1.0) {
            if (x == 0.0 && y == 0.0) continue;
            vec2 offset = vec2(x, y) * u_texelSize * u_outlineWidth;
            float a = texture2D(u_texture, v_texCoord + offset).a;
            maxAlpha = max(maxAlpha, a);
        }
    }
    vec4 outline = u_outlineColor * maxAlpha * (1.0 - texColor.a);
    gl_FragColor = texColor + outline;
}
`;

// =============================================================================
// Drop Shadow Shader (single-pass offset + blur)
// =============================================================================

const SHADOW_FRAG = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec2 u_shadowOffset;
uniform vec4 u_shadowColor;
uniform float u_shadowBlur;
varying vec2 v_texCoord;
varying vec4 v_color;
void main() {
    vec2 shadowUV = v_texCoord - u_shadowOffset * u_texelSize;
    float shadowAlpha = 0.0;
    float total = 0.0;
    float radius = max(1.0, u_shadowBlur);
    for (float x = -2.0; x <= 2.0; x += 1.0) {
        for (float y = -2.0; y <= 2.0; y += 1.0) {
            vec2 offset = vec2(x, y) * u_texelSize * radius;
            shadowAlpha += texture2D(u_texture, shadowUV + offset).a;
            total += 1.0;
        }
    }
    shadowAlpha /= total;
    vec4 shadow = u_shadowColor * shadowAlpha;
    vec4 texColor = texture2D(u_texture, v_texCoord) * v_color;
    gl_FragColor = texColor + shadow * (1.0 - texColor.a);
}
`;

// =============================================================================
// Shader Cache
// =============================================================================

let outlineShader_: ShaderHandle = 0;
let shadowShader_: ShaderHandle = 0;

function getOutlineShader(): ShaderHandle {
    if (outlineShader_ === 0) {
        outlineShader_ = Material.createShader(OUTLINE_VERT, OUTLINE_FRAG);
    }
    return outlineShader_;
}

function getShadowShader(): ShaderHandle {
    if (shadowShader_ === 0) {
        shadowShader_ = Material.createShader(OUTLINE_VERT, SHADOW_FRAG);
    }
    return shadowShader_;
}

// =============================================================================
// Filter API
// =============================================================================

export interface OutlineFilterOptions {
    color?: { r: number; g: number; b: number; a: number };
    width?: number;
    texelSize?: { x: number; y: number };
}

export interface DropShadowFilterOptions {
    color?: { r: number; g: number; b: number; a: number };
    offsetX?: number;
    offsetY?: number;
    blur?: number;
    texelSize?: { x: number; y: number };
}

const DEFAULT_TEXEL_SIZE = { x: 1 / 512, y: 1 / 512 };

export const SpriteFilter = {
    createOutline(options?: OutlineFilterOptions): MaterialHandle {
        const shader = getOutlineShader();
        const color = options?.color ?? { r: 1, g: 1, b: 1, a: 1 };
        const width = options?.width ?? 1.0;
        const texel = options?.texelSize ?? DEFAULT_TEXEL_SIZE;

        const mat = Material.create({ shader });
        Material.setUniform(mat, 'u_outlineColor', [color.r, color.g, color.b, color.a]);
        Material.setUniform(mat, 'u_outlineWidth', width);
        Material.setUniform(mat, 'u_texelSize', [texel.x, texel.y]);
        return mat;
    },

    createGlow(options?: OutlineFilterOptions): MaterialHandle {
        return SpriteFilter.createOutline({
            color: options?.color ?? { r: 1, g: 0.8, b: 0.2, a: 0.8 },
            width: options?.width ?? 2.0,
            texelSize: options?.texelSize,
        });
    },

    createDropShadow(options?: DropShadowFilterOptions): MaterialHandle {
        const shader = getShadowShader();
        const color = options?.color ?? { r: 0, g: 0, b: 0, a: 0.6 };
        const ox = options?.offsetX ?? 3;
        const oy = options?.offsetY ?? 3;
        const blur = options?.blur ?? 2;
        const texel = options?.texelSize ?? DEFAULT_TEXEL_SIZE;

        const mat = Material.create({ shader });
        Material.setUniform(mat, 'u_shadowColor', [color.r, color.g, color.b, color.a]);
        Material.setUniform(mat, 'u_shadowOffset', [ox, oy]);
        Material.setUniform(mat, 'u_shadowBlur', blur);
        Material.setUniform(mat, 'u_texelSize', [texel.x, texel.y]);
        return mat;
    },

    setOutlineColor(material: MaterialHandle, color: { r: number; g: number; b: number; a: number }): void {
        Material.setUniform(material, 'u_outlineColor', [color.r, color.g, color.b, color.a]);
    },

    setOutlineWidth(material: MaterialHandle, width: number): void {
        Material.setUniform(material, 'u_outlineWidth', width);
    },

    setShadowOffset(material: MaterialHandle, x: number, y: number): void {
        Material.setUniform(material, 'u_shadowOffset', [x, y]);
    },

    setShadowBlur(material: MaterialHandle, blur: number): void {
        Material.setUniform(material, 'u_shadowBlur', blur);
    },
};
