// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import type { EngineApi } from '../../ecs/bridge/engineApi';
import { marshallingCore } from './engineCore';
import { withScratch } from '../../wasm/wasmScratch';
import { decodeMesh, encodeChannelTable, MESH_CLUSTER_BOUNDS_FLOATS, type MeshClusters, type MeshData } from '../meshFormat';
import { builtinMeshTemplate, isBuiltinMeshRef } from '../builtinMeshes';
import { extractPositions, registerMeshCollision, releaseMeshCollision } from '../meshCollision';

/** One cluster as the engine takes it: first index, index count, ten floats of bounds (lod::Cluster). */
const CLUSTER_RECORD_BYTES = 48;

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

    /** The decoded source behind a mesh path — what a tool that rebuilds geometry (a static batch) starts from. */
    readSource(path: string, ctx: LoadContext): Promise<MeshData> {
        return this.decode_(path, ctx);
    }

    /** Uploads geometry that has no file under it; `target` 0 mints a handle, otherwise the existing one is re-realized. */
    uploadData(mesh: MeshData, target = 0): number {
        return this.upload_(mesh, target);
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
            // The shapes go over for the same reason: a delta is addressed by a
            // vertex index, so the engine holding one without the other could
            // only guess which vertex a shape moves.
            const morph = mesh.morph;
            const morphPtr = morph ? alloc(morph.deltas.byteLength) : 0;
            m!.HEAPU8.set(table, tablePtr);
            m!.HEAPU8.set(mesh.vertices, vertexPtr);
            m!.HEAPU8.set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset,
                                         mesh.indices.byteLength), indexPtr);
            if (bind) {
                m!.HEAPU8.set(new Uint8Array(bind.buffer, bind.byteOffset, bind.byteLength),
                              bindPtr);
            }
            if (morph) {
                m!.HEAPU8.set(new Uint8Array(morph.deltas.buffer, morph.deltas.byteOffset,
                                             morph.deltas.byteLength), morphPtr);
            }
            const shapes: [number, number, number, number] = [
                morphPtr, morph?.deltas.length ?? 0, morph?.names.length ?? 0,
                morph?.hasNormals ? 1 : 0,
            ];
            const handle = mint
                ? m!.mesh_createFromChannels!(
                    tablePtr, mesh.channels.length, mesh.vertexStride,
                    vertexPtr, mesh.vertices.byteLength,
                    indexPtr, mesh.indices.length,
                    mesh.aabbMin[0], mesh.aabbMin[1], mesh.aabbMin[2],
                    mesh.aabbMax[0], mesh.aabbMax[1], mesh.aabbMax[2],
                    bindPtr, bind?.length ?? 0, ...shapes)
                : m!.mesh_rematerializeFromChannels!(
                    target,
                    tablePtr, mesh.channels.length, mesh.vertexStride,
                    vertexPtr, mesh.vertices.byteLength,
                    indexPtr, mesh.indices.length,
                    mesh.aabbMin[0], mesh.aabbMin[1], mesh.aabbMin[2],
                    mesh.aabbMax[0], mesh.aabbMax[1], mesh.aabbMax[2],
                    bindPtr, bind?.length ?? 0, ...shapes);
            if (handle && mesh.clusters) this.uploadClusters_(m!, alloc, handle, mesh, mesh.clusters);
            return handle;
        });
    }

    /**
     * Hands a realized mesh its cluster hierarchy. After the geometry, and again whenever it is realized again: the
     * engine drops the hierarchy with the vertices it names. An engine without the call, or one that refuses the
     * hierarchy, draws the mesh whole from the level-0 indices it already has.
     */
    private uploadClusters_(m: NonNullable<ReturnType<typeof marshallingCore>>, alloc: (bytes: number) => number,
                            handle: number, mesh: MeshData, clusters: MeshClusters): void {
        if (!m.mesh_setClusters) return;
        const count = clusters.ranges.length / 2;
        const records = new Uint8Array(count * CLUSTER_RECORD_BYTES);
        const view = new DataView(records.buffer);
        for (let c = 0; c < count; c++) {
            const at = c * CLUSTER_RECORD_BYTES;
            view.setUint32(at, clusters.ranges[c * 2]!, true);
            view.setUint32(at + 4, clusters.ranges[c * 2 + 1]!, true);
            for (let k = 0; k < MESH_CLUSTER_BOUNDS_FLOATS; k++) {
                view.setFloat32(at + 8 + k * 4, clusters.bounds[c * MESH_CLUSTER_BOUNDS_FLOATS + k]!, true);
            }
        }
        const indexCount = mesh.indices.length + clusters.coarseIndices.length;
        const recordPtr = alloc(records.byteLength);
        const indexPtr = alloc(indexCount * 4);
        m.HEAPU8.set(records, recordPtr);
        m.HEAPU8.set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength), indexPtr);
        m.HEAPU8.set(new Uint8Array(clusters.coarseIndices.buffer, clusters.coarseIndices.byteOffset,
                                    clusters.coarseIndices.byteLength), indexPtr + mesh.indices.byteLength);
        m.mesh_setClusters(handle, recordPtr, count, indexPtr, indexCount);
    }

    /** Gives back a handle {@link uploadData} minted. */
    releaseData(handle: number): void {
        this.core_()?.mesh_release?.(handle);
    }

    unload(asset: MeshResult): void {
        releaseMeshCollision(asset.handle);
        this.core_()?.mesh_release?.(asset.handle);
    }
}
