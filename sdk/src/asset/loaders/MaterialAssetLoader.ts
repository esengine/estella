// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, MaterialResult } from '../AssetLoader';
import type { MaterialAssetData, ShaderHandle } from '../../material';
import { Material } from '../../material';
import { AsyncCache } from '../AsyncCache';

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
            const parentPath = resolveRelativePath(path, data.instanceOf);
            const parent = await this.load(parentPath, ctx);
            const handle = Material.createFromAsset(data, 0, parent.handle);
            await this.applyTextureProps(handle, data, path, ctx);
            return { handle, shaderHandle: parent.shaderHandle };
        }

        // Enabled static switches select the shader permutation (compiled once per switch-set).
        const features = enabledSwitches(data.switches);
        const shaderPath = resolveRelativePath(path, data.shader);
        const shaderHandle = await this.loadShader(shaderPath, features, ctx);
        const handle = Material.createFromAsset(data, shaderHandle);
        await this.applyTextureProps(handle, data, path, ctx);

        return { handle, shaderHandle };
    }

    // A texture param is a string property (an asset ref); scalar/vector params are
    // numbers/objects (handled by createFromAsset). Load each texture and bind it to its param.
    private async applyTextureProps(
        handle: number,
        data: MaterialAssetData,
        matPath: string,
        ctx: LoadContext,
    ): Promise<void> {
        for (const [name, value] of Object.entries(data.properties)) {
            if (typeof value !== 'string') continue;
            const texPath = resolveRelativePath(matPath, value);
            try {
                const tex = await ctx.loadTexture(texPath);
                Material.setUniform(handle, name, Material.tex(tex.handle));
            } catch {
                // Missing texture: leave the param unbound (it samples whatever is at the unit).
            }
        }
    }

    unload(asset: MaterialResult): void {
        Material.release(asset.handle);
    }

    releaseAll(): void {
        this.shaderCache_.clearAll();
    }

    // One compiled program per (shader path, enabled-switch set) — distinct switch sets are
    // distinct permutations, so the cache key folds the sorted features in.
    private async loadShader(path: string, features: string[], ctx: LoadContext): Promise<ShaderHandle> {
        const cacheKey = features.length ? `${path}#${features.join('|')}` : path;
        const cached = this.shaderCache_.get(cacheKey);
        if (cached !== undefined) return cached;

        return this.shaderCache_.getOrLoad(cacheKey, async () => {
            const buildPath = ctx.catalog.getBuildPath(path);
            const content = await ctx.loadText(buildPath);
            // Compile through ShaderParser (engine-side): assembles the stages + the enabled
            // switch permutation, generates the std140 MaterialConstants block from #pragma param,
            // and registers the layout so the material's parameters reach the GPU.
            const handle = Material.compileShader(content, features);
            if (!handle) {
                throw new Error(`Failed to compile material shader: ${path}`);
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

// Resolve a ref (shader or parent material) relative to the referencing material's directory;
// absolute / http / assets-rooted refs pass through unchanged.
function resolveRelativePath(fromPath: string, ref: string): string {
    if (ref.startsWith('/') || ref.startsWith('http') || ref.startsWith('assets/')) {
        return ref;
    }
    const dir = fromPath.substring(0, fromPath.lastIndexOf('/'));
    return dir ? `${dir}/${ref}` : ref;
}
