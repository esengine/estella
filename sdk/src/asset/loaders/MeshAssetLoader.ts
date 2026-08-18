// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import type { ESEngineModule } from '../../wasm';
import { withScratch } from '../../wasm/wasmScratch';
import { decodeMesh, encodeChannelTable } from '../meshFormat';
import { builtinMeshTemplate, isBuiltinMeshRef } from '../builtinMeshes';
import { extractPositions, registerMeshCollision, releaseMeshCollision } from '../meshCollision';

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
 *
 * A `builtin:<id>` ref is the same geometry with no file under it — built here,
 * in the layout the model import writes, and uploaded down the identical path.
 */
export class MeshAssetLoader implements AssetLoader<MeshResult> {
    readonly type = 'mesh';
    readonly extensions = ['.esmesh'];

    /** Lazy like the audio loader's: unload/invalidate have no LoadContext. */
    constructor(private readonly module_: () => ESEngineModule | null) {}

    async load(path: string, ctx: LoadContext): Promise<MeshResult> {
        const builtin = isBuiltinMeshRef(path) ? builtinMeshTemplate(path) : undefined;
        const mesh = builtin
            ? builtin.build()
            : decodeMesh(new Uint8Array(await ctx.loadBinary(ctx.catalog.getBuildPath(path))));
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
        // The triangles the decode already produced, kept for whoever needs shape
        // rather than pixels — a collider cannot ask the GPU what it uploaded.
        const positions = extractPositions(mesh.vertices, mesh.vertexCount,
                                           mesh.vertexStride, mesh.channels);
        if (positions) registerMeshCollision(handle, { positions, indices: mesh.indices });
        return { handle };
    }

    unload(asset: MeshResult): void {
        releaseMeshCollision(asset.handle);
        this.module_()?.mesh_release?.(asset.handle);
    }
}
