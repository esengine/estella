// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    postProcessEffects.ts
 * @brief   Stateless post-process shader factories.
 * @details Fragment-only `.esshader` sources on the reflected `#pragma param`
 *          seam (domain PostProcess: the engine injects the canonical
 *          fullscreen vertex stage), each with a `#pragma fragment wgsl` twin
 *          so every effect compiles on the WebGPU backend. Conventions: the
 *          pass input is the loose `u_texture` sampler (unit 0; t0/s0 in the
 *          twin), the untouched scene `u_sceneTexture` (unit 1; t1/s1), LUT
 *          textures are texture params at their reflected material units, and
 *          resolution comes from the injected `u_viewport` (xy = pixels,
 *          zw = 1/pixels) instead of a per-pass upload.
 */
import type { ShaderHandle } from '../material';
import { Material } from '../material';

export const postProcessEffects = {
    createLutGrade(): ShaderHandle {
        // True LUT color grading: a 2D-packed 32^3 LUT (1024x32 — 32 slices of
        // 32x32 laid out along X; slice index = blue). Sampled twice around the
        // blue coordinate and mixed, giving trilinear-quality grading from a
        // plain PNG. The LUT texture binds via the pass's texture params
        // (PostProcessVolume `textures: { u_lut: <ref> }`).
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
#pragma param u_threshold float default(0.4) range(0,1)

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
        // ACES filmic curve (Narkowicz approximation) — maps HDR/linear scene
        // radiance into a display range with a filmic shoulder/toe. Unlike the
        // grade/blur effects this always reshapes the curve (that is the point of
        // tonemapping); only the exposure pre-multiply is identity at its default.
        const source = `#pragma shader "PP Tonemap"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_exposure float default(0) range(-3,3)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec3 aces(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec3 c = src.rgb * exp2(u_exposure);
    fragColor = vec4(aces(c), src.a);
}
#pragma end

#pragma fragment wgsl
fn aces(x : vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let c = src.rgb * exp2(mc.u_exposure);
    return vec4f(aces(c), src.a);
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
        // black so a warped edge does not smear.
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
        // (higher = only hard silhouettes); u_thickness is the Sobel tap offset
        // in device pixels (via the injected u_viewport).
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
};
