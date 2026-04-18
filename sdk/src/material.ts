/**
 * @file    material.ts
 * @brief   Material and Shader API for custom rendering
 * @details Provides shader creation and material management for custom visual effects.
 */

import type { ESEngineModule } from './wasm';
import { requireResourceManager } from './resourceManager';
import type { Vec2, Vec3, Vec4 } from './types';
import { BlendMode } from './blend';
import { log } from './logger';

export type { Vec2, Vec3, Vec4 } from './types';

// =============================================================================
// Types
// =============================================================================

export type ShaderHandle = number;
export type MaterialHandle = number;

export interface TextureRef {
    __textureRef: true;
    textureId: number;
    slot?: number;
}

export type UniformValue = number | Vec2 | Vec3 | Vec4 | number[] | TextureRef;

export function isTextureRef(v: UniformValue): v is TextureRef {
    return typeof v === 'object' && v !== null && '__textureRef' in v;
}

/**
 * Decompose a non-texture uniform value into an arity (1–4) and packed
 * float values. Shared by the material-registration serializer (in this
 * file) and the per-draw uniform path in draw.ts, which previously had
 * their own parallel branches that drifted in subtle ways.
 *
 * The two serializers apply different *type codes* on top of the arity —
 * material.ts uses 0..3 (float, vec2, vec3, vec4), while draw.ts uses
 * 1..4 plus 10 for texture refs. Those layouts match two distinct WASM
 * APIs (material-reflection vs per-draw uniform binding), so the code
 * offsets stay at each call site; only the arity-and-extract step is
 * centralized here.
 */
export interface UniformArity {
    readonly arity: 1 | 2 | 3 | 4;
    readonly values: readonly [number, number, number, number];
}

export function classifyUniformArity(value: Exclude<UniformValue, TextureRef>): UniformArity {
    if (typeof value === 'number') {
        return { arity: 1, values: [value, 0, 0, 0] };
    }
    if (Array.isArray(value)) {
        const arity = Math.max(1, Math.min(value.length, 4)) as 1 | 2 | 3 | 4;
        return {
            arity,
            values: [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0],
        };
    }
    if ('w' in value) return { arity: 4, values: [value.x, value.y, value.z, value.w] };
    if ('z' in value) return { arity: 3, values: [value.x, value.y, value.z, 0] };
    return { arity: 2, values: [value.x, value.y, 0, 0] };
}

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

export interface MaterialData {
    shader: ShaderHandle;
    uniforms: Map<string, UniformValue>;
    blendMode: BlendMode;
    depthTest: boolean;
    dirty_: boolean;
    cachedBuffer_: Float32Array | null;
    cachedIdx_: number;
}

// =============================================================================
// Internal State
// =============================================================================

let module: ESEngineModule | null = null;
let nextMaterialId = 1;
const materials = new Map<MaterialHandle, MaterialData>();

// =============================================================================
// Initialization
// =============================================================================

export function initMaterialAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
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
    encodedNameCache.clear();
    encoder = null;
    module = null;
}

// =============================================================================
// Shader API
// =============================================================================

export const Material = {
    /**
     * Creates a shader from vertex and fragment source code.
     * @param vertexSrc GLSL vertex shader source
     * @param fragmentSrc GLSL fragment shader source
     * @returns Shader handle, or 0 on failure
     */
    createShader(vertexSrc: string, fragmentSrc: string): ShaderHandle {
        return requireResourceManager().createShader(vertexSrc, fragmentSrc);
    },

    /**
     * Releases a shader.
     * @param shader Shader handle to release
     */
    releaseShader(shader: ShaderHandle): void {
        if (shader > 0) {
            requireResourceManager().releaseShader(shader);
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
            dirty_: true,
            cachedBuffer_: null,
            cachedIdx_: 0,
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
            data.dirty_ = true;
            module?.invalidateMaterialCache(material);
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
            module?.invalidateMaterialCache(material);
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
            module?.invalidateMaterialCache(material);
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
        module?.invalidateMaterialCache(material);
    },

    /**
     * Checks if a material exists.
     * @param material Material handle
     * @returns True if material exists
     */
    isValid(material: MaterialHandle): boolean {
        return materials.has(material);
    },

    releaseAll(): void {
        materials.clear();
        module?.clearMaterialCache();
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
                if ('a' in obj) {
                    uniforms[key] = { x: obj.r ?? 0, y: obj.g ?? 0, z: obj.b ?? 0, w: obj.a ?? 0 };
                } else if ('w' in obj) {
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
            dirty_: true,
            cachedBuffer_: null,
            cachedIdx_: 0,
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

    tex(textureId: number, slot?: number): TextureRef {
        return { __textureRef: true, textureId, slot };
    },
};

// =============================================================================
// Material Callback Registration
// =============================================================================

let materialCallbackRegistered = false;
let uniformBuffer: number = 0;
const UNIFORM_BUFFER_SIZE = 16384;
const encodedNameCache = new Map<string, Uint8Array>();
let encoder: TextEncoder | null = null;

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
        if (isTextureRef(value)) continue;

        let nameBytes = encodedNameCache.get(name);
        if (!nameBytes) {
            if (!encoder) encoder = new TextEncoder();
            nameBytes = encoder.encode(name);
            encodedNameCache.set(name, nameBytes);
        }
        const nameLen = nameBytes.length;
        const namePadded = Math.ceil(nameLen / 4) * 4;
        const requiredBytes = 4 + namePadded + 4 + 16;

        if (offset + requiredBytes > UNIFORM_BUFFER_SIZE) {
            log.warn('material', `uniform buffer full (${offset}/${UNIFORM_BUFFER_SIZE} bytes), skipping remaining uniforms`);
            break;
        }

        heap32[(bufferPtr + offset) >> 2] = nameLen;
        offset += 4;

        heap8.set(nameBytes, bufferPtr + offset);
        offset += namePadded;

        // Type codes in this layout are zero-indexed (0=float, 1=vec2,
        // 2=vec3, 3=vec4); classifyUniformArity returns arity 1..4 so we
        // subtract one to match.
        const { arity, values } = classifyUniformArity(value as Exclude<UniformValue, TextureRef>);
        heap32[(bufferPtr + offset) >> 2] = arity - 1;
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

    module.materialDataProvider = callback;
    materialCallbackRegistered = true;
}

// =============================================================================
// Built-in Shader Sources
// =============================================================================

/**
 * Built-in ES 3.0 shader sources for SDK custom materials.
 * These use the batch renderer vertex layout (vec3 position + vec4 color + vec2 texCoord)
 * and are NOT duplicates of the .esshader files (which are ES 1.0 with different layouts).
 */
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
