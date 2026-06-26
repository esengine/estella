// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    material.ts
 * @brief   Material and Shader API for custom rendering
 * @details Provides shader creation and material management for custom visual effects.
 */

import type { ESEngineModule } from './wasm';
import { CoreApiBridge } from './CoreApiBridge';
import { requireResourceManager } from './resourceManager';
import type { Vec2, Vec3, Vec4 } from './types';
import { BlendMode } from './blend';

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

/** Triangle culling mode; mirrors the engine's CullMode. */
export enum CullMode {
    None = 0,
    Back = 1,
    Front = 2,
}

export interface MaterialOptions {
    shader: ShaderHandle;
    uniforms?: Record<string, UniformValue>;
    blendMode?: BlendMode;
    depthTest?: boolean;
    depthWrite?: boolean;
    cull?: CullMode;
    /** Enabled static switches (#pragma switch) for the record; the shader permutation is
     *  chosen at compile time (see Material.compileShader). Stored for inspection/serialization. */
    switches?: Record<string, boolean>;
}

export interface MaterialAssetData {
    version: string;
    type: 'material';
    shader: string;
    // Render state is optional so an instance can serialize only its overrides; a base
    // material writes all of them. Absent fields fall back to the engine defaults on load.
    blendMode?: number;
    depthTest?: boolean;
    depthWrite?: boolean;
    cull?: number;
    /**
     * Parent material asset ref — present on a material instance (UE MaterialInstanceConstant).
     * The shader and any non-overridden render state are inherited from the parent; `shader`
     * is then ignored and `properties` carries only the overridden parameters (the diff).
     */
    instanceOf?: string;
    /** Enabled static switches (#pragma switch) — selects the shader permutation at load. */
    switches?: Record<string, boolean>;
    properties: Record<string, unknown>;
}

export interface MaterialData {
    shader: ShaderHandle;
    uniforms: Map<string, UniformValue>;
    blendMode: BlendMode;
    depthTest: boolean;
    depthWrite: boolean;
    cull: CullMode;
    /** Enabled static switches (the shader permutation was chosen for these at compile time). */
    switches: Record<string, boolean>;
    /**
     * Instance parenting (UE MaterialInstanceConstant): when set, this material inherits the
     * parent's shader + render state + params, and only its own diffs are stored — `uniforms`
     * holds just the overridden params, and `overrides` names the overridden render-state
     * fields ('blendMode' | 'depthTest' | 'depthWrite' | 'cull'). Undefined on a base material.
     */
    parent?: MaterialHandle;
    overrides: Set<string>;
    // Immediate-mode mesh uniform cache (draw.ts): the encoded uniform buffer is rebuilt
    // only when dirty_ (a uniform changed). Distinct from the batch render path's material UBO.
    dirty_: boolean;
    cachedBuffer_: Float32Array | null;
    cachedIdx_: number;
}

// =============================================================================
// Internal State
// =============================================================================

const bridge = new CoreApiBridge('material');
let module: ESEngineModule | null = null;
let nextMaterialId = 1;
const materials = new Map<MaterialHandle, MaterialData>();
// Reverse index parent -> instances, so editing a base material re-flushes its instances.
const childrenOf = new Map<MaterialHandle, Set<MaterialHandle>>();

// =============================================================================
// Initialization
// =============================================================================

export function initMaterialAPI(wasmModule: ESEngineModule): void {
    bridge.connect(wasmModule);
    module = bridge.module;
}

export function shutdownMaterialAPI(): void {
    materials.clear();
    childrenOf.clear();
    nextMaterialId = 1;
    bridge.disconnect();
    module = null;
}

// Pack the render-state flags the engine store expects: depthTest (bit 0), depthWrite
// (bit 1), CullMode (bits 2-3).
function materialFlags(depthTest: boolean, depthWrite: boolean, cull: CullMode): number {
    return (depthTest ? 0x1 : 0) | (depthWrite ? 0x2 : 0) | ((cull & 0x3) << 2);
}

function registerChild(parent: MaterialHandle, child: MaterialHandle): void {
    let set = childrenOf.get(parent);
    if (!set) { set = new Set(); childrenOf.set(parent, set); }
    set.add(child);
}

function unregisterChild(parent: MaterialHandle, child: MaterialHandle): void {
    childrenOf.get(parent)?.delete(child);
}

