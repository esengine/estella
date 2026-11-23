// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { ShaderHandle, Vec4 } from '../render/material';

export interface PassConfig {
    name: string;
    shader: ShaderHandle;
    enabled: boolean;
    floatUniforms: Map<string, number>;
    vec4Uniforms: Map<string, Vec4>;
    /** Effect-declared textures (LUTs, masks): sampler uniform -> SDK texture handle. */
    textureUniforms: Map<string, number>;
    /**
     * Fraction of the chain size this pass draws at. 1 is every pass that has
     * ever existed here; a fraction is for an effect whose result is smooth
     * enough to compute small and read back big (SSAO's occlusion term).
     */
    scale: number;
    minScale?: number;
    /** A later pass of a multi-pass effect: its composite reads the input the
     *  effect started from rather than the pass before it. */
    continuesEffect: boolean;
    /** Set for a compute pass: it has no `shader`, and the engine dispatches this WGSL over the picture instead. */
    compute?: ComputePassSource;
    /** Set for a pass the engine implements itself ("voxelGI"): it has no `shader`, and the engine declares its own passes. */
    native?: string;
    effect?: string;
}

/** What a compute pass runs: the WGSL, the names of its f32 params in the order its params block lists them, and its workgroup size. */
export interface ComputePassSource {
    source: string;
    params: string[];
    workgroupSize: [number, number];
}

/** Control of one installation on one camera. @internal */
export interface SceneCameraBinding {
    enabled: boolean;
    isCurrent(): boolean;
    release(): void;
}

class CameraBindings extends Map<Entity, PostProcessStack> {
    private readonly scenes_ = new Map<Entity, SceneCameraBinding>();

    claim(camera: Entity, enabled: boolean): SceneCameraBinding {
        const binding: SceneCameraBinding = {
            enabled,
            isCurrent: () => this.scenes_.get(camera) === binding,
            release: () => { if (binding.isCurrent()) this.delete(camera); },
        };
        this.scenes_.set(camera, binding);
        return binding;
    }

    activeStack(camera: Entity): PostProcessStack | undefined {
        return this.scenes_.get(camera)?.enabled === false ? undefined : this.get(camera);
    }

    override set(camera: Entity, stack: PostProcessStack): this {
        this.scenes_.delete(camera);
        return super.set(camera, stack);
    }

    override delete(camera: Entity): boolean {
        this.scenes_.delete(camera);
        return super.delete(camera);
    }

    override clear(): void {
        this.scenes_.clear();
        super.clear();
    }
}

/**
 * Owns one App's post-process stacks, camera bindings, screen stack, and id
 * counter. A stack registers into the state it is created with — no global.
 * Held by {@link PostProcessAPI} (a per-App resource in B2b-3b).
 */
export class PostProcessState {
    nextStackId = 1;
    readonly stacks: Map<number, PostProcessStack> = new Map();
    readonly cameraBindings = new CameraBindings();
    screenStack: PostProcessStack | null = null;

    /** Create a stack owned by (and registered in) this state. */
    createStack(): PostProcessStack {
        return new PostProcessStack(this);
    }

    reset(): void {
        for (const stack of [...this.stacks.values()]) {
            stack.destroy();
        }
        this.stacks.clear();
        this.cameraBindings.clear();
        this.screenStack = null;
        this.nextStackId = 1;
    }
}

export class PostProcessStack {
    readonly id: number;
    private readonly state_: PostProcessState;
    private passes_: PassConfig[] = [];
    private destroyed_ = false;
    private dirty_ = true;
    private displayLut_ = { texture: 0, amount: 0 };

    constructor(state: PostProcessState) {
        this.state_ = state;
        this.id = state.nextStackId++;
        state.stacks.set(this.id, this);
    }

    addPass(name: string, shader: ShaderHandle, scale = 1, continuesEffect = false, minScale?: number): this {
        this.passes_.push({
            name,
            shader,
            enabled: true,
            floatUniforms: new Map(),
            vec4Uniforms: new Map(),
            textureUniforms: new Map(),
            scale,
            continuesEffect,
            ...(minScale !== undefined ? { minScale } : {}),
        });
        this.dirty_ = true;
        return this;
    }

