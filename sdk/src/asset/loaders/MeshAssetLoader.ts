// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import type { EngineApi } from '../../ecs/bridge/engineApi';
import { marshallingCore } from './engineCore';
import { withScratch } from '../../wasm/wasmScratch';
import { decodeMesh, encodeChannelTable, type MeshData } from '../meshFormat';
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
    constructor(private readonly core_: () => EngineApi | null) {}

    async load(path: string, ctx: LoadContext): Promise<MeshResult> {
        const mesh = await this.decode_(path, ctx);
        const handle = this.upload_(mesh, 0);
        if (!handle) throw new Error(`the engine rejected the geometry in ${path}`);
        // The triangles the decode already produced, kept for whoever needs shape
        // rather than pixels — a collider cannot ask the GPU what it uploaded.
        const positions = extractPositions(mesh.vertices, mesh.vertexCount,
                                           mesh.vertexStride, mesh.channels);
        if (positions) registerMeshCollision(handle, { positions, indices: mesh.indices });
        return { handle };
    }

    /**
     * Puts the source back behind a handle a device loss emptied.
     *
     * The same decode and upload as {@link load}, aimed at an existing handle: a
     * second `load` would mint a new one that nothing in the world points at. The
     * collision data is CPU-side and survived the loss, so it is not rebuilt.
     */
    async rematerialize(handle: number, path: string, ctx: LoadContext): Promise<boolean> {
        return this.upload_(await this.decode_(path, ctx), handle) !== 0;
    }

    private async decode_(path: string, ctx: LoadContext): Promise<MeshData> {
        const builtin = isBuiltinMeshRef(path) ? builtinMeshTemplate(path) : undefined;
        return builtin
            ? builtin.build()
            : decodeMesh(new Uint8Array(await ctx.loadBinary(ctx.catalog.getBuildPath(path))));
    }

    /** Uploads decoded geometry; `target` 0 mints a handle, otherwise the
     *  existing one is re-realized. Returns the handle, or 0 on refusal. */
    private upload_(mesh: MeshData, target: number): number {
        const table = encodeChannelTable(mesh.channels);
        const m = marshallingCore(this.core_());
        const mint = target === 0;
        if (mint ? !m?.mesh_createFromChannels : !m?.mesh_rematerializeFromChannels) {
            throw new Error(`this engine build carries no ${
                mint ? 'mesh_createFromChannels' : 'mesh_rematerializeFromChannels'}`);
        }

        return withScratch(m!, (alloc) => {
            const tablePtr = alloc(table.byteLength);
            const vertexPtr = alloc(mesh.vertices.byteLength);
            const indexPtr = alloc(mesh.indices.byteLength);
            // The bind pose goes over with the geometry: the Joints channel
            // indexes it, so an engine holding one without the other could only
            // guess what a vertex is bound to.
            const bind = mesh.inverseBindMatrices;
            const bindPtr = bind ? alloc(bind.byteLength) : 0;
            m!.HEAPU8.set(table, tablePtr);
            m!.HEAPU8.set(mesh.vertices, vertexPtr);
            m!.HEAPU8.set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset,
                                         mesh.indices.byteLength), indexPtr);
            if (bind) {
                m!.HEAPU8.set(new Uint8Array(bind.buffer, bind.byteOffset, bind.byteLength),
                              bindPtr);
            }
            return mint
                ? m!.mesh_createFromChannels!(
                    tablePtr, mesh.channels.length, mesh.vertexStride,
                    vertexPtr, mesh.vertices.byteLength,
                    indexPtr, mesh.indices.length,
                    mesh.aabbMin[0], mesh.aabbMin[1], mesh.aabbMin[2],
                    mesh.aabbMax[0], mesh.aabbMax[1], mesh.aabbMax[2],
                    bindPtr, bind?.length ?? 0)
                : m!.mesh_rematerializeFromChannels!(
                    target,
                    tablePtr, mesh.channels.length, mesh.vertexStride,
                    vertexPtr, mesh.vertices.byteLength,
                    indexPtr, mesh.indices.length,
                    mesh.aabbMin[0], mesh.aabbMin[1], mesh.aabbMin[2],
                    mesh.aabbMax[0], mesh.aabbMax[1], mesh.aabbMax[2],
                    bindPtr, bind?.length ?? 0);
        });
    }

    unload(asset: MeshResult): void {
        releaseMeshCollision(asset.handle);
        this.core_()?.mesh_release?.(asset.handle);
    }
}