// Push one param value into the engine material store: texture refs bind to a sampler unit,
// scalar/vector values pack into the std140 MaterialConstants UBO (both by the offset/unit the
// shader's #pragma param reflection assigns). A no-op engine-side for unknown params.
function pushUniform(handle: MaterialHandle, name: string, value: UniformValue): void {
    if (!module) return;
    if (isTextureRef(value)) {
        module.setMaterialTexture(handle, name, value.textureId);
        return;
    }
    const { arity, values } = classifyUniformArity(value);
    module.setMaterialUniform(handle, name, arity, values[0], values[1], values[2], values[3]);
}

interface ResolvedMaterial {
    shader: ShaderHandle;
    blendMode: BlendMode;
    depthTest: boolean;
    depthWrite: boolean;
    cull: CullMode;
    uniforms: Map<string, UniformValue>;
}

// Flatten an instance chain to its effective material: the parent's values with this
// material's overrides applied (uniforms by key, render state by `overrides`). Defensive
// against a missing parent (e.g. a released base) — falls back to the material's own values.
function resolveMaterial(handle: MaterialHandle): ResolvedMaterial | null {
    const data = materials.get(handle);
    if (!data) return null;
    const parent = data.parent !== undefined ? resolveMaterial(data.parent) : null;
    if (!parent) {
        return {
            shader: data.shader, blendMode: data.blendMode, depthTest: data.depthTest,
            depthWrite: data.depthWrite, cull: data.cull, uniforms: new Map(data.uniforms),
        };
    }
    const uniforms = parent.uniforms;  // fresh map from the recursive call
    for (const [k, v] of data.uniforms) uniforms.set(k, v);  // instance overrides win
    return {
        shader: parent.shader,  // instances inherit the shader
        blendMode: data.overrides.has('blendMode') ? data.blendMode : parent.blendMode,
        depthTest: data.overrides.has('depthTest') ? data.depthTest : parent.depthTest,
        depthWrite: data.overrides.has('depthWrite') ? data.depthWrite : parent.depthWrite,
        cull: data.overrides.has('cull') ? data.cull : parent.cull,
        uniforms,
    };
}

// Push a material's flattened state to the engine, then re-flush every instance of it — so a
// base edit propagates to non-overriding children. The single push point for create + edits.
function flushMaterial(handle: MaterialHandle): void {
    const resolved = resolveMaterial(handle);
    if (resolved && module) {
        module.defineMaterial(handle, resolved.shader, resolved.blendMode,
            materialFlags(resolved.depthTest, resolved.depthWrite, resolved.cull));
        for (const [name, value] of resolved.uniforms) pushUniform(handle, name, value);
    }
    const kids = childrenOf.get(handle);
    if (kids) for (const child of kids) flushMaterial(child);
}

