import type { Entity } from '../types';
import type { ShaderHandle, Vec4 } from '../material';

export interface PassConfig {
    name: string;
    shader: ShaderHandle;
    enabled: boolean;
    floatUniforms: Map<string, number>;
    vec4Uniforms: Map<string, Vec4>;
}

let nextStackId = 1;

const stacks: Map<number, PostProcessStack> = new Map();
const cameraBindings: Map<Entity, PostProcessStack> = new Map();

export function getStacks(): Map<number, PostProcessStack> {
    return stacks;
}

export function getCameraBindings(): Map<Entity, PostProcessStack> {
    return cameraBindings;
}

export function resetNextStackId(): void {
    nextStackId = 1;
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

    clearPasses(): this {
        this.passes_.length = 0;
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
