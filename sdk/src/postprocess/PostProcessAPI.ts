// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ESEngineModule } from '../wasm';
import type { Entity } from '../types';
import type { ShaderHandle } from '../material';
import { defineResource } from '../resource';
import { handleWasmError } from '../wasmError';
import { CoreApiBridge } from '../CoreApiBridge';
import { PostProcessStack, PostProcessState } from './PostProcessStack';

const bridge = new CoreApiBridge('postprocess');
let module: ESEngineModule | null = null;

export function initPostProcessAPI(wasmModule: ESEngineModule): void {
    bridge.connect(wasmModule);
    module = bridge.module;
}

export function shutdownPostProcessAPI(): void {
    // Per-App state dies with its App; here we only tear down the shared module.
    if (module) {
        try {
            if (module.postprocess_isInitialized()) module.postprocess_shutdown();
        } catch (e) {
            handleWasmError(e, 'PostProcess.shutdown');
        }
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

/**
 * Per-App post-process API. Owns this App's `state` (stacks, camera bindings,
 * screen stack) and drives the shared C++ post-process pipeline via the module.
 * The wasm-call methods are shared on the prototype; only `state` is per-App.
 *
 * B2b-3a: a single default instance is exported to keep call sites unchanged;
 * B2b-3b flips this to a per-App `defineResource` injected into the pipeline.
 */
export class PostProcessApi {
    readonly state = new PostProcessState();

    /** Volume-system bookkeeping (per-App): camera → the stack it created, and shared effect shaders. */
    readonly volumeStacks = new Map<Entity, PostProcessStack>();
    readonly volumeShaders = new Map<string, ShaderHandle>();

    // -- per-App state (stacks / bindings / screen stack) --------------------

    get screenStack(): PostProcessStack | null {
        return this.state.screenStack;
    }

    setScreenStack(stack: PostProcessStack | null): void {
        this.state.screenStack = stack;
    }

    createStack(): PostProcessStack {
        return this.state.createStack();
    }

    bind(camera: Entity, stack: PostProcessStack): void {
        if (stack.isDestroyed) {
            throw new Error('Cannot bind a destroyed PostProcessStack');
        }
        this.state.cameraBindings.set(camera, stack);
    }

    unbind(camera: Entity): void {
        this.state.cameraBindings.delete(camera);
    }

    getStack(camera: Entity): PostProcessStack | null {
        return this.state.cameraBindings.get(camera) ?? null;
    }

    // -- shared C++ pipeline commands ----------------------------------------

    init(width: number, height: number): boolean {
        try {
            return getModule().postprocess_init(width, height);
        } catch (e) {
            handleWasmError(e, `PostProcess.init(${width}x${height})`);
            return false;
        }
    }

    shutdown(): void {
        try {
            getModule().postprocess_shutdown();
        } catch (e) {
            handleWasmError(e, 'PostProcess.shutdown');
        }
    }

    resize(width: number, height: number): void {
        try {
            getModule().postprocess_resize(width, height);
        } catch (e) {
            handleWasmError(e, `PostProcess.resize(${width}x${height})`);
        }
    }

    isInitialized(): boolean {
        if (!module) return false;
        try {
            return module.postprocess_isInitialized();
        } catch (e) {
            handleWasmError(e, 'PostProcess.isInitialized');
            return false;
        }
    }

    setBypass(bypass: boolean): void {
        try {
            getModule().postprocess_setBypass(bypass);
        } catch (e) {
            handleWasmError(e, 'PostProcess.setBypass');
        }
    }

    begin(): void {
        try {
            getModule().postprocess_begin();
        } catch (e) {
            handleWasmError(e, 'PostProcess.begin');
        }
    }

    end(): void {
        try {
            getModule().postprocess_end();
        } catch (e) {
            handleWasmError(e, 'PostProcess.end');
        }
    }

    setOutputViewport(x: number, y: number, w: number, h: number): void {
        try {
            getModule().postprocess_setOutputViewport(x, y, w, h);
        } catch (e) {
            handleWasmError(e, 'PostProcess.setOutputViewport');
        }
    }

    // -- per-camera / screen orchestration (state + commands) ----------------

    _applyForCamera(camera: Entity): void {
        const stack = this.state.cameraBindings.get(camera);
        if (!stack || stack.isDestroyed || stack.enabledPassCount === 0) {
            this.setBypass(true);
            return;
        }

        if (!this.isInitialized()) {
            this.init(1, 1);
        }

        this.setBypass(false);
        syncStackToWasm(stack);
    }

    _resetAfterCamera(): void {
        try {
            getModule().postprocess_clearPasses();
            getModule().postprocess_setBypass(true);
        } catch (e) {
            handleWasmError(e, 'PostProcess._resetAfterCamera');
        }
    }

    _beginScreenCapture(): void {
        try {
            getModule().postprocess_beginScreenCapture();
        } catch (e) {
            handleWasmError(e, 'PostProcess._beginScreenCapture');
        }
    }

    _endScreenCapture(): void {
        try {
            getModule().postprocess_endScreenCapture();
        } catch (e) {
            handleWasmError(e, 'PostProcess._endScreenCapture');
        }
    }

    _applyScreenStack(): void {
        const stack = this.state.screenStack;
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
    }

    _executeScreenPasses(): void {
        try {
            getModule().postprocess_executeScreenPasses();
        } catch (e) {
            handleWasmError(e, 'PostProcess._executeScreenPasses');
        }
    }
}

/**
 * Per-App post-process resource. Published + injected into the render pipeline
 * by `PostProcessPlugin`; read as `app.getResource(PostProcess)`.
 */
export const PostProcess = defineResource<PostProcessApi>(null!, 'PostProcess');