// Convert a .esmaterial `properties` map (JSON numbers / colors / vectors) into typed
// UniformValues. Keyed by the value's shape: {r,g,b,a} -> color vec4, {x,y,z,w}/{x,y,z}/{x,y}.
function parseAssetProperties(properties: Record<string, unknown>): Record<string, UniformValue> {
    const uniforms: Record<string, UniformValue> = {};
    for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'number') {
            uniforms[key] = value;
        } else if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, number>;
            if ('a' in obj) uniforms[key] = { x: obj.r ?? 0, y: obj.g ?? 0, z: obj.b ?? 0, w: obj.a ?? 0 };
            else if ('w' in obj) uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0, w: obj.w ?? 0 };
            else if ('z' in obj) uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0 };
            else if ('y' in obj) uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0 };
        }
    }
    return uniforms;
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
            depthWrite: options.depthWrite ?? true,
            cull: options.cull ?? CullMode.None,
            switches: options.switches ? { ...options.switches } : {},
            overrides: new Set(),
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
        flushMaterial(handle);
        return handle;
    },

    /**
     * Compiles a `.esshader` material shader through the engine's ShaderParser, which
     * generates the std140 MaterialConstants block from its `#pragma param` declarations and
     * registers the param layout. Use this (not createShader) for materials whose parameters
     * should reach the GPU. Returns a shader handle, or 0 on failure.
     */
    compileShader(esshaderSource: string, features: string[] = []): ShaderHandle {
        return module?.compileEsshader(esshaderSource, features.join(',')) ?? 0;
    },

    /** Gets an enabled static switch (false when unset). */
    getSwitch(material: MaterialHandle, name: string): boolean {
        return materials.get(material)?.switches[name] ?? false;
    },

    /** Sets a static switch on the record. The shader permutation is chosen at compile time,
     *  so a change takes effect when the material's shader is next (re)compiled — callers that
     *  need it live recompile the shader with the new switch set. */
    setSwitch(material: MaterialHandle, name: string, on: boolean): void {
        const data = materials.get(material);
        if (data) data.switches[name] = on;
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
            // On an instance, the local uniforms map *is* the override set (presence = override).
            data.uniforms.set(name, value);
            data.dirty_ = true;  // immediate-mode mesh path re-encodes its uniform cache.
            flushMaterial(material);  // batch path: re-flatten + push (+ propagate to instances).
        }
    },

    /**
     * Gets a uniform value from a material.
     * @param material Material handle
     * @param name Uniform name
     * @returns Uniform value or undefined
     */
    getUniform(material: MaterialHandle, name: string): UniformValue | undefined {
        return resolveMaterial(material)?.uniforms.get(name);
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
            if (data.parent !== undefined) data.overrides.add('blendMode');
            flushMaterial(material);
        }
    },

    /**
     * Gets the blend mode of a material.
     * @param material Material handle
     * @returns Blend mode
     */
    getBlendMode(material: MaterialHandle): BlendMode {
        return resolveMaterial(material)?.blendMode ?? BlendMode.Normal;
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
            if (data.parent !== undefined) data.overrides.add('depthTest');
            flushMaterial(material);
        }
    },

    /** Enables/disables depth writes (default on, matching the engine's 2D state). */
    setDepthWrite(material: MaterialHandle, enabled: boolean): void {
        const data = materials.get(material);
        if (data) {
            data.depthWrite = enabled;
            if (data.parent !== undefined) data.overrides.add('depthWrite');
            flushMaterial(material);
        }
    },

    /** Sets the triangle culling mode. */
    setCull(material: MaterialHandle, cull: CullMode): void {
        const data = materials.get(material);
        if (data) {
            data.cull = cull;
            if (data.parent !== undefined) data.overrides.add('cull');
            flushMaterial(material);
        }
    },

    /**
     * Gets the shader handle for a material.
     * @param material Material handle
     * @returns Shader handle
     */
    getShader(material: MaterialHandle): ShaderHandle {
        return resolveMaterial(material)?.shader ?? 0;
    },

    /**
     * Releases a material (does not release the shader).
     * @param material Material handle
     */
    release(material: MaterialHandle): void {
        const data = materials.get(material);
        if (data?.parent !== undefined) unregisterChild(data.parent, material);
        childrenOf.delete(material);  // orphaned instances fall back to their own values (resolve is defensive)
        materials.delete(material);
        module?.undefineMaterial(material);
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
     * Render a material to an offscreen @p w×@p h target and return its pixels (a "material ball"
     * thumbnail). Reuses the real viewport render path — a unit quad lit by one directional light
     * — so the preview matches how the material looks in-scene. Null if the engine isn't ready.
     */
    renderPreview(material: MaterialHandle, w: number, h: number): ImageData | null {
        if (!module) return null;
        module.renderer_renderMaterialPreview(material, w, h);
        const size = module.renderer_getPreviewSize();
        const pw = module.renderer_getPreviewWidth();
        const ph = module.renderer_getPreviewHeight();
        if (size === 0 || pw === 0 || ph === 0) return null;
        const pixels = new Uint8ClampedArray(module.HEAPU8.buffer, module.renderer_getPreviewPtr(), size);
        // GL reads bottom-up; flip rows so the thumbnail is upright.
        const flipped = new Uint8ClampedArray(size);
        const rowBytes = pw * 4;
        for (let y = 0; y < ph; y++) {
            flipped.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), (ph - 1 - y) * rowBytes);
        }
        return new ImageData(flipped, pw, ph);
    },

    releaseAll(): void {
        if (module) {
            for (const handle of materials.keys()) module.undefineMaterial(handle);
        }
        materials.clear();
        childrenOf.clear();
    },

    /**
     * Creates a material from asset data. When @p parentHandle is given (the asset's
     * `instanceOf` resolved to a loaded parent), builds a Material Instance carrying only the
     * asset's overrides — `properties` and any present render-state fields. Otherwise builds a
     * base material on @p shaderHandle.
     */
    createFromAsset(data: MaterialAssetData, shaderHandle: ShaderHandle, parentHandle?: MaterialHandle): MaterialHandle {
        const uniforms = parseAssetProperties(data.properties);

        if (parentHandle !== undefined && parentHandle !== 0) {
            const handle = this.createInstance(parentHandle);
            for (const [key, value] of Object.entries(uniforms)) this.setUniform(handle, key, value);
            // Present render-state fields are the instance's overrides (absent = inherited).
            if (data.blendMode !== undefined) this.setBlendMode(handle, data.blendMode as BlendMode);
            if (data.depthTest !== undefined) this.setDepthTest(handle, data.depthTest);
            if (data.depthWrite !== undefined) this.setDepthWrite(handle, data.depthWrite);
            if (data.cull !== undefined) this.setCull(handle, data.cull as CullMode);
            return handle;
        }

        return this.create({
            shader: shaderHandle,
            uniforms,
            blendMode: (data.blendMode as BlendMode) ?? BlendMode.Normal,
            depthTest: data.depthTest ?? false,
            depthWrite: data.depthWrite ?? true,
            cull: (data.cull as CullMode) ?? CullMode.None,
            switches: data.switches,
        });
    },

    /**
     * Creates a material instance (UE MaterialInstanceConstant): it inherits @p source's
     * shader, render state and parameters, and stores only the diffs you later set on it.
     * Editing the parent propagates to every non-overriding instance. Use this for cheap
     * variants ("the same material, but red") instead of duplicating the whole material.
     * @param source Parent material (a base material or another instance)
     * @returns New instance handle
     */
    createInstance(source: MaterialHandle): MaterialHandle {
        const sourceData = materials.get(source);
        if (!sourceData) {
            throw new Error(`Invalid source material: ${source}`);
        }

        const handle = nextMaterialId++;
        const data: MaterialData = {
            // Render-state fields are placeholders (resolve inherits from the parent unless an
            // override is set); `uniforms` holds only this instance's overrides, empty at first.
            shader: sourceData.shader,
            uniforms: new Map(),
            blendMode: sourceData.blendMode,
            depthTest: sourceData.depthTest,
            depthWrite: sourceData.depthWrite,
            cull: sourceData.cull,
            switches: {},  // instance inherits the parent's shader permutation (switch override = follow-up)
            parent: source,
            overrides: new Set(),
            dirty_: true,
            cachedBuffer_: null,
            cachedIdx_: 0,
        };

        materials.set(handle, data);
        registerChild(source, handle);
        flushMaterial(handle);
        return handle;
    },

    /**
     * Exports material to serializable asset data.
     * @param material Material handle
     * @param shaderPath Shader file path for asset reference
     * @returns Material asset data
     */
    toAssetData(material: MaterialHandle, shaderPath: string, parentPath?: string): MaterialAssetData | null {
        const data = materials.get(material);
        if (!data) return null;

        // An instance serializes as a diff: instanceOf + only its overridden params (the local
        // uniforms map) and overridden render-state. A base writes its full state.
        const isInstance = data.parent !== undefined && parentPath !== undefined;

        const properties: Record<string, unknown> = {};
        const localUniforms = isInstance ? data.uniforms : resolveMaterial(material)?.uniforms ?? data.uniforms;
        for (const [key, value] of localUniforms) properties[key] = value;

        if (isInstance) {
            const asset: MaterialAssetData = {
                version: '1.0', type: 'material', shader: shaderPath, instanceOf: parentPath, properties,
            };
            if (data.overrides.has('blendMode')) asset.blendMode = data.blendMode;
            if (data.overrides.has('depthTest')) asset.depthTest = data.depthTest;
            if (data.overrides.has('depthWrite')) asset.depthWrite = data.depthWrite;
            if (data.overrides.has('cull')) asset.cull = data.cull;
            return asset;
        }

        const asset: MaterialAssetData = {
            version: '1.0',
            type: 'material',
            shader: shaderPath,
            blendMode: data.blendMode,
            depthTest: data.depthTest,
            depthWrite: data.depthWrite,
            cull: data.cull,
            properties,
        };
        if (Object.keys(data.switches).length > 0) asset.switches = { ...data.switches };
        return asset;
    },

    /**
     * Gets all uniforms from a material.
     * @param material Material handle
     * @returns Map of uniform names to values
     */
    getUniforms(material: MaterialHandle): Map<string, UniformValue> {
        // Resolved (flattened) uniforms — an instance reports inherited + overridden params.
        return resolveMaterial(material)?.uniforms ?? new Map();
    },

    tex(textureId: number, slot?: number): TextureRef {
        return { __textureRef: true, textureId, slot };
    },
};

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
