// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { getEffectDef } from './effects';
import { fusedParamName, fusedShaderSource, type EffectStage } from './effectStage';
import type { PassConfig } from './PostProcessStack';

export interface FusedPass {
    name: string;
    shader: ShaderHandle;
    members: readonly PassConfig[];
}

export type PlannedPass = PassConfig | FusedPass;

export function isFusedPass(pass: PlannedPass): pass is FusedPass {
    return 'members' in pass;
}

export class PassFusion {
    private readonly stages_ = new Map<string, EffectStage | null>();
    private readonly ready_ = new Set<ShaderHandle>();
    private readonly names_ = new Map<string, Map<string, string>>();
    private waiting_ = false;

    constructor(private readonly shaders_: Map<string, ShaderHandle>, private readonly pending_: () => number) {}

    get waiting(): boolean {
        return this.waiting_;
    }

    plan(passes: readonly PassConfig[]): PlannedPass[] {
        this.waiting_ = false;
        const out: PlannedPass[] = [];
        let run: PassConfig[] = [];
        let fullInput = true;
        let neighbours = false;
        let lastScale = 1;
        const flush = (): void => {
            const fused = run.length > 1 ? this.fuse(run) : null;
            if (fused) out.push(fused);
            else out.push(...run);
            run = [];
            neighbours = false;
        };
        for (const pass of passes) {
            const stage = this.stageOf(pass);
            if (!stage) {
                flush();
                out.push(pass);
                lastScale = pass.scale;
                continue;
            }
            if (stage.neighbours && (neighbours || (run.length > 0 && !fullInput))) flush();
            if (run.length === 0) fullInput = lastScale === 1;
            run.push(pass);
            neighbours ||= !!stage.neighbours;
            lastScale = pass.scale;
        }
        flush();
        return out;
    }

    paramName(effect: string, name: string): string {
        let names = this.names_.get(effect);
        if (!names) this.names_.set(effect, names = new Map());
        let renamed = names.get(name);
        if (renamed === undefined) names.set(name, renamed = fusedParamName(effect, name));
        return renamed;
    }

    private stageOf(pass: PassConfig): EffectStage | null {
        if (!pass.effect || pass.scale !== 1 || pass.continuesEffect || pass.native || pass.textureUniforms.size > 0) return null;
        let stage = this.stages_.get(pass.effect);
        if (stage === undefined) {
            stage = getEffectDef(pass.effect)?.inline?.() ?? null;
            this.stages_.set(pass.effect, stage);
        }
        return stage;
    }

    private fuse(run: readonly PassConfig[]): FusedPass | null {
        const key = `fused:${run.map((p) => p.effect).join('+')}`;
        let shader = this.shaders_.get(key);
        if (shader === undefined) {
            shader = Material.compileShader(fusedShaderSource(run.map((p) => ({ effect: p.effect!, stage: this.stageOf(p)! }))));
            this.shaders_.set(key, shader);
            this.ready_.delete(shader);
        }
        if (!shader) return null;
        if (!this.ready_.has(shader)) {
            if (this.pending_() > 0) {
                this.waiting_ = true;
                return null;
            }
            this.ready_.add(shader);
        }
        return { name: run.map((p) => p.name).join('+'), shader, members: run };
    }
}
