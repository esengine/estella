// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import { decodeMeshSdf, type MeshSdf } from '../../gi/meshSdfFormat';

/**
 * Loads `.esmeshsdf` — the signed distance field baked beside a mesh at import. Plain memory: the dynamic GI composes it into its
 * clipmaps, so nothing here belongs to the GPU and unloading has nothing to free.
 */
export class MeshSdfAssetLoader implements AssetLoader<MeshSdf> {
    readonly type = 'meshSdf';
    readonly extensions = ['.esmeshsdf'];

    async load(path: string, ctx: LoadContext): Promise<MeshSdf> {
        const bytes = new Uint8Array(await ctx.loadBinary(ctx.catalog.getBuildPath(path)));
        try {
            return decodeMeshSdf(bytes);
        } catch (err) {
            throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    unload(): void {
        // Decoded distances are ordinary arrays the caller may still hold.
    }
}
