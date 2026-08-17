// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, MaterialResult } from '../AssetLoader';
import { resolveDocumentRef } from '../documentRef';
import type { MaterialAssetData, ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';
import { builtinShaderTemplate } from '../../render/builtinShaders';
import { AsyncCache } from '../AsyncCache';
import { log } from '../../util/logger';

// A `builtin:<id>` shader ref names a stock template compiled from its in-code source (no file);
// anything else is a path to a project `.esshader`. Kept a literal (not a shared export) so it
// stays out of the public API surface — the editor mirrors it.
const BUILTIN_SHADER_PREFIX = 'builtin:';

export class MaterialAssetLoader implements AssetLoader<MaterialResult> {
    readonly type = 'material';
    readonly extensions = ['.esmaterial'];

    private shaderCache_ = new AsyncCache<ShaderHandle>();

    async load(path: string, ctx: LoadContext): Promise<MaterialResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const data = JSON.parse(text) as MaterialAssetData;

        if (data.type !== 'material') {
            throw new Error(`Invalid material file type: ${data.type} at ${path}`);
        }

        // A material instance (`instanceOf`) inherits its parent's shader + state; load the
        // parent first, then build the instance from the asset's diffs. Parent shader resolution
        // and uniforms come from the parent material, so no shader is loaded here.
        if (data.instanceOf) {
            const parentPath = resolveDocumentRef(path, data.instanceOf);
            const parent = await this.load(parentPath, ctx);
            const handle = Material.createFromAsset(data, 0, parent.handle);
            const texturePaths = await this.applyTextureProps(handle, data, path, ctx);
            return {
                handle,
                shaderHandle: parent.shaderHandle,
                texturePaths: [...(parent.texturePaths ?? []), ...texturePaths],
                parentHandle: parent.handle,
            };
        }

        // Enabled static switches select the shader permutation (compiled once per switch-set).
        const features = enabledSwitches(data.switches);
        const shaderHandle = await this.loadShader(path, data.shader, features, ctx);
        const handle = Material.createFromAsset(data, shaderHandle);
        const texturePaths = await this.applyTextureProps(handle, data, path, ctx);

        return { handle, shaderHandle, texturePaths };
    }

    // A texture param is a string property (an asset ref); scalar/vector params are
    // numbers/objects (handled by createFromAsset). Load each texture, bind it to its
    // param, and return the refs so unload can release them (they hold a texture ref).
    private async applyTextureProps(
        handle: number,
        data: MaterialAssetData,
        matPath: string,
        ctx: LoadContext,
    ): Promise<string[]> {
        const bound: string[] = [];
        for (const [name, value] of Object.entries(data.properties)) {
            if (typeof value !== 'string') continue;
            const texPath = resolveDocumentRef(matPath, value);
            try {
                const tex = await ctx.loadTexture(texPath);
                Material.setUniform(handle, name, Material.tex(tex.handle));
                bound.push(texPath); // recorded only on success — matches the refcount taken
            } catch (e) {
                // Missing texture: leave the param unbound (it samples whatever is at the unit).
                log.warn('asset', `Material ${matPath}: failed to load texture '${texPath}' for param '${name}'`, e);
            }
        }
        return bound;
    }

    unload(asset: MaterialResult, ctx: LoadContext): void {
        if (asset.texturePaths) {
            for (const texPath of asset.texturePaths) ctx.releaseTexture(texPath);
        }
        if (asset.parentHandle !== undefined) Material.release(asset.parentHandle);
        Material.release(asset.handle);
    }

    releaseAll(): void {
        this.shaderCache_.clearAll();
    }

    // Compile a material's shader ref — either a `builtin:<id>` stock template (from its in-code
    // source, no file) or a path to a project `.esshader` resolved relative to the material. One
    // compiled program per (resolved key, enabled-switch set) — distinct switch sets are distinct
    // permutations, so the cache key folds the sorted features in.
    private async loadShader(matPath: string, ref: string, features: string[], ctx: LoadContext): Promise<ShaderHandle> {
        const isBuiltin = ref.startsWith(BUILTIN_SHADER_PREFIX);
        const key = isBuiltin ? ref : resolveDocumentRef(matPath, ref);
        const cacheKey = features.length ? `${key}#${features.join('|')}` : key;
        const cached = this.shaderCache_.get(cacheKey);
        if (cached !== undefined) return cached;

        return this.shaderCache_.getOrLoad(cacheKey, async () => {
            let content: string;
            if (isBuiltin) {
                const template = builtinShaderTemplate(ref.slice(BUILTIN_SHADER_PREFIX.length));
                if (!template) {
                    throw new Error(`Unknown built-in shader: ${ref}`);
                }
                content = template.source;
            } else {
                content = await ctx.loadText(ctx.catalog.getBuildPath(key));
            }
            // Compile through ShaderParser (engine-side): assembles the stages + the enabled
            // switch permutation, generates the std140 MaterialConstants block from #pragma param,
            // and registers the layout so the material's parameters reach the GPU.
            const handle = Material.compileShader(content, features);
            if (!handle) {
                throw new Error(`Failed to compile material shader: ${key}`);
            }
            return handle;
        });
    }
}

// The enabled static switches, sorted for a stable permutation cache key.
function enabledSwitches(switches: Record<string, boolean> | undefined): string[] {
    if (!switches) return [];
    return Object.entries(switches).filter(([, on]) => on).map(([name]) => name).sort();
}


