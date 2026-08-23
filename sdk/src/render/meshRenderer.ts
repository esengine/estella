// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * MeshRenderer geometry API — uploads a MeshRenderer component's local-space geometry to the
 * engine (meshRenderer_setGeometry) and carries it through scene save/load as an
 * out-of-band field (variable-size payloads are not C++ component fields).
 */
import type { App, Plugin } from '../app/app';
import type { Entity } from '../types';
import type { CppRegistry } from '../wasm';
import type { EngineApi } from '../ecs/bridge/engineApi';
import { engineApi } from '../ecs/bridge/engineApi';
import type { MeshRendererGeometry } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import { registerSceneComponentCodec } from '../scene/scene';
import { withScratch } from '../wasm/wasmScratch';

function packRgba(colors: number[], v: number): number {
    const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    return (clamp(colors[v * 4 + 0] ?? 1)
        | (clamp(colors[v * 4 + 1] ?? 1) << 8)
        | (clamp(colors[v * 4 + 2] ?? 1) << 16)
        | (clamp(colors[v * 4 + 3] ?? 1) << 24)) >>> 0;
}

export class MeshRendererAPI {
    /** Entity → authored geometry, so scene save round-trips what was uploaded. */
    private readonly authored_ = new Map<number, MeshRendererGeometry>();

    constructor(
        /** Whichever engine core is present (see ecs/engineApi.ts). */
        private readonly module_: NonNullable<EngineApi>,
        private readonly registry_: CppRegistry,
    ) {}

    /**
     * Upload geometry for an entity's MeshRenderer component. Positions are x,y pairs in
     * component-local space; uvs default to 0,0 (untextured meshes render vertex
     * colors on the white texture); colors are r,g,b,a floats per vertex.
     */
    setGeometry(entity: Entity, geometry: MeshRendererGeometry): void {
        const m = this.module_;
        const upload = m.meshRenderer_setGeometry;
        // A core that compiles no mesh renderer, or marshals no buffers, uploads nothing.
        // The heap is wasm linear memory on the web and the host's arena on a
        // device — the writes below are identical either way.
        if (!upload || !m._malloc || !m._free || !m.HEAPU8) return;
        const heap = m.HEAPU8;
        const allocator = { _malloc: m._malloc, _free: m._free };
        const vertexCount = Math.floor(geometry.positions.length / 2);
        const indexCount = geometry.indices.length;
        if (vertexCount === 0 || indexCount === 0) {
            this.clearGeometry(entity);
            return;
        }

        withScratch(allocator, alloc => {
            const posUvPtr = alloc(vertexCount * 4 * 4);
            const posUv = new Float32Array(heap.buffer, posUvPtr, vertexCount * 4);
            const uvs = geometry.uvs;
            for (let v = 0; v < vertexCount; v++) {
                posUv[v * 4 + 0] = geometry.positions[v * 2 + 0] ?? 0;
                posUv[v * 4 + 1] = geometry.positions[v * 2 + 1] ?? 0;
                posUv[v * 4 + 2] = uvs?.[v * 2 + 0] ?? 0;
                posUv[v * 4 + 3] = uvs?.[v * 2 + 1] ?? 0;
            }

            let colorsPtr = 0;
            const colors = geometry.colors;
            if (colors && colors.length > 0) {
                colorsPtr = alloc(vertexCount * 4);
                const packed = new Uint32Array(heap.buffer, colorsPtr, vertexCount);
                for (let v = 0; v < vertexCount; v++) packed[v] = packRgba(colors, v);
            }

            const indicesPtr = alloc(indexCount * 4);
            new Uint32Array(heap.buffer, indicesPtr, indexCount).set(geometry.indices);

            upload(this.registry_, entity, posUvPtr, vertexCount,
                   colorsPtr, indicesPtr, indexCount);
        });
        this.authored_.set(entity, geometry);
    }

    /** Clear an entity's mesh geometry (a valid state: the mesh renders nothing). */
    clearGeometry(entity: Entity): void {
        this.module_.meshRenderer_setGeometry?.(this.registry_, entity, 0, 0, 0, 0, 0);
        this.authored_.delete(entity);
    }

    /** The last geometry uploaded for this entity (scene-export source). */
    getGeometry(entity: Entity): MeshRendererGeometry | undefined {
        return this.authored_.get(entity);
    }
}

export const MeshRenderers = defineResource<MeshRendererAPI>(null!, 'MeshRenderers');

export class MeshRendererPlugin implements Plugin {
    name = 'meshRenderer';
    readonly profileDomain = 'render';
    private offDespawn_: (() => void) | null = null;

    build(app: App): void {
        // `?? {}`: an app with no engine core (a test, a pure-logic host) still gets
        // the resource, and every call through it no-ops.
        const engine = engineApi(app) ?? {};
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new MeshRendererAPI(engine, registry);
        app.insertResource(MeshRenderers, api);

        this.offDespawn_ = app.world.onDespawn((entity: Entity) => {
            if (api.getGeometry(entity)) api.clearGeometry(entity);
        });

        // The geometry payload is authored in the component data but isn't a C++
        // field — carry it out-of-band and upload it through the validated entry
        // point on load (the same pattern as particle gradients / tilemap chunks).
        registerSceneComponentCodec('MeshRenderer', {
            outOfBandFields: ['geometry'],
            importData: (entity, outOfBand) => {
                const g = outOfBand.geometry as MeshRendererGeometry | undefined;
                if (g && g.positions?.length && g.indices?.length) {
                    api.setGeometry(entity, g);
                } else {
                    api.clearGeometry(entity);
                }
            },
            exportData: (entity, data) => {
                const g = api.getGeometry(entity);
                if (g) data.geometry = g;
            },
        });
    }

    cleanup(): void {
        this.offDespawn_?.();
        this.offDespawn_ = null;
    }
}

export const meshRendererPlugin = new MeshRendererPlugin();
