// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { ShaderHandle, Vec4 } from '../material';

export interface PassConfig {
    name: string;
    shader: ShaderHandle;
    enabled: boolean;
    floatUniforms: Map<string, number>;
    vec4Uniforms: Map<string, Vec4>;
}

/**
 * Owns one App's post-process stacks, camera bindings, screen stack, and id
 * counter. A stack registers into the state it is created with — no global.
 * Held by {@link PostProcessApi} (a per-App resource in B2b-3b).
 */
export class PostProcessState {
    nextStackId = 1;
    readonly stacks: Map<number, PostProcessStack> = new Map();
    readonly cameraBindings: Map<Entity, PostProcessStack> = new Map();
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

    constructor(state: PostProcessState) {
        this.state_ = state;
        this.id = state.nextStackId++;
        state.stacks.set(this.id, this);
    }

    addPass(name: string, shader: ShaderHandle): this {
        this.passes_.push({
            name,
            shader,
            enabled: true,
            floatUniforms: new Map(),
            vec4Uniforms: new Map(),
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
