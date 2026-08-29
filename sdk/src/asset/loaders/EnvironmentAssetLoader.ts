// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import { resolveDocumentRef } from '../documentRef';
import type { EngineApi } from '../../ecs/bridge/engineApi';
import { marshallingCore } from './engineCore';
import { withScratch } from '../../wasm/wasmScratch';
import { log } from '../../util/logger';

/** The `.esenv` document, as the importer wrote it. */
interface EnvironmentAssetData {
    version: number;
    irradiance: number[];
    /** Project path of the prefiltered octahedral atlas. */
    specular?: string;
    faceSize?: number;
    mipCount?: number;
    maxRange?: number;
}

/** A baked environment, named by the handle a Light references. */
export interface EnvironmentResult {
    handle: number;
}

/**
 * Loads `.esenv` — an environment's irradiance and its prefiltered reflection.
 *
 * The reflection is an ordinary texture asset, acquired through the same door as
 * any other — so the preparation holds the receipt and the era gives it back.
 * Only the nine coefficients are the environment's own.
 */
export class EnvironmentAssetLoader implements AssetLoader<EnvironmentResult> {
    readonly type = 'environment';
    readonly extensions = ['.esenv'];

    /** Lazy like the mesh loader's: the module arrives after construction. */
    constructor(private readonly core_: () => EngineApi | null) {}

    async load(path: string, ctx: LoadContext): Promise<EnvironmentResult> {
        const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
        const data = JSON.parse(text) as EnvironmentAssetData;
        if (!Array.isArray(data.irradiance) || data.irradiance.length !== 27) {
            throw new Error(`${path}: an environment is nine RGB coefficients, got `
                + `${data.irradiance?.length ?? 0} numbers`);
        }
        const m = marshallingCore(this.core_());
        if (!m?.environment_create) {
            throw new Error('this engine build carries no environment_create');
        }

        // A missing atlas leaves the environment diffuse-only rather than failing
        // the load: nine coefficients still light the scene, and a reflection that
        // silently took the whole asset down would be the worse answer.
        let specularHandle = 0;
        if (data.specular) {
            const resolved = resolveDocumentRef(path, data.specular);
            try {
                // flipY false: the atlas' rows are a layout, not a picture. Row 0
                // is mip 0, and a load that turned it over would put the mip
                // offsets — and every face's v — upside down.
                specularHandle = (await ctx.acquireTexture(resolved, false)).value.handle;
            } catch (e) {
                log.warn('asset', `${path}: no reflection atlas at '${resolved}'`, e);
            }
        }

        const handle = withScratch(m, (alloc) => {
            const shPtr = alloc(27 * 4);
            m.HEAPF32.set(Float32Array.from(data.irradiance), shPtr >> 2);
            return m.environment_create!(shPtr, specularHandle, data.faceSize ?? 0,
                                         data.mipCount ?? 0, data.maxRange ?? 0);
        });

        if (!handle) {
            throw new Error(`the engine rejected the environment in ${path}`);
        }
        return { handle };
    }

    unload(asset: EnvironmentResult): void {
        this.core_()?.environment_release?.(asset.handle);
    }
}

/** Resolve the atlas ref relative to the `.esenv`; rooted refs pass through. */

