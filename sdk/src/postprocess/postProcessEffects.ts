// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    postProcessEffects.ts
 * @brief   Stateless post-process shader factories.
 * @details Pure Material.createShader builders, extracted verbatim from the
 *          former four-in-one PostProcess object. No state, no per-App, no
 *          module — just shader source. (B2b: slim the god-object.)
 */
import type { ShaderHandle } from '../material';
import { Material } from '../material';
import { POSTPROCESS_VERTEX } from './shaders';

export const postProcessEffects = {
    createBlur(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_intensity;
out vec4 fragColor;

void main() {
    vec2 texelSize = 1.0 / u_resolution;
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
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    createVignette(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_intensity;
uniform float u_softness;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float dist = length(uv);
    float vig = 1.0 - smoothstep(1.0 - u_softness, 1.0, dist);
    fragColor = vec4(color.rgb * mix(1.0, vig, u_intensity), color.a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    createGrayscale(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_intensity;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(mix(color.rgb, vec3(gray), u_intensity), color.a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    createBloomExtract(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_threshold;
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
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    createBloomKawase(iteration: number): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_radius;
out vec4 fragColor;

void main() {
    float d = (${iteration.toFixed(1)} + 0.5) * max(u_radius, 0.5);
    vec2 ts = 1.0 / u_resolution;
    fragColor = (
        texture(u_texture, v_texCoord + vec2(-d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2( d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2(-d,  d) * ts) +
        texture(u_texture, v_texCoord + vec2( d,  d) * ts)
    ) * 0.25;
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    createBloomComposite(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform float u_intensity;
out vec4 fragColor;

void main() {
    vec4 blur = texture(u_texture, v_texCoord);
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    fragColor = vec4(scene.rgb + blur.rgb * u_intensity, scene.a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    createColorGrade(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_exposure;     // stops; 0 = unchanged
uniform float u_contrast;     // 1 = unchanged
uniform float u_saturation;   // 1 = unchanged
uniform float u_temperature;  // -1 cool .. +1 warm
uniform float u_tint;         // -1 green .. +1 magenta
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
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    createChromaticAberration(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_intensity;
out vec4 fragColor;

void main() {
    vec2 offset = u_intensity / u_resolution;
    float r = texture(u_texture, v_texCoord + offset).r;
    float g = texture(u_texture, v_texCoord).g;
    float b = texture(u_texture, v_texCoord - offset).b;
    float a = texture(u_texture, v_texCoord).a;
    fragColor = vec4(r, g, b, a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },
};
