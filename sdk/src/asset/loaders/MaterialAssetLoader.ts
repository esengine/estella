// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, MaterialResult } from '../AssetLoader';
import { resolveIndexedSiblingRef } from '../documentRef';
import type { MaterialAssetData } from '../../render/material';
import { Material } from '../../render/material';
import { assetPropertyProblems } from '../../render/materialProblems';
import type { MaterialShaderSource } from './MaterialShaderAssetLoader';
import { log } from '../../util/logger';

export class MaterialAssetLoader implements AssetLoader<MaterialResult> {
    readonly type = 'material';
    readonly bindsTextures = true;
    readonly extensions = ['.esmaterial'];

    async load(file: string, ctx: LoadContext, buildPath = ctx.catalog.getBuildPath(file)): Promise<MaterialResult> {
        const path = ctx.sourceAddressOf?.(file) ?? file;
        const text = await ctx.loadText(buildPath);
        const build = await this.prepareDocument(JSON.parse(text) as MaterialAssetData, path, ctx);
        return build();
    }

    /** Resolve and own dependencies first. The caller controls when the GPU material is created. */
    async prepareDocument(data: MaterialAssetData, path: string, ctx: LoadContext, reportProblems = true): Promise<() => MaterialResult> {
        if (data.type !== 'material') {
            throw new Error(`Invalid material file type: ${data.type} at ${path}`);
        }
        const resolve = (ref: string) => resolveIndexedSiblingRef(path, ref, candidate => ctx.assetTypeOf?.(candidate) !== undefined);

        // A material instance (`instanceOf`) inherits its parent's shader + state; load the
        // parent first, then build the instance from the asset's diffs. Parent shader resolution
        // and uniforms come from the parent material, so no shader is loaded here.
        const parent = data.instanceOf
            ? (await ctx.acquireAsset<MaterialResult>('material', resolve(data.instanceOf))).value
            : undefined;
        const shaderHandle = parent ? parent.shaderHandle
            : (await ctx.acquireAsset<MaterialShaderSource>('material-shader', resolve(data.shader))).value.compile(enabledSwitches(data.switches));
        const textures: { name: string; path: string }[] = [];
        for (const [name, value] of Object.entries(data.properties)) {
            if (typeof value !== 'string' || !value) continue;
            const texPath = resolve(value);
            ctx.noteMaterialTexture?.(path, texPath);
            textures.push({ name, path: texPath });
        }
        // The preparation owns these acquisitions. Let every map settle before committing it.
        const results = textures.length ? await Promise.allSettled(textures.map(async ({ path }) => ctx.acquireTexture(path))) : [];
        return () => {
            const handle = Material.createFromAsset(data, parent ? 0 : shaderHandle, parent?.handle);
            try {
                const problems: string[] = [];
                for (const [index, result] of results.entries()) {
                    const { name, path: texPath } = textures[index];
                    try {
                        if (result.status === 'rejected') throw result.reason;
                        Material.setUniform(handle, name, Material.tex(result.value.value.handle));
                    } catch (error) {
                        log.warn('asset', `Material ${path}: failed to load texture '${texPath}' for param '${name}'`, error);
                        problems.push(`${name}: the texture "${texPath}" did not load (${error instanceof Error ? error.message : String(error)}), so the surface draws without it`);
                    }
                }
                if (reportProblems) ctx.noteAssetProblems?.(path, [...assetPropertyProblems(data.properties), ...problems]);
                return { handle, shaderHandle };
            } catch (error) {
                Material.release(handle);
                throw error;
            }
        };
    }

    unload(asset: MaterialResult): void {
        Material.release(asset.handle);
    }

}

// The enabled static switches, sorted for a stable permutation cache key.
function enabledSwitches(switches: Record<string, boolean> | undefined): string[] {
    if (!switches) return [];
    return Object.entries(switches).filter(([, on]) => on).map(([name]) => name).sort();
}


