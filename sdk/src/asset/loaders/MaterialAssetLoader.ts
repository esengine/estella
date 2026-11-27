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
        const data = JSON.parse(text) as MaterialAssetData;

        if (data.type !== 'material') {
            throw new Error(`Invalid material file type: ${data.type} at ${path}`);
        }
        const resolve = (ref: string) => resolveIndexedSiblingRef(path, ref, candidate => ctx.assetTypeOf?.(candidate) !== undefined);

        // A material instance (`instanceOf`) inherits its parent's shader + state; load the
        // parent first, then build the instance from the asset's diffs. Parent shader resolution
        // and uniforms come from the parent material, so no shader is loaded here.
        if (data.instanceOf) {
            const parentPath = resolve(data.instanceOf);
            const parent = await ctx.acquireAsset<MaterialResult>('material', parentPath);
            const handle = Material.createFromAsset(data, 0, parent.value.handle);
            const missing = await this.applyTextureProps(handle, data, path, ctx, resolve);
            ctx.noteAssetProblems?.(path, [...assetPropertyProblems(data.properties), ...missing]);
            return { handle, shaderHandle: parent.value.shaderHandle };
        }

        // Enabled static switches select the shader permutation (compiled once per switch-set).
        const features = enabledSwitches(data.switches);
        const shaderPath = resolve(data.shader);
        const source = await ctx.acquireAsset<MaterialShaderSource>('material-shader', shaderPath);
        const shaderHandle = source.value.compile(features);
        const handle = Material.createFromAsset(data, shaderHandle);
        const missing = await this.applyTextureProps(handle, data, path, ctx, resolve);
        // The material loaded, and draws with what could be read. Said once, where the editor's diagnostics and an agent can find it: a surface
        // that quietly falls back to the default look is otherwise indistinguishable from one that is meant to look that way.
        ctx.noteAssetProblems?.(path, [...assetPropertyProblems(data.properties), ...missing]);

        return { handle, shaderHandle };
    }

    // A texture param is a string property (an asset ref); scalar/vector params are
    // numbers/objects (handled by createFromAsset). The acquisition holds the
    // receipt — this material's era gives it back — so binding is all there is
    // to do here.
    private async applyTextureProps(
        handle: number,
        data: MaterialAssetData,
        matPath: string,
        ctx: LoadContext,
        resolve: (ref: string) => string,
    ): Promise<string[]> {
        const textures: { name: string; path: string }[] = [];
        for (const [name, value] of Object.entries(data.properties)) {
            if (typeof value !== 'string' || !value) continue;
            const texPath = resolve(value);
            ctx.noteMaterialTexture?.(matPath, texPath);
            textures.push({ name, path: texPath });
        }
        if (!textures.length) return [];

        // The preparation owns these acquisitions. Let every map settle before committing it.
        const results = await Promise.allSettled(textures.map(async ({ path }) => ctx.acquireTexture(path)));
        const problems: string[] = [];
        for (const [index, result] of results.entries()) {
            const { name, path: texPath } = textures[index];
            try {
                if (result.status === 'rejected') throw result.reason;
                Material.setUniform(handle, name, Material.tex(result.value.value.handle));
            } catch (e) {
                // Missing texture: leave the param unbound (it samples whatever is at the unit).
                log.warn('asset', `Material ${matPath}: failed to load texture '${texPath}' for param '${name}'`, e);
                problems.push(`${name}: the texture "${texPath}" did not load (${e instanceof Error ? e.message : String(e)}), so the surface draws without it`);
            }
        }
        return problems;
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


