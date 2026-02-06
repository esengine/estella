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

export interface MaterialAssetData {
    version: string;
    type: 'material';
    shader: string;
    blendMode: number;
    depthTest: boolean;
    properties: Record<string, unknown>;
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
    registerMaterialCallback();
}

export function shutdownMaterialAPI(): void {
    if (uniformBuffer !== 0 && module) {
        module._free(uniformBuffer);
        uniformBuffer = 0;
    }
    materials.clear();
    nextMaterialId = 1;
    materialCallbackRegistered = false;
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

    /**
     * Creates a material from asset data.
     * @param data Material asset data (properties object)
     * @param shaderHandle Pre-loaded shader handle
     * @returns Material handle
     */
    createFromAsset(data: MaterialAssetData, shaderHandle: ShaderHandle): MaterialHandle {
        const uniforms: Record<string, UniformValue> = {};

        for (const [key, value] of Object.entries(data.properties)) {
            if (typeof value === 'number') {
                uniforms[key] = value;
            } else if (typeof value === 'object' && value !== null) {
                const obj = value as Record<string, number>;
                if ('w' in obj) {
                    uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0, w: obj.w ?? 0 };
                } else if ('z' in obj) {
                    uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0 };
                } else if ('y' in obj) {
                    uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0 };
                }
            }
        }

        return this.create({
            shader: shaderHandle,
            uniforms,
            blendMode: data.blendMode as BlendMode ?? BlendMode.Normal,
            depthTest: data.depthTest ?? false,
        });
    },

    /**
     * Creates a material instance that shares the shader with source.
     * @param source Source material handle
     * @returns New material handle with copied settings
     */
    createInstance(source: MaterialHandle): MaterialHandle {
        const sourceData = materials.get(source);
        if (!sourceData) {
            throw new Error(`Invalid source material: ${source}`);
        }

        const handle = nextMaterialId++;
        const data: MaterialData = {
            shader: sourceData.shader,
            uniforms: new Map(sourceData.uniforms),
            blendMode: sourceData.blendMode,
            depthTest: sourceData.depthTest,
        };

        materials.set(handle, data);
        return handle;
    },

    /**
     * Exports material to serializable asset data.
     * @param material Material handle
     * @param shaderPath Shader file path for asset reference
     * @returns Material asset data
     */
    toAssetData(material: MaterialHandle, shaderPath: string): MaterialAssetData | null {
        const data = materials.get(material);
        if (!data) return null;

        const properties: Record<string, unknown> = {};
        for (const [key, value] of data.uniforms) {
            properties[key] = value;
        }

        return {
            version: '1.0',
            type: 'material',
            shader: shaderPath,
            blendMode: data.blendMode,
            depthTest: data.depthTest,
            properties,
        };
    },

    /**
     * Gets all uniforms from a material.
     * @param material Material handle
     * @returns Map of uniform names to values
     */
    getUniforms(material: MaterialHandle): Map<string, UniformValue> {
        const data = materials.get(material);
        return data ? new Map(data.uniforms) : new Map();
    },
};

// =============================================================================
// Material Callback Registration
// =============================================================================

let materialCallbackRegistered = false;
let uniformBuffer: number = 0;
const UNIFORM_BUFFER_SIZE = 4096;

function ensureUniformBuffer(): number {
    if (uniformBuffer === 0 && module) {
        uniformBuffer = module._malloc(UNIFORM_BUFFER_SIZE);
    }
    return uniformBuffer;
}

function serializeUniforms(uniforms: Map<string, UniformValue>): { ptr: number; count: number } {
    const bufferPtr = ensureUniformBuffer();
    if (bufferPtr === 0 || !module) return { ptr: 0, count: 0 };

    let offset = 0;
    let count = 0;
    const heap8 = module.HEAPU8;
    const heap32 = module.HEAPU32;
    const heapF32 = module.HEAPF32;

    for (const [name, value] of uniforms) {
        if (offset + 128 > UNIFORM_BUFFER_SIZE) break;

        const nameBytes = new TextEncoder().encode(name);
        const nameLen = nameBytes.length;
        const namePadded = Math.ceil(nameLen / 4) * 4;

        heap32[(bufferPtr + offset) >> 2] = nameLen;
        offset += 4;

        heap8.set(nameBytes, bufferPtr + offset);
        offset += namePadded;

        let type = 0;
        let values = [0, 0, 0, 0];

        if (typeof value === 'number') {
            type = 0;
            values[0] = value;
        } else if (Array.isArray(value)) {
            type = Math.min(value.length - 1, 3);
            for (let i = 0; i < Math.min(value.length, 4); i++) {
                values[i] = value[i];
            }
        } else if ('w' in value) {
            type = 3;
            values = [value.x, value.y, value.z, value.w];
        } else if ('z' in value) {
            type = 2;
            values = [value.x, value.y, value.z, 0];
        } else if ('y' in value) {
            type = 1;
            values = [value.x, value.y, 0, 0];
        }

        heap32[(bufferPtr + offset) >> 2] = type;
        offset += 4;

        for (let i = 0; i < 4; i++) {
            heapF32[(bufferPtr + offset) >> 2] = values[i];
            offset += 4;
        }

        count++;
    }

    return { ptr: bufferPtr, count };
}

export function registerMaterialCallback(): void {
    if (!module || materialCallbackRegistered) return;

    if (!module.addFunction || !module.setMaterialCallback) {
        console.warn('[Material] Callback registration not available (requires -sALLOW_TABLE_GROWTH)');
        return;
    }

    const callback = (
        materialId: number,
        outShaderIdPtr: number,
        outBlendModePtr: number,
        outUniformBufferPtr: number,
        outUniformCountPtr: number
    ) => {
        const data = materials.get(materialId);
        if (!data) {
            module!.HEAPU32[outShaderIdPtr >> 2] = 0;
            module!.HEAPU32[outBlendModePtr >> 2] = 0;
            module!.HEAPU32[outUniformBufferPtr >> 2] = 0;
            module!.HEAPU32[outUniformCountPtr >> 2] = 0;
            return;
        }

        module!.HEAPU32[outShaderIdPtr >> 2] = data.shader;
        module!.HEAPU32[outBlendModePtr >> 2] = data.blendMode;

        const { ptr, count } = serializeUniforms(data.uniforms);
        module!.HEAPU32[outUniformBufferPtr >> 2] = ptr;
        module!.HEAPU32[outUniformCountPtr >> 2] = count;
    };

    const callbackPtr = module.addFunction(callback, 'viiiii');
    module.setMaterialCallback(callbackPtr);
    materialCallbackRegistered = true;
}

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
