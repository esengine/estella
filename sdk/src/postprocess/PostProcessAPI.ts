import type { ESEngineModule } from '../wasm';
import type { Entity } from '../types';
import type { ShaderHandle } from '../material';
import { Material } from '../material';
import { handleWasmError } from '../wasmError';
import { PostProcessStack, getCameraBindings, getStacks } from './PostProcessStack';
import { POSTPROCESS_VERTEX } from './shaders';

let module: ESEngineModule | null = null;

export function initPostProcessAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
}

export function shutdownPostProcessAPI(): void {
    for (const stack of getStacks().values()) {
        stack.destroy();
    }
    getStacks().clear();
    getCameraBindings().clear();
    if (module && PostProcess.isInitialized()) {
        PostProcess.shutdown();
    }
    module = null;
}

function getModule(): ESEngineModule {
    if (!module) {
        throw new Error('PostProcess API not initialized. Call initPostProcessAPI() first.');
    }
    return module;
}

export function syncStackToWasm(stack: PostProcessStack): void {
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

export const PostProcess = {
    createStack(): PostProcessStack {
        return new PostProcessStack();
    },

    bind(camera: Entity, stack: PostProcessStack): void {
        if (stack.isDestroyed) {
            throw new Error('Cannot bind a destroyed PostProcessStack');
        }
        getCameraBindings().set(camera, stack);
    },

    unbind(camera: Entity): void {
        getCameraBindings().delete(camera);
    },

    getStack(camera: Entity): PostProcessStack | null {
        return getCameraBindings().get(camera) ?? null;
    },

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

    begin(): void {
        try {
            getModule().postprocess_begin();
        } catch (e) {
            handleWasmError(e, 'PostProcess.begin');
        }
    },

    end(): void {
        try {
            getModule().postprocess_end();
        } catch (e) {
            handleWasmError(e, 'PostProcess.end');
        }
    },

    setOutputViewport(x: number, y: number, w: number, h: number): void {
        try {
            getModule().postprocess_setOutputViewport(x, y, w, h);
        } catch (e) {
            handleWasmError(e, 'PostProcess.setOutputViewport');
        }
    },

    _applyForCamera(camera: Entity): void {
        const stack = getCameraBindings().get(camera);
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
        for (const camera of getCameraBindings().keys()) {
            if (!isValid(camera)) {
                getCameraBindings().delete(camera);
            }
        }
    },

    screenStack: null as PostProcessStack | null,

    setScreenStack(stack: PostProcessStack | null): void {
        PostProcess.screenStack = stack;
    },

    _beginScreenCapture(): void {
        try {
            getModule().postprocess_beginScreenCapture();
        } catch (e) {
            handleWasmError(e, 'PostProcess._beginScreenCapture');
        }
    },

    _endScreenCapture(): void {
        try {
            getModule().postprocess_endScreenCapture();
        } catch (e) {
            handleWasmError(e, 'PostProcess._endScreenCapture');
        }
    },

    _applyScreenStack(): void {
        const stack = PostProcess.screenStack;
        if (!stack || stack.isDestroyed || stack.enabledPassCount === 0) return;

        const m = getModule();
        try {
            m.postprocess_clearScreenPasses();
        } catch (e) {
            handleWasmError(e, 'PostProcess._applyScreenStack:clearScreenPasses');
            return;
        }

        for (const pass of stack.passes) {
            if (!pass.enabled) continue;
            try {
                m.postprocess_addScreenPass(pass.name, pass.shader);
            } catch (e) {
                handleWasmError(e, `PostProcess._applyScreenStack:addScreenPass("${pass.name}")`);
                continue;
            }

            for (const [name, value] of pass.floatUniforms) {
                try {
                    m.postprocess_setScreenUniformFloat(pass.name, name, value);
                } catch (e) {
                    handleWasmError(e, `PostProcess._applyScreenStack:setScreenUniform("${pass.name}", "${name}")`);
                }
            }

            for (const [name, value] of pass.vec4Uniforms) {
                try {
                    m.postprocess_setScreenUniformVec4(pass.name, name, value.x, value.y, value.z, value.w);
                } catch (e) {
                    handleWasmError(e, `PostProcess._applyScreenStack:setScreenUniformVec4("${pass.name}", "${name}")`);
                }
            }
        }
    },

    _executeScreenPasses(): void {
        try {
            getModule().postprocess_executeScreenPasses();
        } catch (e) {
            handleWasmError(e, 'PostProcess._executeScreenPasses');
        }
    },

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
