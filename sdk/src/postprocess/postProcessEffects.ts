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
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';

/**
 * Depth-reading helpers the three SSAO passes share, in both languages. One
 * definition each: a fix that reached only the first of three copies compiled
 * fine and drew a black screen.
 */
const SSAO_GLSL = `/// A SCREEN texel: +y up, origin bottom-left, and the same number on both
/// backends. Its inverse round-trips through a uv, which is backend-independent
/// because one vertex stage serves both.
ivec2 screenTexel(vec2 uv, ivec2 size) {
    return clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
}
vec2 uvOfTexel(ivec2 t, ivec2 size) {
    return (vec2(t) + 0.5) / vec2(size);
}
/// The one place the row order matters: GL numbers rows from the BOTTOM, so a
/// screen texel is already the row.
float depthAt(ivec2 t, ivec2 size) {
    ivec2 q = clamp(t, ivec2(0), size - ivec2(1));
    return texelFetch(u_sceneDepth, q, 0).r;
}
vec3 worldAt(ivec2 t, ivec2 size) {
    ivec2 q = clamp(t, ivec2(0), size - ivec2(1));
    return worldFromDepth(uvOfTexel(q, size), depthAt(q, size));
}
/// World distance along the view ray per unit of window depth, at THIS pixel.
/// One derivative here replaces an un-projection per tap. Measured rather than
/// assumed, so it holds for both projections.
float worldPerDepth(vec2 uv, float d, vec3 P) {
    float e = max((1.0 - d) * 0.01, 1e-5);
    // Signed so the probe stays inside the depth range at the far plane.
    float de = d + e > 1.0 ? -e : e;
    return length(worldFromDepth(uv, d + de) - P) / abs(de);
}`;

