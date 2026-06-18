import type { ESEngineModule } from '../wasm';
import type { Entity } from '../types';
import { handleWasmError } from '../wasmError';
import { CoreApiBridge } from '../CoreApiBridge';
import { PostProcessStack, getCameraBindings, getStacks, createStack as createPostProcessStack } from './PostProcessStack';

const bridge = new CoreApiBridge('postprocess');
let module: ESEngineModule | null = null;

export function initPostProcessAPI(wasmModule: ESEngineModule): void {
    bridge.connect(wasmModule);
    module = bridge.module;
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
    bridge.disconnect();
    module = null;
}

function getModule(): ESEngineModule {
    if (!module) {
        throw new Error('PostProcess API not initialized. Call initPostProcessAPI() first.');
    }
    return module;
}

export function syncStackToWasm(stack: PostProcessStack): void {
    if (!stack.isDirty) return;

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

    stack.clearDirty();
}

export const PostProcess = {
    createStack(): PostProcessStack {
        return createPostProcessStack();
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
};
