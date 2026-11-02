// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import { BUILTIN_REF_PREFIX, isBuiltinAssetRef } from '../documentRef';
import { builtinShaderTemplate, BUILTIN_SHADER_MODULE } from '../../render/builtinShaders';
import { Material, type ShaderHandle } from '../../render/material';
import { disposeAll } from '../../util/disposeAll';

/** One source era owns every permutation compiled from those exact bytes. */
export class MaterialShaderSource {
    private programs_ = new Map<string, ShaderHandle>();
    constructor(private readonly path_: string, private readonly source_: string) {}

    compile(features: string[]): ShaderHandle {
        const key = JSON.stringify(features);
        const cached = this.programs_.get(key);
        if (cached !== undefined) return cached;
        const handle = Material.compileShader(this.source_, features);
        if (!handle) throw new Error(`Failed to compile material shader: ${this.path_}`);
        this.programs_.set(key, handle);
        Material.noteProgram(handle, features, this.source_, next => this.compile(next));
        return handle;
    }

    dispose(): void {
        const handles = [...this.programs_.values()];
        this.programs_.clear();
        disposeAll(handles, handle => Material.releaseShader(handle));
    }
}

export class MaterialShaderAssetLoader implements AssetLoader<MaterialShaderSource> {
    readonly type = 'material-shader';
    readonly extensions = ['.esshader'];

    async load(path: string, ctx: LoadContext): Promise<MaterialShaderSource> {
        let source: string;
        if (isBuiltinAssetRef(path)) {
            const template = builtinShaderTemplate(path.slice(BUILTIN_REF_PREFIX.length));
            if (!template) {
                const id = path.slice(BUILTIN_REF_PREFIX.length);
                const module = BUILTIN_SHADER_MODULE[id];
                throw new Error(module
                    ? `The built-in shader ${path} ships in ${module}, which this package did not install: import '${module}'.`
                    : `Unknown built-in shader: ${path}`);
            }
            source = template.source;
        } else {
            source = ctx.readSource ? await ctx.readSource(path) : await ctx.loadText(ctx.catalog.getBuildPath(path));
        }
        return new MaterialShaderSource(path, source);
    }

    unload(source: MaterialShaderSource): void { source.dispose(); }
}
