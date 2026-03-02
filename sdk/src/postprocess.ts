/**
 * @file    postprocess.ts
 * @brief   Per-camera post-processing effects API
 */

import type { ESEngineModule } from './wasm';
import type { Entity } from './types';
import type { ShaderHandle, Vec4 } from './material';
import { Material } from './material';
import { handleWasmError } from './wasmError';

// =============================================================================
// Internal State
// =============================================================================

let module: ESEngineModule | null = null;
let nextStackId = 1;

const stacks: Map<number, PostProcessStack> = new Map();
const cameraBindings: Map<Entity, PostProcessStack> = new Map();

// =============================================================================
// Initialization
// =============================================================================

export function initPostProcessAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
}

export function shutdownPostProcessAPI(): void {
    for (const stack of stacks.values()) {
        stack.destroy();
    }
    stacks.clear();
    cameraBindings.clear();
    if (module && PostProcess.isInitialized()) {
        PostProcess.shutdown();
    }
    module = null;
}

// =============================================================================
// PostProcessStack
// =============================================================================

interface PassConfig {
    name: string;
    shader: ShaderHandle;
    enabled: boolean;
    floatUniforms: Map<string, number>;
    vec4Uniforms: Map<string, Vec4>;
}

export class PostProcessStack {
    readonly id: number;
    private passes_: PassConfig[] = [];
    private destroyed_ = false;

    constructor() {
        this.id = nextStackId++;
        stacks.set(this.id, this);
    }

    addPass(name: string, shader: ShaderHandle): this {
        this.passes_.push({
            name,
            shader,
            enabled: true,
            floatUniforms: new Map(),
            vec4Uniforms: new Map(),
        });
        return this;
    }

    removePass(name: string): this {
        const idx = this.passes_.findIndex(p => p.name === name);
        if (idx !== -1) {
            this.passes_.splice(idx, 1);
        }
        return this;
    }

    setEnabled(name: string, enabled: boolean): this {
        const pass = this.passes_.find(p => p.name === name);
        if (pass) {
            pass.enabled = enabled;
        }
        return this;
    }

    setUniform(passName: string, uniform: string, value: number): this {
        const pass = this.passes_.find(p => p.name === passName);
        if (pass) {
            pass.floatUniforms.set(uniform, value);
        }
        return this;
    }

    setUniformVec4(passName: string, uniform: string, value: Vec4): this {
        const pass = this.passes_.find(p => p.name === passName);
        if (pass) {
            pass.vec4Uniforms.set(uniform, { ...value });
        }
        return this;
    }

    setAllPassesEnabled(enabled: boolean): void {
        for (const pass of this.passes_) {
            pass.enabled = enabled;
        }
    }

    get passCount(): number {
        return this.passes_.length;
    }

    get enabledPassCount(): number {
        let count = 0;
        for (const pass of this.passes_) {
            if (pass.enabled) count++;
        }
        return count;
    }

    get passes(): readonly PassConfig[] {
        return this.passes_;
    }

    get isDestroyed(): boolean {
        return this.destroyed_;
    }

    destroy(): void {
        if (this.destroyed_) return;
        this.destroyed_ = true;

        for (const [camera, stack] of cameraBindings) {
            if (stack === this) {
                cameraBindings.delete(camera);
            }
        }

        stacks.delete(this.id);
    }
}

// =============================================================================
// Internal helpers
// =============================================================================

function getModule(): ESEngineModule {
    if (!module) {
        throw new Error('PostProcess API not initialized. Call initPostProcessAPI() first.');
    }
    return module;
}

function syncStackToWasm(stack: PostProcessStack): void {
    const m = getModule();

    try {
        m.postprocess_clearPasses();
    } catch (e) {
        handleWasmError(e, 'PostProcess._applyForCamera:clearPasses');
        return;
    }

    for (const pass of stack.passes) {
        if (!pass.enabled) continue;
        try {
            m.postprocess_addPass(pass.name, pass.shader);
        } catch (e) {
            handleWasmError(e, `PostProcess._applyForCamera:addPass("${pass.name}")`);
            continue;
        }

        for (const [name, value] of pass.floatUniforms) {
            try {
                m.postprocess_setUniformFloat(pass.name, name, value);
            } catch (e) {
                handleWasmError(e, `PostProcess._applyForCamera:setUniform("${pass.name}", "${name}")`);
            }
        }

        for (const [name, value] of pass.vec4Uniforms) {
            try {
                m.postprocess_setUniformVec4(pass.name, name, value.x, value.y, value.z, value.w);
            } catch (e) {
                handleWasmError(e, `PostProcess._applyForCamera:setUniformVec4("${pass.name}", "${name}")`);
            }
        }
    }
}