const SSAO_WGSL = `fn screenTexel(uv : vec2f, size : vec2i) -> vec2i {
    return clamp(vec2i(uv * vec2f(size)), vec2i(0), size - vec2i(1));
}
fn uvOfTexel(t : vec2i, size : vec2i) -> vec2f {
    return (vec2f(t) + 0.5) / vec2f(size);
}
// The one place the row order matters: row 0 is the TOP here and the BOTTOM on
// GL, so a screen texel is the mirrored row.
fn depthAt(t : vec2i, size : vec2i) -> f32 {
    let q = clamp(t, vec2i(0), size - vec2i(1));
    return textureLoad(t7, vec2i(q.x, size.y - 1 - q.y), 0);
}
fn worldAt(t : vec2i, size : vec2i) -> vec3f {
    let q = clamp(t, vec2i(0), size - vec2i(1));
    return worldFromDepth(uvOfTexel(q, size), depthAt(q, size));
}
fn worldPerDepth(uv : vec2f, d : f32, P : vec3f) -> f32 {
    let e = max((1.0 - d) * 0.01, 1e-5);
    var e2 = e;
    if (d + e > 1.0) { e2 = -e; }
    return length(worldFromDepth(uv, d + e2) - P) / abs(e2);
}`;

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

    createDistanceFog(): ShaderHandle {
        // Fog is a DISTANCE and a depth sample is not one: the same 0.9 is a
        // metre away up close and a hundred out. `worldFromDepth` (injected with
        // FrameConstants) puts the sample back in the world, so one setting holds.

        // The cleared far plane is not a surface — it is the absence of one, and
        // fogging it to full would paint the sky the fog colour at any range.
        const source = `#pragma shader "PP Distance Fog"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_fogColor color default(0.6,0.68,0.78,1)
#pragma param u_fogNear float default(10) range(0,500)
#pragma param u_fogFar float default(60) range(0,500)
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    float depth = texelFetch(u_sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
    if (depth >= 1.0) { fragColor = src; return; }

    // Un-projected twice, at the sample and at the near plane along the SAME ray.
    // An orthographic eye has no point to measure from, and this needs none: the
    // near plane is one, per pixel, and it is where fog should start anyway.
    vec3 world = worldFromDepth(v_texCoord, depth);
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    float dist = length(world - entry);
    float t = clamp((dist - u_fogNear) / max(u_fogFar - u_fogNear, 1e-4), 0.0, 1.0);
    fragColor = vec4(mix(src.rgb, u_fogColor.rgb, t * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let depth = textureLoad(t7, vec2i(v.pos.xy), 0);
    if (depth >= 1.0) { return src; }

    let world = worldFromDepth(v.v_texCoord, depth);
    let entry = worldFromDepth(v.v_texCoord, 0.0);
    let dist = length(world - entry);
    let t = clamp((dist - mc.u_fogNear) / max(mc.u_fogFar - mc.u_fogNear, 1e-4), 0.0, 1.0);
    return vec4f(mix(src.rgb, mc.u_fogColor.rgb, vec3f(t * mc.u_intensity)), src.a);
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

    /**
     * SSAO, pass 1 of 4: the occlusion term, at half resolution. No G-buffer —
     * scene depth and the injected `worldFromDepth` are the whole input, and
     * positions come back in WORLD space, so the radius is a world length.
     * Coordinates are SCREEN texels (+y up); only `depthAt` knows the row order.
     */
    createSsaoAo(): ShaderHandle {
        const source = `#pragma shader "PP SSAO"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(60) range(1,400)
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_bias float default(0.12) range(0,0.6)
#pragma param u_power float default(1.6) range(0.5,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const int K = 12;
const float TAU = 6.28318530718;

void main() {
    // Depth is full resolution and this pass is not, so the texel comes from the
    // uv — gl_FragCoord here counts THIS pass's smaller grid.
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    // The cleared far plane is the absence of a surface: nothing there is
    // occluded, and shading it would ring the sky in grey.
    if (d >= 1.0) { fragColor = vec4(1.0); return; }

    // The TEXEL CENTRE, not this pass's uv: at half resolution they differ by
    // half a depth texel, and the tangents below are one texel long. Mixing the
    // two conventions reconstructs noise instead of a normal.
    vec2 cuv = uvOfTexel(c, size);
    vec3 P = worldFromDepth(cuv, d);

    // The NEARER neighbour on each axis. Across a silhouette the far side is a
    // different surface, and a centred derivative would average the two into a
    // normal facing neither — the smeared ring a naive reconstruction leaves.
    float dl = depthAt(c + ivec2(-1, 0), size);
    float dr = depthAt(c + ivec2( 1, 0), size);
    float dd = depthAt(c + ivec2(0, -1), size);
    float du = depthAt(c + ivec2(0,  1), size);
    vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P
                                        : P - worldAt(c + ivec2(-1, 0), size);
    vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P
                                        : P - worldAt(c + ivec2(0, -1), size);
    vec3 N = normalize(cross(ax, ay));
    // Which side each pick came from decides the sign of the cross; the camera
    // settles it, because a visible surface faces the eye.
    if (dot(N, viewDirection(P)) < 0.0) N = -N;

    // A world radius spans different pixel counts near and far. One texel step
    // un-projected AT THIS DEPTH measures that scale without a projection matrix
    // or a neighbour's geometry. The ceiling is the bandwidth budget.
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(size.x), 0.0), d) - P), 1e-6);
    float radiusTexels = clamp(u_radius / worldPerTexel, 2.0, 96.0);

    // A 4x4 rotation scrambled by a factor coprime to 16, so the blur averages a
    // pattern and not a band. Keyed to THIS pass's pixel — c counts full-res
    // texels, and raw it would give a half-res pass every other phase.
    ivec2 rp = c / 2;
    int idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    float rot = float(idx - (idx / 16) * 16) * (TAU / 16.0);

    // Every sample votes equally: the result is the fraction of the
    // neighbourhood closed off. Weighting near taps louder is the tempting
    // mistake — they land back on this surface and would vote OPEN loudest.
    float occl = 0.0;
    for (int i = 0; i < K; ++i) {
        float a = (float(i) + 0.5) / float(K);
        float ang = a * 7.0 * TAU + rot;
        vec2 off = vec2(cos(ang), sin(ang)) * (a * radiusTexels);
        ivec2 st = c + ivec2(floor(off + 0.5));
        float ds = depthAt(st, size);
        // Sky: nothing in that direction, so it votes OPEN by contributing
        // nothing. This is what lightens the top of a wall toward its edge.
        if (ds >= 1.0) continue;

        // Measured in radii, so the estimator keeps its shape when the radius
        // changes and u_bias keeps one meaning.
        vec3 u = (worldAt(st, size) - P) / max(u_radius, 1e-4);
        float uu = dot(u, u);
        // Elevation above the tangent plane, less the bias that stops a flat
        // surface from occluding itself into grey.
        float sinE = dot(u, N) / max(sqrt(uu), 1e-6);
        // Beyond the radius a sample is a different surface, not an occluder:
        // this is what stops a silhouette haloing what is behind it. Faded, not
        // cut, or the term pops as geometry crosses the edge under camera motion.
        float range = 1.0 - smoothstep(0.6, 1.0, uu);
        occl += max(sinE - u_bias, 0.0) * range;
    }

    float ao = 1.0 - clamp(occl / float(K) * u_intensity, 0.0, 1.0);
    fragColor = vec4(vec3(pow(ao, u_power)), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const K : i32 = 12;
const TAU : f32 = 6.28318530718;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    if (d >= 1.0) { return vec4f(1.0); }

    let cuv = uvOfTexel(c, size);
    let P = worldFromDepth(cuv, d);

    let dl = depthAt(c + vec2i(-1, 0), size);
    let dr = depthAt(c + vec2i( 1, 0), size);
    let dd = depthAt(c + vec2i(0, -1), size);
    let du = depthAt(c + vec2i(0,  1), size);
    var ax = P - worldAt(c + vec2i(-1, 0), size);
    if (abs(dr - d) < abs(dl - d)) { ax = worldAt(c + vec2i(1, 0), size) - P; }
    var ay = P - worldAt(c + vec2i(0, -1), size);
    if (abs(du - d) < abs(dd - d)) { ay = worldAt(c + vec2i(0, 1), size) - P; }
    var N = normalize(cross(ax, ay));
    if (dot(N, viewDirection(P)) < 0.0) { N = -N; }

    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(size.x), 0.0), d) - P), 1e-6);
    let radiusTexels = clamp(mc.u_radius / worldPerTexel, 2.0, 96.0);

    let rp = c / 2;
    let idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    let rot = f32(idx - (idx / 16) * 16) * (TAU / 16.0);

    var occl = 0.0;
    for (var i : i32 = 0; i < K; i = i + 1) {
        let a = (f32(i) + 0.5) / f32(K);
        let ang = a * 7.0 * TAU + rot;
        let off = vec2f(cos(ang), sin(ang)) * (a * radiusTexels);
        let st = c + vec2i(floor(off + 0.5));
        let ds = depthAt(st, size);
        if (ds >= 1.0) { continue; }

        let u = (worldAt(st, size) - P) / max(mc.u_radius, 1e-4);
        let uu = dot(u, u);
        let sinE = dot(u, N) / max(sqrt(uu), 1e-6);
        let range = 1.0 - smoothstep(0.6, 1.0, uu);
        occl = occl + max(sinE - mc.u_bias, 0.0) * range;
    }

    let ao = 1.0 - clamp(occl / f32(K) * mc.u_intensity, 0.0, 1.0);
    return vec4f(vec3f(pow(ao, mc.u_power)), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * SSAO, passes 2 and 3: a separable blur that will not cross a depth edge,
     * or a contact shadow ends up on the wall behind. Each tap is weighted by
     * its gap ALONG THE VIEW RAY in world units against the pixel's own scale,
     * so one constant holds near and far where a raw depth compare would not.
     */
    createSsaoBlur(axis: 0 | 1): ShaderHandle {
        const step = axis === 0 ? 'vec2(1.0, 0.0)' : 'vec2(0.0, 1.0)';
        const stepW = axis === 0 ? 'vec2f(1.0, 0.0)' : 'vec2f(0.0, 1.0)';
        const source = `#pragma shader "PP SSAO Blur ${axis.toFixed(0)}"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const int R = 3;
/// A tap whose view-ray gap exceeds this many texel-widths is another surface.
const float SLOPE = 4.0;

void main() {
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 hsize = textureSize(u_texture, 0);
    ivec2 dc = screenTexel(v_texCoord, dsize);
    float d = depthAt(dc, dsize);
    if (d >= 1.0) { fragColor = texture(u_texture, v_texCoord); return; }

    vec2 cuv = uvOfTexel(dc, dsize);
    vec3 P = worldFromDepth(cuv, d);
    // The pixel's own world scale, from one texel step at ITS depth — the same
    // measure the AO pass sizes its radius with.
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(dsize.x), 0.0), d) - P), 1e-6);
    float tol = worldPerTexel * SLOPE;
    float perDepth = worldPerDepth(cuv, d, P);

    vec2 stepUv = ${step} / vec2(hsize);
    float sum = 0.0;
    float wsum = 0.0;
    for (int i = -R; i <= R; ++i) {
        vec2 uv = v_texCoord + stepUv * float(i);
        float g = exp(-float(i * i) / 8.0);

        ivec2 dt = screenTexel(uv, dsize);
        float dj = depthAt(dt, dsize);
        // Off the far plane there is no surface to agree with; the Gaussian
        // alone would let the sky pull the edge of a silhouette toward white.
        float w = dj >= 1.0 ? 0.0
                            : g * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        sum += texture(u_texture, uv).r * w;
        wsum += w;
    }
    // Every neighbour rejected (a one-pixel sliver): keep this pixel's own value
    // rather than dividing by nothing.
    float ao = wsum > 1e-5 ? sum / wsum : texture(u_texture, v_texCoord).r;
    fragColor = vec4(vec3(ao), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const R : i32 = 3;
const SLOPE : f32 = 4.0;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let dsize = vec2i(textureDimensions(t7, 0));
    let hsize = vec2i(textureDimensions(t0, 0));
    let dc = screenTexel(v.v_texCoord, dsize);
    let d = depthAt(dc, dsize);
    if (d >= 1.0) { return textureSampleLevel(t0, s0, v.v_texCoord, 0.0); }

    let cuv = uvOfTexel(dc, dsize);
    let P = worldFromDepth(cuv, d);
    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(dsize.x), 0.0), d) - P), 1e-6);
    let tol = worldPerTexel * SLOPE;
    let perDepth = worldPerDepth(cuv, d, P);

    let stepUv = ${stepW} / vec2f(hsize);
    var sum = 0.0;
    var wsum = 0.0;
    for (var i : i32 = -R; i <= R; i = i + 1) {
        let uv = v.v_texCoord + stepUv * f32(i);
        let g = exp(-f32(i * i) / 8.0);

        let dt = screenTexel(uv, dsize);
        let dj = depthAt(dt, dsize);
        var w = 0.0;
        if (dj < 1.0) {
            w = g * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        }
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).r * w;
        wsum = wsum + w;
    }
    var ao = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).r;
    if (wsum > 1e-5) { ao = sum / wsum; }
    return vec4f(vec3f(ao), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * SSAO, pass 4 of 4: upsample the half-resolution term and apply it. Plain
     * bilinear would undo the blur's care — a half-res texel straddling a
     * silhouette bleeds back across it — so the four candidates carry the same
     * view-ray gap weight. The scene arrives at unit 1, as bloom's composite.
     */
    createSsaoComposite(): ShaderHandle {
        const source = `#pragma shader "PP SSAO Composite"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const float SLOPE = 4.0;

void main() {
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 dc = screenTexel(v_texCoord, dsize);
    float d = depthAt(dc, dsize);
    if (d >= 1.0) { fragColor = scene; return; }

    vec2 cuv = uvOfTexel(dc, dsize);
    vec3 P = worldFromDepth(cuv, d);
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(dsize.x), 0.0), d) - P), 1e-6);
    float tol = worldPerTexel * SLOPE;
    float perDepth = worldPerDepth(cuv, d, P);

    // The four half-resolution texels this pixel falls between, in SCREEN texel
    // space so the bilinear weights mean the same on both backends.
    ivec2 hsize = textureSize(u_texture, 0);
    vec2 hf = v_texCoord * vec2(hsize) - 0.5;
    ivec2 base = ivec2(floor(hf));
    vec2 frac = hf - vec2(base);

    float sum = 0.0;
    float wsum = 0.0;
    for (int j = 0; j < 4; ++j) {
        ivec2 o = ivec2(j & 1, j >> 1);
        ivec2 t = clamp(base + o, ivec2(0), hsize - ivec2(1));
        vec2 uv = uvOfTexel(t, hsize);
        float bw = (o.x == 1 ? frac.x : 1.0 - frac.x) * (o.y == 1 ? frac.y : 1.0 - frac.y);

        ivec2 dt = screenTexel(uv, dsize);
        float dj = depthAt(dt, dsize);
        float w = dj >= 1.0 ? 0.0
                            : bw * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        sum += texture(u_texture, uv).r * w;
        wsum += w;
    }
    // No candidate agreed: this pixel is its own sliver, so take the term
    // straight rather than leaving it unshaded.
    float ao = wsum > 1e-5 ? sum / wsum : texture(u_texture, v_texCoord).r;
    fragColor = vec4(scene.rgb * ao, scene.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const SLOPE : f32 = 4.0;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let dsize = vec2i(textureDimensions(t7, 0));
    let dc = screenTexel(v.v_texCoord, dsize);
    let d = depthAt(dc, dsize);
    if (d >= 1.0) { return scene; }

    let cuv = uvOfTexel(dc, dsize);
    let P = worldFromDepth(cuv, d);
    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(dsize.x), 0.0), d) - P), 1e-6);
    let tol = worldPerTexel * SLOPE;
    let perDepth = worldPerDepth(cuv, d, P);

    let hsize = vec2i(textureDimensions(t0, 0));
    let hf = v.v_texCoord * vec2f(hsize) - 0.5;
    let base = vec2i(floor(hf));
    let frac = hf - vec2f(base);

    var sum = 0.0;
    var wsum = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let o = vec2i(j & 1, j >> 1);
        let t = clamp(base + o, vec2i(0), hsize - vec2i(1));
        let uv = uvOfTexel(t, hsize);
        var bwx = 1.0 - frac.x;
        if (o.x == 1) { bwx = frac.x; }
        var bwy = 1.0 - frac.y;
        if (o.y == 1) { bwy = frac.y; }
        let bw = bwx * bwy;

        let dt = screenTexel(uv, dsize);
        let dj = depthAt(dt, dsize);
        var w = 0.0;
        if (dj < 1.0) {
            w = bw * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        }
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).r * w;
        wsum = wsum + w;
    }
    var ao = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).r;
    if (wsum > 1e-5) { ao = sum / wsum; }
    return vec4f(scene.rgb * ao, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};
