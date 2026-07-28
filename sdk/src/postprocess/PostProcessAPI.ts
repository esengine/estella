// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { ShaderHandle } from '../render/material';
import type { EngineApi } from '../ecs/bridge/engineApi';
import { defineResource } from '../ecs/resource';
import { handleWasmError } from '../wasm/wasmError';
import { WasmBridge } from '../wasm/WasmBridge';
import { PostProcessStack, PostProcessState } from './PostProcessStack';

/**
 * The post-process entry points as a core that HAS them answers them. Named, not
 * re-declared: the signatures come from the generated engine surface, so this
 * cannot drift from the C++ (PostProcessBindings.hpp) that produced it.
 */
type PostProcessCore = Required<Pick<NonNullable<EngineApi>,
    'postprocess_init' | 'postprocess_shutdown' | 'postprocess_resize'
    | 'postprocess_isInitialized' | 'postprocess_begin' | 'postprocess_end'
    | 'postprocess_clearPasses' | 'postprocess_addPass' | 'postprocess_setPassTexture'
    | 'postprocess_setUniformFloat' | 'postprocess_setUniformVec4'
    | 'postprocess_setBypass' | 'postprocess_setOutputViewport'
    | 'postprocess_beginScreenCapture' | 'postprocess_endScreenCapture'
    | 'postprocess_executeScreenPasses' | 'postprocess_addScreenPass'
    | 'postprocess_clearScreenPasses' | 'postprocess_setScreenUniformFloat'
    | 'postprocess_setScreenUniformVec4'>>;

/** Guarded view of the core: after a wasm abort a call throws instead of reaching
 *  a dead module; a native host's bindings never abort. */
class PostProcessBridge extends WasmBridge<NonNullable<EngineApi>> {
    protected readonly label = 'postprocess';
}

const bridge = new PostProcessBridge();
let module: PostProcessCore | null = null;

/**
 * @internal Wired by the engine plugins — not part of the public API.
 * Takes whichever core is present (see ecs/engineApi.ts). A core built without
 * ES_ENABLE_POSTPROCESS answers none of these entry points; the plugin checks that
 * before calling, which is what makes the narrowing here sound.
 */
export function initPostProcessAPI(engine: NonNullable<EngineApi>): void {
    bridge.connect(engine);
    module = bridge.module as PostProcessCore;
}

/** @internal Wired by the engine plugins — not part of the public API. */
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

function getModule(): PostProcessCore {
    if (!module) {
        throw new Error('PostProcess API not initialized. Call initPostProcessAPI() first.');
    }
    return module;
}

/**
 * Push a stack's enabled passes to the engine. `force` re-pushes a stack that has
 * not been edited — needed because the engine's pass list is torn down after every
 * camera (see {@link PostProcessAPI._resetAfterCamera}), so "not dirty" says the
 * stack is unchanged, NOT that the engine still holds it.
 */
export function syncStackToWasm(stack: PostProcessStack, force = false): void {
    if (!force && !stack.isDirty) return;

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

        for (const [name, handle] of pass.textureUniforms) {
            try {
                m.postprocess_setPassTexture(pass.name, name, handle);
            } catch (e) {
                handleWasmError(e, `PostProcess._applyForCamera:setPassTexture("${pass.name}", "${name}")`);
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
export class PostProcessAPI {
    readonly state = new PostProcessState();

    /** Volume-system bookkeeping (per-App): camera → the stack it created, and shared effect shaders. */
    readonly volumeStacks = new Map<Entity, PostProcessStack>();
    readonly volumeShaders = new Map<string, ShaderHandle>();

    /**
     * Which stack the engine's pass list currently holds, or null when it holds
     * none. Distinct from the stack's own dirty flag, which only tracks edits:
     * every camera ends by clearing the engine's passes, so a stack that was
     * pushed last frame and never edited must still be pushed again this frame.
     */
    private engineStack_: PostProcessStack | null = null;

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
        syncStackToWasm(stack, /*force=*/this.engineStack_ !== stack);
        this.engineStack_ = stack;
    }

    _resetAfterCamera(): void {
        try {
            getModule().postprocess_clearPasses();
            getModule().postprocess_setBypass(true);
            this.engineStack_ = null;
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
export const PostProcess = defineResource<PostProcessAPI>(null!, 'PostProcess');