// =============================================================================
// PostProcess Static API
// =============================================================================

export const PostProcess = {
    // =========================================================================
    // Stack Management
    // =========================================================================

    createStack(): PostProcessStack {
        return new PostProcessStack();
    },

    // =========================================================================
    // Camera Binding
    // =========================================================================

    bind(camera: Entity, stack: PostProcessStack): void {
        if (stack.isDestroyed) {
            throw new Error('Cannot bind a destroyed PostProcessStack');
        }
        cameraBindings.set(camera, stack);
    },

    unbind(camera: Entity): void {
        cameraBindings.delete(camera);
    },

    getStack(camera: Entity): PostProcessStack | null {
        return cameraBindings.get(camera) ?? null;
    },

    // =========================================================================
    // Pipeline Lifecycle (delegates to C++ singleton)
    // =========================================================================

    init(width: number, height: number): boolean {
        try {
            return getModule().postprocess_init(width, height);
        } catch (e) {
            handleWasmError(e, `PostProcess.init(${width}x${height})`);
            return false;
        }
    },

    shutdown(): void {
        try {
            getModule().postprocess_shutdown();
        } catch (e) {
            handleWasmError(e, 'PostProcess.shutdown');
        }
    },

    resize(width: number, height: number): void {
        try {
            getModule().postprocess_resize(width, height);
        } catch (e) {
            handleWasmError(e, `PostProcess.resize(${width}x${height})`);
        }
    },

    isInitialized(): boolean {
        if (!module) return false;
        try {
            return module.postprocess_isInitialized();
        } catch (e) {
            handleWasmError(e, 'PostProcess.isInitialized');
            return false;
        }
    },

    setBypass(bypass: boolean): void {
        try {
            getModule().postprocess_setBypass(bypass);
        } catch (e) {
            handleWasmError(e, 'PostProcess.setBypass');
        }
    },

    setOutputViewport(x: number, y: number, w: number, h: number): void {
        try {
            getModule().postprocess_setOutputViewport(x, y, w, h);
        } catch (e) {
            handleWasmError(e, 'PostProcess.setOutputViewport');
        }
    },

    // =========================================================================
    // Per-Camera Render Integration (called by RenderPipeline)
    // =========================================================================

    _applyForCamera(camera: Entity): void {
        const stack = cameraBindings.get(camera);
        if (!stack || stack.isDestroyed || stack.enabledPassCount === 0) {
            PostProcess.setBypass(true);
            return;
        }

        if (!PostProcess.isInitialized()) {
            PostProcess.init(1, 1);
        }

        PostProcess.setBypass(false);
        syncStackToWasm(stack);
    },

    _resetAfterCamera(): void {
        try {
            getModule().postprocess_clearPasses();
            getModule().postprocess_setBypass(true);
        } catch (e) {
            handleWasmError(e, 'PostProcess._resetAfterCamera');
        }
    },

    _cleanupDestroyedCameras(isValid: (e: Entity) => boolean): void {
        for (const camera of cameraBindings.keys()) {
            if (!isValid(camera)) {
                cameraBindings.delete(camera);
            }
        }
    },

    // =========================================================================
    // Built-in Effects
    // =========================================================================

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
    float vignette = smoothstep(u_intensity, u_intensity - u_softness, dist);
    fragColor = vec4(color.rgb * vignette, color.a);
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

    createBloom(): ShaderHandle {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_threshold;
uniform float u_intensity;
uniform float u_radius;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec2 texelSize = 1.0 / u_resolution;

    vec3 bloom = vec3(0.0);
    float total = 0.0;
    for (float x = -3.0; x <= 3.0; x += 1.0) {
        for (float y = -3.0; y <= 3.0; y += 1.0) {
            vec2 offset = vec2(x, y) * texelSize * u_radius;
            vec4 s = texture(u_texture, v_texCoord + offset);
            float brightness = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
            float w = max(brightness - u_threshold, 0.0);
            bloom += s.rgb * w;
            total += w;
        }
    }
    if (total > 0.0) bloom /= total;

    fragColor = vec4(color.rgb + bloom * u_intensity, color.a);
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

// =============================================================================
// Built-in Effect Metadata
// =============================================================================

export interface EffectUniformDef {
    name: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
}

export interface EffectDef {
    type: string;
    label: string;
    factory: () => ShaderHandle;
    uniforms: EffectUniformDef[];
}

const effectRegistry = new Map<string, EffectDef>();

function registerEffect(def: EffectDef): void {
    effectRegistry.set(def.type, def);
}

registerEffect({
    type: 'blur',
    label: 'Blur',
    factory: () => PostProcess.createBlur(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 2 },
    ],
});

registerEffect({
    type: 'bloom',
    label: 'Bloom',
    factory: () => PostProcess.createBloom(),
    uniforms: [
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 2, step: 0.01, defaultValue: 0.8 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 10, step: 0.1, defaultValue: 1.5 },
        { name: 'u_radius', label: 'Radius', min: 0, max: 20, step: 0.1, defaultValue: 4 },
    ],
});

