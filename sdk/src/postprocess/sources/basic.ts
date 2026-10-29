// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    basic.ts
 * @brief   The shader sources of the colour, lens, edge and anti-aliasing effects, installed by a package that uses one of them.
 */
import type { ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';
import { registerEffectSources, registerComputeSource } from '../effectSources';
import { SHARPEN_WGSL } from '../computeEffects';
import { lensEffects } from '../lensEffects';
import { AGX_LUT_BASE64, AGX_LUT_SIZE } from '../agxLut.generated';
import { SSAO_GLSL, SSAO_WGSL, GBUFFER_GLSL, GBUFFER_WGSL } from './shared';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The AgX table as the strip the shader reads (32 slices of 32x32 side by side, slice = blue), RGBA bytes. Decoded by hand: not every runtime has `atob`. */
function agxStrip(): { width: number; height: number; pixels: Uint8Array } {
    const n = AGX_LUT_SIZE;
    const rgb = new Uint8Array(n * n * n * 3);
    let bits = 0, held = 0, out = 0;
    for (let i = 0; i < AGX_LUT_BASE64.length && out < rgb.length; i++) {
        const v = BASE64.indexOf(AGX_LUT_BASE64[i]!);
        if (v < 0) continue;
        held = (held << 6) | v;
        bits += 6;
        if (bits >= 8) { bits -= 8; rgb[out++] = (held >> bits) & 0xff; }
    }
    const width = n * n, pixels = new Uint8Array(width * n * 4);
    for (let b = 0; b < n; b++) {
        for (let g = 0; g < n; g++) {
            for (let r = 0; r < n; r++) {
                const from = ((b * n + g) * n + r) * 3, to = (g * width + b * n + r) * 4;
                pixels[to] = rgb[from]!; pixels[to + 1] = rgb[from + 1]!; pixels[to + 2] = rgb[from + 2]!; pixels[to + 3] = 255;
            }
        }
    }
    return { width, height: n, pixels };
}

export const basicEffects = {
    /** The AgX table, for the effect to upload once (see `builtinTextures` on its definition). */
    agxLut: agxStrip,
    createAgx(): ShaderHandle {
        // AgX, the view transform Blender uses, from the data Blender ships: a log2 encode of E-Gamut, a 32^3 table (agxLut.generated.ts)
        // and the look's contrast about 0.4 (1 is AgX Base, 1.2 is Medium High Contrast). It writes display-linear, so it goes last and
        // the project's output transform stays "none".
        const source = `#pragma shader "PP AgX"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_contrast float default(1) range(0.5,2)
#pragma param u_lut texture default(white)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

// Scene-linear Rec.709 to FilmLight E-Gamut (Rec.709 to XYZ D65, then XYZ to E-Gamut).
const mat3 TO_EGAMUT = mat3(0.5593711, 0.0762207, 0.0655267, 0.3047833, 0.7879718, 0.1645467, 0.1358455, 0.1358075, 0.7699265);

vec3 sampleLut(vec3 t) {
    const float size = 32.0;
    float b = clamp(t.b, 0.0, 1.0) * (size - 1.0);
    float slice0 = floor(b);
    float slice1 = min(slice0 + 1.0, size - 1.0);
    float u = (clamp(t.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    float v = (clamp(t.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    vec3 a = texture(u_lut, vec2(u + slice0 / size, v)).rgb;
    vec3 d = texture(u_lut, vec2(u + slice1 / size, v)).rgb;
    return mix(a, d, b - slice0);
}

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec3 e = TO_EGAMUT * max(color.rgb, vec3(0.0));
    // log2 over -12.47393 .. +12.5260688 stops, then the look's contrast about 0.4, then the AgX table (Rec.1886 encoded).
    vec3 t = clamp((log2(max(e, vec3(1e-10))) + 12.47393) / 25.0, 0.0, 1.0);
    t = clamp((t - 0.4) * u_contrast + 0.4, 0.0, 1.0);
    vec3 encoded = sampleLut(t);
    // Back to display-linear: the blit that follows applies the display's own encode.
    fragColor = vec4(pow(encoded, vec3(2.4)), color.a);
}
#pragma end

#pragma fragment wgsl
const TO_EGAMUT = mat3x3f(vec3f(0.5593711, 0.0762207, 0.0655267), vec3f(0.3047833, 0.7879718, 0.1645467), vec3f(0.1358455, 0.1358075, 0.7699265));

fn sampleLut(t : vec3f) -> vec3f {
    let size = 32.0;
    let b = clamp(t.b, 0.0, 1.0) * (size - 1.0);
    let slice0 = floor(b);
    let slice1 = min(slice0 + 1.0, size - 1.0);
    let u = (clamp(t.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    let v = (clamp(t.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    let a = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice0 / size, v), 0.0).rgb;
    let d = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice1 / size, v), 0.0).rgb;
    return mix(a, d, b - slice0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let e = TO_EGAMUT * max(color.rgb, vec3f(0.0));
    var t = clamp((log2(max(e, vec3f(1e-10))) + 12.47393) / 25.0, vec3f(0.0), vec3f(1.0));
    t = clamp((t - 0.4) * mc.u_contrast + 0.4, vec3f(0.0), vec3f(1.0));
    let encoded = sampleLut(t);
    return vec4f(pow(encoded, vec3f(2.4)), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createLutGrade(): ShaderHandle {
        // True LUT color grading: a 2D-packed 32^3 LUT (1024x32 — 32 slices of
        // 32x32 laid out along X; slice index = blue). Sampled twice around the
        // blue coordinate and mixed, giving trilinear-quality grading from a
        const source = `#pragma shader "PP LUT Grade"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_lut texture default(white)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec3 sampleLut(vec3 c) {
    const float size = 32.0;
    float b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    float slice0 = floor(b);
    float slice1 = min(slice0 + 1.0, size - 1.0);
    float u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    float v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    vec3 a = texture(u_lut, vec2(u + slice0 / size, v)).rgb;
    vec3 d = texture(u_lut, vec2(u + slice1 / size, v)).rgb;
    return mix(a, d, b - slice0);
}

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    fragColor = vec4(mix(color.rgb, sampleLut(color.rgb), u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
fn sampleLut(c : vec3f) -> vec3f {
    let size = 32.0;
    let b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    let slice0 = floor(b);
    let slice1 = min(slice0 + 1.0, size - 1.0);
    let u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    let v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    let a = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice0 / size, v), 0.0).rgb;
    let d = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice1 / size, v), 0.0).rgb;
    return mix(a, d, b - slice0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    return vec4f(mix(color.rgb, sampleLut(color.rgb), mc.u_intensity), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createBlur(): ShaderHandle {
        const source = `#pragma shader "PP Blur"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(2) range(0,20)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 texelSize = u_viewport.zw;
    float offset = u_intensity;

    vec4 color = vec4(0.0);
    color += texture(u_texture, v_texCoord + vec2(-offset, -offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2( 0.0,   -offset) * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2( offset, -offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2(-offset,  0.0)   * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord)                                     * 0.25;
    color += texture(u_texture, v_texCoord + vec2( offset,  0.0)   * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2(-offset,  offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2( 0.0,    offset) * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2( offset,  offset) * texelSize) * 0.0625;

    fragColor = color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texelSize = tc.u_viewport.zw;
    let offset = mc.u_intensity;
    let uv = v.v_texCoord;

    var color = vec4f(0.0);
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset, -offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f( 0.0,    -offset) * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset, -offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset,  0.0)   * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv, 0.0)                                       * 0.25;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset,  0.0)   * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset,  offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f( 0.0,     offset) * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset,  offset) * texelSize, 0.0) * 0.0625;

    return color;
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createVignette(): ShaderHandle {
        const source = `#pragma shader "PP Vignette"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.6) range(0,1)
#pragma param u_softness float default(0.5) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float dist = length(uv);
    float vig = 1.0 - smoothstep(1.0 - u_softness, 1.0, dist);
    fragColor = vec4(color.rgb * mix(1.0, vig, u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let uv = v.v_texCoord * 2.0 - 1.0;
    let dist = length(uv);
    let vig = 1.0 - smoothstep(1.0 - mc.u_softness, 1.0, dist);
    return vec4f(color.rgb * mix(1.0, vig, mc.u_intensity), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createGrayscale(): ShaderHandle {
        const source = `#pragma shader "PP Grayscale"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(mix(color.rgb, vec3(gray), u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let gray = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    return vec4f(mix(color.rgb, vec3f(gray), mc.u_intensity), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createBloomExtract(): ShaderHandle {
        const source = `#pragma shader "PP Bloom Extract"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_threshold float default(0.4) range(0,2)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float knee = u_threshold * 0.5;
    float soft = brightness - u_threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    float contrib = max(soft, brightness - u_threshold);
    contrib /= max(brightness, 0.00001);
    fragColor = vec4(color.rgb * contrib, 1.0);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let brightness = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let knee = mc.u_threshold * 0.5;
    var soft = brightness - mc.u_threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    var contrib = max(soft, brightness - mc.u_threshold);
    contrib /= max(brightness, 0.00001);
    return vec4f(color.rgb * contrib, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createBloomKawase(iteration: number): ShaderHandle {
        const d = `(${iteration.toFixed(1)} + 0.5)`;
        const source = `#pragma shader "PP Bloom Kawase ${iteration.toFixed(0)}"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(1) range(0.5,5)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    float d = ${d} * max(u_radius, 0.5);
    vec2 ts = u_viewport.zw;
    fragColor = (
        texture(u_texture, v_texCoord + vec2(-d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2( d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2(-d,  d) * ts) +
        texture(u_texture, v_texCoord + vec2( d,  d) * ts)
    ) * 0.25;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let d = ${d} * max(mc.u_radius, 0.5);
    let ts = tc.u_viewport.zw;
    let uv = v.v_texCoord;
    return (
        textureSampleLevel(t0, s0, uv + vec2f(-d, -d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f( d, -d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f(-d,  d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f( d,  d) * ts, 0.0)
    ) * 0.25;
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createBloomComposite(): ShaderHandle {
        const source = `#pragma shader "PP Bloom Composite"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1.5) range(0,5)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
out vec4 fragColor;

void main() {
    vec4 blur = texture(u_texture, v_texCoord);
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    fragColor = vec4(scene.rgb + blur.rgb * u_intensity, scene.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let blur = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    return vec4f(scene.rgb + blur.rgb * mc.u_intensity, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createColorGrade(): ShaderHandle {
        const source = `#pragma shader "PP Color Grade"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_exposure float default(0) range(-3,3)
#pragma param u_contrast float default(1) range(0,2)
#pragma param u_saturation float default(1) range(0,2)
#pragma param u_temperature float default(0) range(-1,1)
#pragma param u_tint float default(0) range(-1,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec3 c = src.rgb;

    // Exposure (stops): 2^EV.
    c *= exp2(u_exposure);

    // White balance: warm/cool on R/B, green/magenta on G. Identity at 0.
    c.r *= 1.0 + u_temperature * 0.2;
    c.b *= 1.0 - u_temperature * 0.2;
    c.g *= 1.0 + u_tint * 0.2;

    // Contrast about mid-grey.
    c = (c - 0.5) * u_contrast + 0.5;

    // Saturation about Rec.709 luma.
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, u_saturation);

    fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    var c = src.rgb;

    c *= exp2(mc.u_exposure);

    c.r *= 1.0 + mc.u_temperature * 0.2;
    c.b *= 1.0 - mc.u_temperature * 0.2;
    c.g *= 1.0 + mc.u_tint * 0.2;

    c = (c - 0.5) * mc.u_contrast + 0.5;

    let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    c = mix(vec3f(luma), c, mc.u_saturation);

    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createChromaticAberration(): ShaderHandle {
        const source = `#pragma shader "PP Chromatic Aberration"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(3) range(0,20)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 offset = u_intensity * u_viewport.zw;
    float r = texture(u_texture, v_texCoord + offset).r;
    float g = texture(u_texture, v_texCoord).g;
    float b = texture(u_texture, v_texCoord - offset).b;
    float a = texture(u_texture, v_texCoord).a;
    fragColor = vec4(r, g, b, a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let offset = mc.u_intensity * tc.u_viewport.zw;
    let r = textureSampleLevel(t0, s0, v.v_texCoord + offset, 0.0).r;
    let g = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).g;
    let b = textureSampleLevel(t0, s0, v.v_texCoord - offset, 0.0).b;
    let a = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).a;
    return vec4f(r, g, b, a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createTonemap(): ShaderHandle {
        // The manual tonemap: the same acesFilmic() every fragment stage is given,
        // at a point of the stack's choosing and with an exposure. Carry this OR
        // PostProcess.setOutputTransform — the curve is not idempotent.
        const source = `#pragma shader "PP Tonemap"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_exposure float default(0) range(-3,3)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec3 c = src.rgb * exp2(u_exposure);
    fragColor = vec4(acesFilmic(c), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let c = src.rgb * exp2(mc.u_exposure);
    return vec4f(acesFilmic(c), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createFxaa(): ShaderHandle {
        // Luma-based FXAA (Lottes' classic edge-directed blur). Reads only the
        // built-in u_texture/u_viewport; u_intensity blends the AA result back
        // toward the original so 0 is an exact no-op.
        const source = `#pragma shader "PP FXAA"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

const float REDUCE_MIN = 1.0 / 128.0;
const float REDUCE_MUL = 1.0 / 8.0;
const float SPAN_MAX = 8.0;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec2 inv = u_viewport.zw;
    vec4 srcM = texture(u_texture, v_texCoord);
    vec3 rgbNW = texture(u_texture, v_texCoord + vec2(-1.0, -1.0) * inv).rgb;
    vec3 rgbNE = texture(u_texture, v_texCoord + vec2( 1.0, -1.0) * inv).rgb;
    vec3 rgbSW = texture(u_texture, v_texCoord + vec2(-1.0,  1.0) * inv).rgb;
    vec3 rgbSE = texture(u_texture, v_texCoord + vec2( 1.0,  1.0) * inv).rgb;

    float lM = luma(srcM.rgb);
    float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    vec2 dir;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.25 * REDUCE_MUL, REDUCE_MIN);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2(-SPAN_MAX), vec2(SPAN_MAX)) * inv;

    vec3 rgbA = 0.5 * (
        texture(u_texture, v_texCoord + dir * (1.0 / 3.0 - 0.5)).rgb +
        texture(u_texture, v_texCoord + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(u_texture, v_texCoord + dir * -0.5).rgb +
        texture(u_texture, v_texCoord + dir *  0.5).rgb);

    float lB = luma(rgbB);
    vec3 aa = (lB < lMin || lB > lMax) ? rgbA : rgbB;
    fragColor = vec4(mix(srcM.rgb, aa, clamp(u_intensity, 0.0, 1.0)), srcM.a);
}
#pragma end

#pragma fragment wgsl
const REDUCE_MIN = 1.0 / 128.0;
const REDUCE_MUL = 1.0 / 8.0;
const SPAN_MAX = 8.0;

fn luma(c : vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let inv = tc.u_viewport.zw;
    let uv = v.v_texCoord;
    let srcM = textureSampleLevel(t0, s0, uv, 0.0);
    let rgbNW = textureSampleLevel(t0, s0, uv + vec2f(-1.0, -1.0) * inv, 0.0).rgb;
    let rgbNE = textureSampleLevel(t0, s0, uv + vec2f( 1.0, -1.0) * inv, 0.0).rgb;
    let rgbSW = textureSampleLevel(t0, s0, uv + vec2f(-1.0,  1.0) * inv, 0.0).rgb;
    let rgbSE = textureSampleLevel(t0, s0, uv + vec2f( 1.0,  1.0) * inv, 0.0).rgb;

    let lM = luma(srcM.rgb);
    let lNW = luma(rgbNW);
    let lNE = luma(rgbNE);
    let lSW = luma(rgbSW);
    let lSE = luma(rgbSE);
    let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    var dir : vec2f;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    let reduce = max((lNW + lNE + lSW + lSE) * 0.25 * REDUCE_MUL, REDUCE_MIN);
    let rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2f(-SPAN_MAX), vec2f(SPAN_MAX)) * inv;

    let rgbA = 0.5 * (
        textureSampleLevel(t0, s0, uv + dir * (1.0 / 3.0 - 0.5), 0.0).rgb +
        textureSampleLevel(t0, s0, uv + dir * (2.0 / 3.0 - 0.5), 0.0).rgb);
    let rgbB = rgbA * 0.5 + 0.25 * (
        textureSampleLevel(t0, s0, uv + dir * -0.5, 0.0).rgb +
        textureSampleLevel(t0, s0, uv + dir *  0.5, 0.0).rgb);

    let lB = luma(rgbB);
    let aa = select(rgbB, rgbA, lB < lMin || lB > lMax);
    return vec4f(mix(srcM.rgb, aa, clamp(mc.u_intensity, 0.0, 1.0)), srcM.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createLensDistortion(): ShaderHandle {
        // Radial lens warp: u_strength > 0 barrels (bulge), < 0 pincushions;
        // u_zoom rescales to keep edges in frame. Identity at strength 0 / zoom 1
        // (sample uv == source uv). Out-of-source taps resolve to transparent
        const source = `#pragma shader "PP Lens Distortion"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_strength float default(0) range(-1,1)
#pragma param u_zoom float default(1) range(0.5,2)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    vec2 warped = uv * (1.0 + u_strength * r2) / max(u_zoom, 0.0001);
    vec2 suv = warped * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_texture, suv);
    }
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = v.v_texCoord * 2.0 - 1.0;
    let r2 = dot(uv, uv);
    let warped = uv * (1.0 + mc.u_strength * r2) / max(mc.u_zoom, 0.0001);
    let suv = warped * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
        return vec4f(0.0);
    }
    return textureSampleLevel(t0, s0, suv, 0.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createOutline(): ShaderHandle {
        // Ink-edge outline: Sobel edge detection on scene luma, darkening edge
        // pixels toward black — the classic full-screen 2D ink look.
        // u_intensity 0 is an exact no-op; u_threshold gates the edge magnitude
        const source = `#pragma shader "PP Outline"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_threshold float default(0.2) range(0,1)
#pragma param u_thickness float default(1) range(0.5,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

float lum(vec2 offset) {
    return dot(texture(u_texture, v_texCoord + offset).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 px = vec2(u_thickness) / u_viewport.xy;
    float tl = lum(vec2(-px.x,  px.y));
    float tt = lum(vec2( 0.0,   px.y));
    float tr = lum(vec2( px.x,  px.y));
    float ll = lum(vec2(-px.x,  0.0));
    float rr = lum(vec2( px.x,  0.0));
    float bl = lum(vec2(-px.x, -px.y));
    float bb = lum(vec2( 0.0,  -px.y));
    float br = lum(vec2( px.x, -px.y));
    float gx = (tr + 2.0 * rr + br) - (tl + 2.0 * ll + bl);
    float gy = (tl + 2.0 * tt + tr) - (bl + 2.0 * bb + br);
    float edge = clamp((sqrt(gx * gx + gy * gy) - u_threshold) * 4.0, 0.0, 1.0);
    fragColor = vec4(mix(src.rgb, vec3(0.0), edge * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
fn lum(uv : vec2f) -> f32 {
    return dot(textureSampleLevel(t0, s0, uv, 0.0).rgb, vec3f(0.299, 0.587, 0.114));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let px = vec2f(mc.u_thickness) / tc.u_viewport.xy;
    let tl = lum(v.v_texCoord + vec2f(-px.x,  px.y));
    let tt = lum(v.v_texCoord + vec2f( 0.0,   px.y));
    let tr = lum(v.v_texCoord + vec2f( px.x,  px.y));
    let ll = lum(v.v_texCoord + vec2f(-px.x,  0.0));
    let rr = lum(v.v_texCoord + vec2f( px.x,  0.0));
    let bl = lum(v.v_texCoord + vec2f(-px.x, -px.y));
    let bb = lum(v.v_texCoord + vec2f( 0.0,  -px.y));
    let br = lum(v.v_texCoord + vec2f( px.x, -px.y));
    let gx = (tr + 2.0 * rr + br) - (tl + 2.0 * ll + bl);
    let gy = (tl + 2.0 * tt + tr) - (bl + 2.0 * bb + br);
    let edge = clamp((sqrt(gx * gx + gy * gy) - mc.u_threshold) * 4.0, 0.0, 1.0);
    return vec4f(mix(src.rgb, vec3f(0.0), edge * mc.u_intensity), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createDepthOutline(): ShaderHandle {
        // The silhouette, not the shading: `outline` Sobels scene LUMA and draws
        // an edge wherever the picture changes, while this reads DEPTH, so an
        // edge is a place the geometry steps — at any contrast, including none.

        // Depth is compared as a RATIO, which is what makes one threshold hold
        // across the view: an absolute 0.001 is a wall up close and a kilometre
        // out. Fetched by texel — the pass is 1:1 and depth is not filterable.
        const source = `#pragma shader "PP Depth Outline"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_threshold float default(0.01) range(0.0005,0.2)
#pragma param u_thickness float default(1) range(1,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

float depthAt(ivec2 texel, ivec2 size) {
    return texelFetch(u_sceneDepth, clamp(texel, ivec2(0), size - ivec2(1)), 0).r;
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 here = ivec2(gl_FragCoord.xy);
    int step = int(max(u_thickness, 1.0));

    float d = depthAt(here, size);
    // Nothing was drawn here: the cleared far plane has no silhouette to find,
    // and testing it would ring the whole frame in an outline.
    if (d >= 1.0) { fragColor = src; return; }

    float dl = depthAt(here + ivec2(-step, 0), size);
    float dr = depthAt(here + ivec2( step, 0), size);
    float dd = depthAt(here + ivec2(0, -step), size);
    float du = depthAt(here + ivec2(0,  step), size);
    // The NEAREST neighbour only: an edge belongs to the surface in front, so
    // the far side of a silhouette does not get a second outline of its own.
    float far = max(max(dl, dr), max(dd, du));
    float edge = clamp(((far - d) / max(d, 1e-6) - u_threshold) * 20.0, 0.0, 1.0);
    fragColor = vec4(mix(src.rgb, vec3(0.0), edge * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
fn depthAt(texel : vec2i, size : vec2i) -> f32 {
    return textureLoad(t7, clamp(texel, vec2i(0), size - vec2i(1)), 0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let here = vec2i(v.pos.xy);
    let step = i32(max(mc.u_thickness, 1.0));

    let d = depthAt(here, size);
    if (d >= 1.0) { return src; }

    let dl = depthAt(here + vec2i(-step, 0), size);
    let dr = depthAt(here + vec2i( step, 0), size);
    let dd = depthAt(here + vec2i(0, -step), size);
    let du = depthAt(here + vec2i(0,  step), size);
    let far = max(max(dl, dr), max(dd, du));
    let edge = clamp(((far - d) / max(d, 1e-6) - mc.u_threshold) * 20.0, 0.0, 1.0);
    return vec4f(mix(src.rgb, vec3f(0.0), vec3f(edge * mc.u_intensity)), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createEdgeOutline(): ShaderHandle {
        // A line wherever the scene's SURFACE changes: where the depth steps (a silhouette, one thing in front of another) or the normal turns (a
        // crease, a fold, the edge of a face), in a colour of the author's choosing. `depthOutline` reads the depth alone and draws in black, so a cube
        // standing on a floor has only its outline; this finds its edges too, which is what an inked, toon look needs.
        //
        // Distance is the world distance from the camera, compared as a RATIO so one threshold holds across the view: the window depth the buffer
        // holds is nowhere near linear (a perspective view puts everything past the first few percent of its range within a hair of 1), so a ratio of
        // THAT finds no edge at all. The normal is the scene's own, written beside its colour by the shaders that write one (`#pragma gbuffer`):
        // a pixel nothing wrote one for takes part in the silhouette and not in the crease.
        const source = `#pragma shader "PP Edge Outline"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_depthThreshold float default(0.01) range(0.0005,0.2)
#pragma param u_normalThreshold float default(0.4) range(0.02,1.5)
#pragma param u_thickness float default(1) range(1,4)
#pragma param u_lineColor color default(0,0,0,1)
#pragma gbuffer

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
uniform sampler2D u_gbuffer;
out vec4 fragColor;

${SSAO_GLSL}
${GBUFFER_GLSL}

// How far the surface at a texel is from the camera: along the view ray for a perspective view, along the view axis for an orthographic one.
float viewDistance(ivec2 t, ivec2 size) {
    vec3 P = worldAt(t, size);
    return u_camera.w > 0.5 ? length(P - u_camera.xyz) : abs(dot(P, u_camera.xyz));
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 here = screenTexel(v_texCoord, size);
    int step = int(max(u_thickness, 1.0));

    // Nothing was drawn here: the cleared far plane has no silhouette to find, and testing it would ring the whole frame.
    if (depthAt(here, size) >= 1.0 || u_intensity <= 0.0) { fragColor = src; return; }
    float d = viewDistance(here, size);

    ivec2 offsets[4] = ivec2[4](ivec2(-step, 0), ivec2(step, 0), ivec2(0, -step), ivec2(0, step));
    Surface mine = readSurface(here);
    float around[4];
    float crease = 0.0;
    for (int i = 0; i < 4; ++i) {
        ivec2 at = here + offsets[i];
        // The cleared far plane beside a surface is a silhouette too, at the far side of anything: it counts as very far away.
        around[i] = depthAt(at, size) >= 1.0 ? d * 1000.0 : viewDistance(at, size);
        if (mine.known) {
            Surface other = readSurface(clamp(at, ivec2(0), size - ivec2(1)));
            // How far the two surfaces face apart; only between two that wrote a normal.
            if (other.known) crease = max(crease, 1.0 - dot(mine.normal, other.normal));
        }
    }
    // How much farther the two neighbours along an axis are than this pixel, on average: a step has it, and so does nothing else. A plane seen
    // at a grazing angle changes distance fast but steadily, which is no edge, and the far side of a step has nearer neighbours, which is no
    // second outline of its own.
    float lap = max((around[0] + around[1]) * 0.5 - d, (around[2] + around[3]) * 0.5 - d) / max(d, 1e-3);
    float silhouette = clamp((lap - u_depthThreshold) * 20.0, 0.0, 1.0);
    float fold = clamp((crease - u_normalThreshold) * 8.0, 0.0, 1.0);
    float edge = max(silhouette, fold) * u_intensity * u_lineColor.a;
    fragColor = vec4(mix(src.rgb, u_lineColor.rgb, edge), src.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${GBUFFER_WGSL}

fn viewDistance(t : vec2i, size : vec2i) -> f32 {
    let P = worldAt(t, size);
    if (frame.camera.w > 0.5) { return length(P - frame.camera.xyz); }
    return abs(dot(P, frame.camera.xyz));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let here = screenTexel(v.v_texCoord, size);
    let step = i32(max(mc.u_thickness, 1.0));

    if (depthAt(here, size) >= 1.0 || mc.u_intensity <= 0.0) { return src; }
    let d = viewDistance(here, size);

    let mine = readSurface(here);
    var around = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
    var crease = 0.0;
    for (var i : i32 = 0; i < 4; i = i + 1) {
        var offset = vec2i(0, 0);
        if (i == 0) { offset = vec2i(-step, 0); } else if (i == 1) { offset = vec2i(step, 0); } else if (i == 2) { offset = vec2i(0, -step); } else { offset = vec2i(0, step); }
        let at = here + offset;
        var reach = d * 1000.0;
        if (depthAt(at, size) < 1.0) { reach = viewDistance(at, size); }
        around[i] = reach;
        if (mine.known) {
            let other = readSurface(clamp(at, vec2i(0), size - vec2i(1)));
            if (other.known) { crease = max(crease, 1.0 - dot(mine.normal, other.normal)); }
        }
    }
    let lap = max((around[0] + around[1]) * 0.5 - d, (around[2] + around[3]) * 0.5 - d) / max(d, 1e-3);
    let silhouette = clamp((lap - mc.u_depthThreshold) * 20.0, 0.0, 1.0);
    let fold = clamp((crease - mc.u_normalThreshold) * 8.0, 0.0, 1.0);
    let edge = max(silhouette, fold) * mc.u_intensity * mc.u_lineColor.a;
    return vec4f(mix(src.rgb, mc.u_lineColor.rgb, vec3f(edge)), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createSharpen(): ShaderHandle {
        // The fragment version of the compute `sharpen`, for a device with no compute stage (WebGL2): the same arithmetic on the same five taps, so the two
        // draw the same picture. Each pixel is pushed away from the mean of its four neighbours by `u_intensity`, and held to the range those neighbours and
        // the pixel span, widened by `u_limit`: a flat area has nothing to push against and an edge cannot overshoot past what is on either side of it, which
        // is what a plain unsharp mask gets wrong. It runs on the chain's own (HDR) values.
        const source = `#pragma shader "PP Sharpen"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.5) range(0,2)
#pragma param u_limit float default(0.25) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec4 tap(ivec2 p, ivec2 size) {
    return texelFetch(u_texture, clamp(p, ivec2(0), size - ivec2(1)), 0);
}

void main() {
    ivec2 size = textureSize(u_texture, 0);
    ivec2 p = clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1));
    vec4 c = tap(p, size);
    vec3 n = tap(p + ivec2(0, -1), size).rgb;
    vec3 s = tap(p + ivec2(0, 1), size).rgb;
    vec3 w = tap(p + ivec2(-1, 0), size).rgb;
    vec3 e = tap(p + ivec2(1, 0), size).rgb;
    vec3 lo = min(min(min(n, s), min(w, e)), c.rgb);
    vec3 hi = max(max(max(n, s), max(w, e)), c.rgb);
    vec3 sharp = c.rgb + u_intensity * (4.0 * c.rgb - n - s - w - e);
    vec3 room = (hi - lo) * u_limit;
    sharp = clamp(sharp, lo - room, hi + room);
    fragColor = vec4(max(sharp, vec3(0.0)), c.a);
}
#pragma end

#pragma fragment wgsl
fn tap(p : vec2i, size : vec2i) -> vec4f {
    return textureLoad(t0, clamp(p, vec2i(0), size - vec2i(1)), 0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t0, 0));
    let p = clamp(vec2i(v.v_texCoord * vec2f(size)), vec2i(0), size - vec2i(1));
    let c = tap(p, size);
    let n = tap(p + vec2i(0, -1), size).rgb;
    let s = tap(p + vec2i(0, 1), size).rgb;
    let w = tap(p + vec2i(-1, 0), size).rgb;
    let e = tap(p + vec2i(1, 0), size).rgb;
    let lo = min(min(min(n, s), min(w, e)), c.rgb);
    let hi = max(max(max(n, s), max(w, e)), c.rgb);
    var sharp = c.rgb + mc.u_intensity * (4.0 * c.rgb - n - s - w - e);
    let room = (hi - lo) * mc.u_limit;
    sharp = clamp(sharp, lo - room, hi + room);
    return vec4f(max(sharp, vec3f(0.0)), c.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createPixelate(): ShaderHandle {
        // Snaps sampling to a grid of u_pixelSize-device-pixel blocks — the
        // canonical retro/mosaic 2D look. u_pixelSize <= 1 samples per-texel
        // (identity). Uses the injected u_viewport for block sizing.
        const source = `#pragma shader "PP Pixelate"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_pixelSize float default(4) range(1,64)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 blocks = u_viewport.xy / max(u_pixelSize, 1.0);
    vec2 uv = (floor(v_texCoord * blocks) + 0.5) / blocks;
    fragColor = texture(u_texture, uv);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let blocks = tc.u_viewport.xy / max(mc.u_pixelSize, 1.0);
    let uv = (floor(v.v_texCoord * blocks) + 0.5) / blocks;
    return textureSampleLevel(t0, s0, uv, 0.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },
    createPalette(): ShaderHandle {
        // Every pixel becomes the nearest colour of a palette read from a strip image (one colour a pixel, up to 64), after an ordered dither
        // that spreads the choice between neighbouring colours so a gradient reads as a pattern and not a band. The nearest is found in sRGB,
        // the space a palette is authored in, with the weights of the "redmean" distance.
        const source = `#pragma shader "PP Palette"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_strength float default(1) range(0,1)
#pragma param u_dither float default(0.5) range(0,1)
#pragma param u_ditherScale float default(1) range(1,16)
#pragma param u_palette texture default(white) texel(data)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec3 palToSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 palToLinear(vec3 c) { return mix(c / 12.92, pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer8(vec2 a) { return (bayer2(0.25 * a) * 0.25 + bayer2(0.5 * a)) * 0.25 + bayer2(a); }

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    int n = min(textureSize(u_palette, 0).x, 64);
    if (n <= 1) { fragColor = src; return; }
    vec3 c = src.rgb;
#ifdef ES_LINEAR
    c = palToSrgb(c);
#endif
    vec2 px = floor(v_texCoord * u_viewport.xy / max(u_ditherScale, 1.0));
    vec3 aim = clamp(c + (bayer8(px) - 0.5) * u_dither * 0.25, 0.0, 1.0);
    vec3 best = c;
    float bestD = 1e9;
    for (int i = 0; i < n; i++) {
        vec3 p = texelFetch(u_palette, ivec2(i, 0), 0).rgb;
        vec3 d = aim - p;
        float m = (aim.r + p.r) * 0.5;
        float dist = (2.0 + m) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - m) * d.b * d.b;
        if (dist < bestD) { bestD = dist; best = p; }
    }
    vec3 outc = mix(c, best, u_strength);
#ifdef ES_LINEAR
    outc = palToLinear(outc);
#endif
    fragColor = vec4(outc, src.a);
}
#pragma end

#pragma fragment wgsl
fn palToSrgb(c : vec3f) -> vec3f { return mix(c * 12.92, 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), c)); }
fn palToLinear(c : vec3f) -> vec3f { return mix(c / 12.92, pow((max(c, vec3f(0.0)) + 0.055) / 1.055, vec3f(2.4)), step(vec3f(0.04045), c)); }
fn bayer2(a0 : vec2f) -> f32 { let a = floor(a0); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
fn bayer8(a : vec2f) -> f32 { return (bayer2(0.25 * a) * 0.25 + bayer2(0.5 * a)) * 0.25 + bayer2(a); }

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let n = min(i32(textureDimensions(u_palette).x), 64);
    if (n <= 1) { return src; }
    var c = src.rgb;
#ifdef ES_LINEAR
    c = palToSrgb(c);
#endif
    let px = floor(v.v_texCoord * tc.u_viewport.xy / max(mc.u_ditherScale, 1.0));
    let aim = clamp(c + (bayer8(px) - 0.5) * mc.u_dither * 0.25, vec3f(0.0), vec3f(1.0));
    var best = c;
    var bestD = 1e9;
    for (var i = 0; i < n; i = i + 1) {
        let p = textureLoad(u_palette, vec2i(i, 0), 0).rgb;
        let d = aim - p;
        let m = (aim.r + p.r) * 0.5;
        let dist = (2.0 + m) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - m) * d.b * d.b;
        if (dist < bestD) { bestD = dist; best = p; }
    }
    var outc = mix(c, best, mc.u_strength);
#ifdef ES_LINEAR
    outc = palToLinear(outc);
#endif
    return vec4f(outc, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};

export function registerBasicEffectSources(): void {
    registerComputeSource('sharpen', SHARPEN_WGSL);
    registerEffectSources(basicEffects);
    registerEffectSources(lensEffects);
}
