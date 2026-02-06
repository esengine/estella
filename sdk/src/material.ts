/**
 * @file    material.ts
 * @brief   Material and Shader API for custom rendering
 * @details Provides shader creation and material management for custom visual effects.
 */

import type { ESEngineModule, CppResourceManager } from './wasm';
import type { Vec2, Vec3, Vec4 } from './types';
import { BlendMode } from './blend';

export type { Vec2, Vec3, Vec4 } from './types';

// =============================================================================
// Types
// =============================================================================

export type ShaderHandle = number;
export type MaterialHandle = number;

export type UniformValue = number | Vec2 | Vec3 | Vec4 | number[];

export interface MaterialOptions {
    shader: ShaderHandle;
    uniforms?: Record<string, UniformValue>;
    blendMode?: BlendMode;
    depthTest?: boolean;
}

interface MaterialData {
    shader: ShaderHandle;
    uniforms: Map<string, UniformValue>;
    blendMode: BlendMode;
    depthTest: boolean;
}

// =============================================================================
// Internal State
// =============================================================================

let module: ESEngineModule | null = null;
let resourceManager: CppResourceManager | null = null;
let nextMaterialId = 1;
const materials = new Map<MaterialHandle, MaterialData>();

// =============================================================================
// Initialization
// =============================================================================

export function initMaterialAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
    resourceManager = wasmModule.getResourceManager();
}

export function shutdownMaterialAPI(): void {
    materials.clear();
    nextMaterialId = 1;
    resourceManager = null;
    module = null;
}

// =============================================================================
// Shader API
// =============================================================================

function getResourceManager(): CppResourceManager {
    if (!resourceManager) {
        throw new Error('Material API not initialized. Call initMaterialAPI() first.');
    }
    return resourceManager;
}

export const Material = {
    /**
     * Creates a shader from vertex and fragment source code.
     * @param vertexSrc GLSL vertex shader source
     * @param fragmentSrc GLSL fragment shader source
     * @returns Shader handle, or 0 on failure
     */
    createShader(vertexSrc: string, fragmentSrc: string): ShaderHandle {
        return getResourceManager().createShader(vertexSrc, fragmentSrc);
    },

    /**
     * Releases a shader.
     * @param shader Shader handle to release
     */
    releaseShader(shader: ShaderHandle): void {
        if (shader > 0) {
            getResourceManager().releaseShader(shader);
        }
    },

    /**
     * Creates a material with a shader and optional settings.
     * @param options Material creation options
     * @returns Material handle
     */
    create(options: MaterialOptions): MaterialHandle {
        const handle = nextMaterialId++;
        const data: MaterialData = {
            shader: options.shader,
            uniforms: new Map(),
            blendMode: options.blendMode ?? BlendMode.Normal,
            depthTest: options.depthTest ?? false,
        };

        if (options.uniforms) {
            for (const [key, value] of Object.entries(options.uniforms)) {
                data.uniforms.set(key, value);
            }
        }

        materials.set(handle, data);
        return handle;
    },

    /**
     * Gets material data by handle.
     * @param material Material handle
     * @returns Material data or undefined
     */
    get(material: MaterialHandle): MaterialData | undefined {
        return materials.get(material);
    },

    /**
     * Sets a uniform value on a material.
     * @param material Material handle
     * @param name Uniform name
     * @param value Uniform value
     */
    setUniform(material: MaterialHandle, name: string, value: UniformValue): void {
        const data = materials.get(material);
        if (data) {
            data.uniforms.set(name, value);
        }
    },

    /**
     * Gets a uniform value from a material.
     * @param material Material handle
     * @param name Uniform name
     * @returns Uniform value or undefined
     */
    getUniform(material: MaterialHandle, name: string): UniformValue | undefined {
        const data = materials.get(material);
        return data?.uniforms.get(name);
    },

    /**
     * Sets the blend mode for a material.
     * @param material Material handle
     * @param mode Blend mode
     */
    setBlendMode(material: MaterialHandle, mode: BlendMode): void {
        const data = materials.get(material);
        if (data) {
            data.blendMode = mode;
        }
    },

    /**
     * Gets the blend mode of a material.
     * @param material Material handle
     * @returns Blend mode
     */
    getBlendMode(material: MaterialHandle): BlendMode {
        const data = materials.get(material);
        return data?.blendMode ?? BlendMode.Normal;
    },

    /**
     * Sets depth test enabled for a material.
     * @param material Material handle
     * @param enabled Whether depth test is enabled
     */
    setDepthTest(material: MaterialHandle, enabled: boolean): void {
        const data = materials.get(material);
        if (data) {
            data.depthTest = enabled;
        }
    },

    /**
     * Gets the shader handle for a material.
     * @param material Material handle
     * @returns Shader handle
     */
    getShader(material: MaterialHandle): ShaderHandle {
        const data = materials.get(material);
        return data?.shader ?? 0;
    },

    /**
     * Releases a material (does not release the shader).
     * @param material Material handle
     */
    release(material: MaterialHandle): void {
        materials.delete(material);
    },

    /**
     * Checks if a material exists.
     * @param material Material handle
     * @returns True if material exists
     */
    isValid(material: MaterialHandle): boolean {
        return materials.has(material);
    },
};

// =============================================================================
// Built-in Shader Sources
// =============================================================================

export const ShaderSources = {
    SPRITE_VERTEX: `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_texCoord;

uniform mat4 u_projection;
uniform mat4 u_model;

out vec4 v_color;
out vec2 v_texCoord;

void main() {
    v_color = a_color;
    v_texCoord = a_texCoord;
    gl_Position = u_projection * u_model * vec4(a_position, 1.0);
}
`,

    SPRITE_FRAGMENT: `#version 300 es
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_texture;

out vec4 fragColor;

void main() {
    fragColor = texture(u_texture, v_texCoord) * v_color;
}
`,

    COLOR_VERTEX: `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;

uniform mat4 u_projection;
uniform mat4 u_model;

out vec4 v_color;

void main() {
    v_color = a_color;
    gl_Position = u_projection * u_model * vec4(a_position, 1.0);
}
`,

    COLOR_FRAGMENT: `#version 300 es
precision highp float;

in vec4 v_color;

out vec4 fragColor;

void main() {
    fragColor = v_color;
}
`,
};