registerEffect({
    type: 'vignette',
    label: 'Vignette',
    factory: () => PostProcess.createVignette(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, defaultValue: 0.8 },
        { name: 'u_softness', label: 'Softness', min: 0, max: 2, step: 0.01, defaultValue: 0.3 },
    ],
});

registerEffect({
    type: 'grayscale',
    label: 'Grayscale',
    factory: () => PostProcess.createGrayscale(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'chromaticAberration',
    label: 'Chromatic Aberration',
    factory: () => PostProcess.createChromaticAberration(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 3 },
    ],
});

export function getEffectDef(type: string): EffectDef | undefined {
    return effectRegistry.get(type);
}

export function getEffectTypes(): string[] {
    return Array.from(effectRegistry.keys());
}

export function getAllEffectDefs(): EffectDef[] {
    return Array.from(effectRegistry.values());
}

// =============================================================================
// PostProcessVolume Data
// =============================================================================

export interface PostProcessEffectData {
    type: string;
    enabled: boolean;
    uniforms: Record<string, number>;
}

export interface PostProcessVolumeData {
    effects: PostProcessEffectData[];
}

const volumeStacks = new Map<Entity, PostProcessStack>();
const volumeShaders = new Map<Entity, Map<string, ShaderHandle>>();

export function syncPostProcessVolume(camera: Entity, data: PostProcessVolumeData): void {
    let stack = volumeStacks.get(camera);
    let shaders = volumeShaders.get(camera);

    const activeEffects = data.effects.filter(e => e.enabled);
    if (activeEffects.length === 0) {
        if (stack) {
            PostProcess.unbind(camera);
            stack.destroy();
            volumeStacks.delete(camera);
        }
        if (shaders) {
            for (const handle of shaders.values()) {
                Material.releaseShader(handle);
            }
            volumeShaders.delete(camera);
        }
        return;
    }

    if (!stack) {
        stack = PostProcess.createStack();
        volumeStacks.set(camera, stack);
    }

    if (!shaders) {
        shaders = new Map();
        volumeShaders.set(camera, shaders);
    }

    while (stack.passCount > 0) {
        const passes = stack.passes;
        stack.removePass(passes[passes.length - 1].name);
    }

    for (const effect of activeEffects) {
        const def = getEffectDef(effect.type);
        if (!def) continue;

        let shader = shaders.get(effect.type);
        if (shader === undefined) {
            shader = def.factory();
            shaders.set(effect.type, shader);
        }

        stack.addPass(effect.type, shader);

        for (const uDef of def.uniforms) {
            const value = effect.uniforms[uDef.name] ?? uDef.defaultValue;
            stack.setUniform(effect.type, uDef.name, value);
        }
    }

    PostProcess.bind(camera, stack);
}

export function cleanupPostProcessVolume(camera: Entity): void {
    const stack = volumeStacks.get(camera);
    if (stack) {
        PostProcess.unbind(camera);
        stack.destroy();
        volumeStacks.delete(camera);
    }
    const shaders = volumeShaders.get(camera);
    if (shaders) {
        for (const handle of shaders.values()) {
            Material.releaseShader(handle);
        }
        volumeShaders.delete(camera);
    }
}

export function cleanupAllPostProcessVolumes(): void {
    for (const camera of volumeStacks.keys()) {
        cleanupPostProcessVolume(camera);
    }
}
