// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import { decodeMeshCards, type MeshCards } from '../../gi/cardFormat';

/**
 * Loads `.esmeshcards` — the six axis views of a mesh the dynamic GI's surface cache lights. Plain memory, like the distance field.
 */
export class MeshCardsAssetLoader implements AssetLoader<MeshCards> {
    readonly type = 'meshCards';
    readonly extensions = ['.esmeshcards'];

    async load(path: string, ctx: LoadContext): Promise<MeshCards> {
        const bytes = new Uint8Array(await ctx.loadBinary(ctx.catalog.getBuildPath(path)));
        try {
            return decodeMeshCards(bytes);
        } catch (err) {
            throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    unload(): void {
        // Decoded arrays are ordinary memory the caller may still hold.
    }
}