    /** Adds a compute pass (see {@link ComputePassSource}). A device with no compute leaves it out of the chain. */
    addComputePass(name: string, compute: ComputePassSource): this {
        this.passes_.push({
            name,
            shader: 0 as ShaderHandle,
            enabled: true,
            floatUniforms: new Map(),
            vec4Uniforms: new Map(),
            textureUniforms: new Map(),
            scale: 1,
            continuesEffect: false,
            compute,
        });
        this.dirty_ = true;
        return this;
    }

    /** Adds a pass the engine implements itself, by kind. A device with no compute stage leaves it out of the chain. */
    addNativePass(name: string, kind: string): this {
        this.passes_.push({
            name,
            shader: 0 as ShaderHandle,
            enabled: true,
            floatUniforms: new Map(),
            vec4Uniforms: new Map(),
            textureUniforms: new Map(),
            scale: 1,
            continuesEffect: false,
            native: kind,
        });
        this.dirty_ = true;
        return this;
    }

    removePass(name: string): this {
        const idx = this.passes_.findIndex(p => p.name === name);
        if (idx !== -1) {
            this.passes_.splice(idx, 1);
            this.dirty_ = true;
        }
        return this;
    }

    clearPasses(): this {
        if (this.passes_.length > 0) {
            this.passes_.length = 0;
            this.dirty_ = true;
        }
        this.setDisplayLut(0, 0);
        return this;
    }

    /**
     * A graded look for the last pass: `texture` is a 1024x32 table (a 32-slice strip, slice along x being blue) read by the picture as the
     * display shows it, after the output transform, and `amount` how far the picture moves toward its answer (0 to 1). Part of the stack, as
     * its passes are: 0 for no table clears it.
     */
    setDisplayLut(texture: number, amount: number): this {
        const wanted = texture !== 0 && amount > 0 ? { texture, amount: Math.min(amount, 1) } : { texture: 0, amount: 0 };
        if (wanted.texture !== this.displayLut_.texture || wanted.amount !== this.displayLut_.amount) {
            this.displayLut_ = wanted;
            this.dirty_ = true;
        }
        return this;
    }

    get displayLut(): { readonly texture: number; readonly amount: number } {
        return this.displayLut_;
    }

    setEffect(passName: string, effect: string): this {
        const pass = this.passes_.find(p => p.name === passName);
        if (pass && pass.effect !== effect) {
            pass.effect = effect;
            this.dirty_ = true;
        }
        return this;
    }

    setEnabled(name: string, enabled: boolean): this {
        const pass = this.passes_.find(p => p.name === name);
        if (pass && pass.enabled !== enabled) {
            pass.enabled = enabled;
            this.dirty_ = true;
        }
        return this;
    }

    setUniform(passName: string, uniform: string, value: number): this {
        const pass = this.passes_.find(p => p.name === passName);
        if (pass) {
            if (pass.floatUniforms.get(uniform) !== value) {
                pass.floatUniforms.set(uniform, value);
                this.dirty_ = true;
            }
        }
        return this;
    }

    /** Binds a texture (SDK texture handle) to a pass's sampler uniform. */
    setTexture(passName: string, uniform: string, textureHandle: number): this {
        const pass = this.passes_.find(p => p.name === passName);
        if (pass) {
            if (pass.textureUniforms.get(uniform) !== textureHandle) {
                pass.textureUniforms.set(uniform, textureHandle);
                this.dirty_ = true;
            }
        }
        return this;
    }

    setUniformVec4(passName: string, uniform: string, value: Vec4): this {
        const pass = this.passes_.find(p => p.name === passName);
        if (pass) {
            const cur = pass.vec4Uniforms.get(uniform);
            if (!cur || cur.x !== value.x || cur.y !== value.y || cur.z !== value.z || cur.w !== value.w) {
                pass.vec4Uniforms.set(uniform, { ...value });
                this.dirty_ = true;
            }
        }
        return this;
    }

    setAllPassesEnabled(enabled: boolean): void {
        for (const pass of this.passes_) {
            if (pass.enabled !== enabled) {
                pass.enabled = enabled;
                this.dirty_ = true;
            }
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

    get isDirty(): boolean {
        return this.dirty_;
    }

    clearDirty(): void {
        this.dirty_ = false;
    }

    get isDestroyed(): boolean {
        return this.destroyed_;
    }

    destroy(): void {
        if (this.destroyed_) return;
        this.destroyed_ = true;

        for (const [camera, stack] of this.state_.cameraBindings) {
            if (stack === this) {
                this.state_.cameraBindings.delete(camera);
            }
        }

        this.state_.stacks.delete(this.id);
    }
}
