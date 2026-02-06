/**
 * @file    postprocess.ts
 * @brief   Post-processing effects API
 * @details Provides full-screen post-processing effects like blur, vignette, etc.
 */

import type { ESEngineModule } from './wasm';
import type { ShaderHandle, Vec4 } from './material';
import { Material } from './material';

// =============================================================================
// Internal State
// =============================================================================

let module: ESEngineModule | null = null;

// =============================================================================
// Initialization
// =============================================================================

export function initPostProcessAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
}

export function shutdownPostProcessAPI(): void {
    if (module && PostProcess.isInitialized()) {
        PostProcess.shutdown();
    }
    module = null;
}

// =============================================================================
// PostProcess API
// =============================================================================

function getModule(): ESEngineModule {
    if (!module) {
        throw new Error('PostProcess API not initialized. Call initPostProcessAPI() first.');
    }
    return module;
}

export const PostProcess = {
    /**
     * Initializes the post-processing pipeline.
     * @param width Framebuffer width
     * @param height Framebuffer height
     * @returns True on success
     */
    init(width: number, height: number): boolean {
        return getModule().postprocess_init(width, height);
    },

    /**
     * Shuts down the post-processing pipeline.
     */
    shutdown(): void {
        getModule().postprocess_shutdown();
    },

    /**
     * Resizes the framebuffers.
     * @param width New width
     * @param height New height
     */
    resize(width: number, height: number): void {
        getModule().postprocess_resize(width, height);
    },

    /**
     * Adds a post-processing pass.
     * @param name Unique name for the pass
     * @param shader Shader handle
     * @returns Pass index
     */
    addPass(name: string, shader: ShaderHandle): number {
        return getModule().postprocess_addPass(name, shader);
    },

    /**
     * Removes a pass by name.
     * @param name Pass name
     */
    removePass(name: string): void {
        getModule().postprocess_removePass(name);
    },

    /**
     * Enables or disables a pass.
     * @param name Pass name
     * @param enabled Whether to enable the pass
     */
    setEnabled(name: string, enabled: boolean): void {
        getModule().postprocess_setPassEnabled(name, enabled);
    },

    /**
     * Checks if a pass is enabled.
     * @param name Pass name
     * @returns True if enabled
     */
    isEnabled(name: string): boolean {
        return getModule().postprocess_isPassEnabled(name);
    },

    /**
     * Sets a float uniform on a pass.
     * @param passName Pass name
     * @param uniform Uniform name
     * @param value Float value
     */
    setUniform(passName: string, uniform: string, value: number): void {
        getModule().postprocess_setUniformFloat(passName, uniform, value);
    },

    /**
     * Sets a vec4 uniform on a pass.
     * @param passName Pass name
     * @param uniform Uniform name
     * @param value Vec4 value
     */
    setUniformVec4(passName: string, uniform: string, value: Vec4): void {
        getModule().postprocess_setUniformVec4(passName, uniform, value.x, value.y, value.z, value.w);
    },

    /**
     * Begins rendering to the post-process pipeline.
     * Call this before rendering your scene.
     */
    begin(): void {
        getModule().postprocess_begin();
    },

    /**
     * Ends and processes all passes.
     * Call this after rendering your scene.
     */
    end(): void {
        getModule().postprocess_end();
    },

    /**
     * Gets the number of passes.
     */
    getPassCount(): number {
        return getModule().postprocess_getPassCount();
    },

    /**
     * Checks if the pipeline is initialized.
     */
    isInitialized(): boolean {
        if (!module) return false;
        return module.postprocess_isInitialized();
    },

    /**
     * Sets bypass mode to skip FBO rendering entirely.
     * When bypassed, begin()/end() become no-ops and scene renders directly to screen.
     * Use this when no post-processing passes are needed for maximum performance.
     * @param bypass Whether to bypass the pipeline
     */
    setBypass(bypass: boolean): void {
        getModule().postprocess_setBypass(bypass);
    },

    /**
     * Checks if bypass mode is enabled.
     * @returns True if bypassed
     */
    isBypassed(): boolean {
        if (!module) return true;
        return module.postprocess_isBypassed();
    },

    // =========================================================================
    // Built-in Effects
    // =========================================================================

    /**
     * Creates a blur effect shader.
     * @returns Shader handle
     */
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

    /**
     * Creates a vignette effect shader.
     * @returns Shader handle
     */
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
    float vignette = smoothstep(u_intensity, u_intensity - u_softness, dist);
    fragColor = vec4(color.rgb * vignette, color.a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },

    /**
     * Creates a grayscale effect shader.
     * @returns Shader handle
     */
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

    /**
     * Creates a chromatic aberration effect shader.
     * @returns Shader handle
     */
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

// =============================================================================
// Shared Vertex Shader
// =============================================================================

const POSTPROCESS_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
