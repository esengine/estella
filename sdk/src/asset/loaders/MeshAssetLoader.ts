// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import type { ESEngineModule } from '../../wasm';
import { withScratch } from '../../wasm/wasmScratch';
import { decodeMesh, encodeChannelTable } from '../meshFormat';

/** A mesh uploaded to the GPU, named by the handle everything else references. */
export interface MeshResult {
    handle: number;
}

/**
 * Loads `.esmesh` — geometry that goes to the GPU once and is drawn from there.
 *
 * The file describes its own channels, and that table crosses to the engine in
 * the file's own byte layout: this layer owns the format, the engine owns the
 * vertex layout it becomes, and neither restates the other.
 */
export class MeshAssetLoader implements AssetLoader<MeshResult> {
    readonly type = 'mesh';
    readonly extensions = ['.esmesh'];

    /** Lazy like the audio loader's: unload/invalidate have no LoadContext. */
    constructor(private readonly module_: () => ESEngineModule | null) {}

    async load(path: string, ctx: LoadContext): Promise<MeshResult> {
        const bytes = new Uint8Array(await ctx.loadBinary(ctx.catalog.getBuildPath(path)));
        const mesh = decodeMesh(bytes);
        const table = encodeChannelTable(mesh.channels);
        const m = this.module_();
        if (!m?.mesh_createFromChannels) {
            throw new Error('this engine build carries no mesh_createFromChannels');
        }

        const handle = withScratch(m, (alloc) => {
            const tablePtr = alloc(table.byteLength);
            const vertexPtr = alloc(mesh.vertices.byteLength);
            const indexPtr = alloc(mesh.indices.byteLength);
            // The bind pose goes over with the geometry: the Joints channel
            // indexes it, so an engine holding one without the other could only
            // guess what a vertex is bound to.
            const bind = mesh.inverseBindMatrices;
            const bindPtr = bind ? alloc(bind.byteLength) : 0;
            m.HEAPU8.set(table, tablePtr);
            m.HEAPU8.set(mesh.vertices, vertexPtr);
            m.HEAPU8.set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset,
                                        mesh.indices.byteLength), indexPtr);
            if (bind) {
                m.HEAPU8.set(new Uint8Array(bind.buffer, bind.byteOffset, bind.byteLength), bindPtr);
            }
            return m.mesh_createFromChannels!(
                tablePtr, mesh.channels.length, mesh.vertexStride,
                vertexPtr, mesh.vertices.byteLength,
                indexPtr, mesh.indices.length,
                mesh.aabbMin[0], mesh.aabbMin[1], mesh.aabbMin[2],
                mesh.aabbMax[0], mesh.aabbMax[1], mesh.aabbMax[2],
                bindPtr, bind?.length ?? 0);
        });

        if (!handle) throw new Error(`the engine rejected the geometry in ${path}`);
        return { handle };
    }

    unload(asset: MeshResult): void {
        this.module_()?.mesh_release?.(asset.handle);
    }
}
