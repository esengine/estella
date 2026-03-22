import { Material, type ShaderHandle } from './material';

const COLOR_MATRIX_VERT = `
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

const COLOR_MATRIX_FRAG = `
precision mediump float;
uniform sampler2D u_texture;
uniform mat4 u_colorMatrix;
uniform vec4 u_colorOffset;
varying vec2 v_texCoord;
varying vec4 v_color;
void main() {
    vec4 texColor = texture2D(u_texture, v_texCoord) * v_color;
    vec4 result = u_colorMatrix * texColor + u_colorOffset;
    gl_FragColor = clamp(result, 0.0, 1.0);
}
`;

let colorMatrixShader_: ShaderHandle | null = null;

function getColorMatrixShader(): ShaderHandle {
    if (colorMatrixShader_ === null || colorMatrixShader_ === 0) {
        colorMatrixShader_ = Material.createShader(COLOR_MATRIX_VERT, COLOR_MATRIX_FRAG);
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
};
