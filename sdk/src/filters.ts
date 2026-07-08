// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Material, type ShaderHandle } from './material';

// Fragment-only .esshader on the reflected #pragma param seam. The 5x4 color
// matrix ships as four row vec4s + an offset vec4 (MaterialConstants params are
// at most vec4 — a mat4 uniform could never cross setMaterialUniform, so the old
// raw-GLSL form of this filter was unusable by construction).
const COLOR_MATRIX_ESSHADER = `#pragma shader "ColorMatrixFilter"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_cmRow0 vec4 default(1,0,0,0)
#pragma param u_cmRow1 vec4 default(0,1,0,0)
#pragma param u_cmRow2 vec4 default(0,0,1,0)
#pragma param u_cmRow3 vec4 default(0,0,0,1)
#pragma param u_colorOffset vec4 default(0,0,0,0)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec4 texColor = texture(u_textures[0], v_texCoord) * v_color;
    vec4 result = vec4(
        dot(u_cmRow0, texColor),
        dot(u_cmRow1, texColor),
        dot(u_cmRow2, texColor),
        dot(u_cmRow3, texColor)) + u_colorOffset;
    fragColor = clamp(result, 0.0, 1.0);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texColor = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
    let result = vec4f(
        dot(mc.u_cmRow0, texColor),
        dot(mc.u_cmRow1, texColor),
        dot(mc.u_cmRow2, texColor),
        dot(mc.u_cmRow3, texColor)) + mc.u_colorOffset;
    return clamp(result, vec4f(0.0), vec4f(1.0));
}
#pragma end
`;

let colorMatrixShader_: ShaderHandle | null = null;

function getColorMatrixShader(): ShaderHandle {
    if (colorMatrixShader_ === null || colorMatrixShader_ === 0) {
        colorMatrixShader_ = Material.compileShader(COLOR_MATRIX_ESSHADER);
    }
    return colorMatrixShader_!;
}

export const Filters = {
    identityMatrix(): number[] {
        return [
            1, 0, 0, 0, 0,
            0, 1, 0, 0, 0,
            0, 0, 1, 0, 0,
            0, 0, 0, 1, 0,
        ];
    },

    grayscaleMatrix(): number[] {
        const r = 0.299, g = 0.587, b = 0.114;
        return [
            r, g, b, 0, 0,
            r, g, b, 0, 0,
            r, g, b, 0, 0,
            0, 0, 0, 1, 0,
        ];
    },

    sepiaMatrix(): number[] {
        return [
            0.393, 0.769, 0.189, 0, 0,
            0.349, 0.686, 0.168, 0, 0,
            0.272, 0.534, 0.131, 0, 0,
            0,     0,     0,     1, 0,
        ];
    },

    brightnessMatrix(value: number): number[] {
        return [
            value, 0, 0, 0, 0,
            0, value, 0, 0, 0,
            0, 0, value, 0, 0,
            0, 0, 0,     1, 0,
        ];
    },

    contrastMatrix(value: number): number[] {
        const offset = (1 - value) * 0.5;
        return [
            value, 0, 0, 0, offset,
            0, value, 0, 0, offset,
            0, 0, value, 0, offset,
            0, 0, 0,     1, 0,
        ];
    },

    saturationMatrix(value: number): number[] {
        const r = 0.299, g = 0.587, b = 0.114;
        const sr = (1 - value) * r;
        const sg = (1 - value) * g;
        const sb = (1 - value) * b;
        return [
            sr + value, sg,         sb,         0, 0,
            sr,         sg + value, sb,         0, 0,
            sr,         sg,         sb + value, 0, 0,
            0,          0,          0,          1, 0,
        ];
    },

    invertMatrix(): number[] {
        return [
            -1, 0, 0, 0, 1,
            0, -1, 0, 0, 1,
            0, 0, -1, 0, 1,
            0, 0,  0, 1, 0,
        ];
    },

    getColorMatrixShader,

    /**
     * Maps a 20-element (5x4 row-major) color matrix onto the shader's params:
     * four row vec4s plus the offset column. Apply with Material.setUniform.
     */
    colorMatrixUniforms(matrix: number[]): Record<string, number[]> {
        const row = (i: number) => [matrix[i * 5], matrix[i * 5 + 1], matrix[i * 5 + 2], matrix[i * 5 + 3]];
        return {
            u_cmRow0: row(0),
            u_cmRow1: row(1),
            u_cmRow2: row(2),
            u_cmRow3: row(3),
            u_colorOffset: [matrix[4], matrix[9], matrix[14], matrix[19]],
        };
    },
};
