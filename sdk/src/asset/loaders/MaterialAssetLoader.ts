// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, MaterialResult } from '../AssetLoader';
import { isBuiltinAssetRef, resolveDocumentRef } from '../documentRef';
import type { MaterialAssetData } from '../../render/material';
import { Material } from '../../render/material';
import { assetPropertyProblems } from '../../render/materialProblems';
import type { MaterialShaderSource } from './MaterialShaderAssetLoader';
import { log } from '../../util/logger';

export class MaterialAssetLoader implements AssetLoader<MaterialResult> {
    readonly type = 'material';
    readonly extensions = ['.esmaterial'];

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
            const parent = await ctx.acquireAsset<MaterialResult>('material', parentPath);
            const handle = Material.createFromAsset(data, 0, parent.value.handle);
            const missing = await this.applyTextureProps(handle, data, path, ctx);
            ctx.noteAssetProblems?.(path, [...assetPropertyProblems(data.properties), ...missing]);
            return { handle, shaderHandle: parent.value.shaderHandle };
        }

        // Enabled static switches select the shader permutation (compiled once per switch-set).
        const features = enabledSwitches(data.switches);
        const shaderPath = isBuiltinAssetRef(data.shader) ? data.shader : resolveDocumentRef(path, data.shader);
        const source = await ctx.acquireAsset<MaterialShaderSource>('material-shader', shaderPath);
        const shaderHandle = source.value.compile(features);
        const handle = Material.createFromAsset(data, shaderHandle);
        const missing = await this.applyTextureProps(handle, data, path, ctx);
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
    ): Promise<string[]> {
        const problems: string[] = [];
        for (const [name, value] of Object.entries(data.properties)) {
            if (typeof value !== 'string') continue;
            const texPath = resolveDocumentRef(matPath, value);
            ctx.noteMaterialTexture?.(matPath, texPath);
            try {
                const tex = await ctx.acquireTexture(texPath);
                Material.setUniform(handle, name, Material.tex(tex.value.handle));
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


