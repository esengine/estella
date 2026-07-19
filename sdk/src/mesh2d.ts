// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Mesh2D geometry API — uploads a Mesh2D component's local-space geometry to the
 * engine (mesh2d_setGeometry) and carries it through scene save/load as an
 * out-of-band field (variable-size payloads are not C++ component fields).
 */
import type { App, Plugin } from './app';
import type { Entity } from './types';
import type { ESEngineModule, CppRegistry } from './wasm';
import type { Mesh2DGeometry } from './component';
import { defineResource } from './resource';
import { registerSceneComponentCodec } from './scene';
import { withScratch } from './wasmScratch';

function packRgba(colors: number[], v: number): number {
    const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    return (clamp(colors[v * 4 + 0] ?? 1)
        | (clamp(colors[v * 4 + 1] ?? 1) << 8)
        | (clamp(colors[v * 4 + 2] ?? 1) << 16)
        | (clamp(colors[v * 4 + 3] ?? 1) << 24)) >>> 0;
}

export class Mesh2DAPI {
    /** Entity → authored geometry, so scene save round-trips what was uploaded. */
    private readonly authored_ = new Map<number, Mesh2DGeometry>();

    constructor(
        private readonly module_: ESEngineModule,
        private readonly registry_: CppRegistry,
    ) {}

    /**
     * Upload geometry for an entity's Mesh2D component. Positions are x,y pairs in
     * component-local space; uvs default to 0,0 (untextured meshes render vertex
     * colors on the white texture); colors are r,g,b,a floats per vertex.
     */
    setGeometry(entity: Entity, geometry: Mesh2DGeometry): void {
        const m = this.module_;
        if (!m.mesh2d_setGeometry) return;
        const vertexCount = Math.floor(geometry.positions.length / 2);
        const indexCount = geometry.indices.length;
        if (vertexCount === 0 || indexCount === 0) {
            this.clearGeometry(entity);
            return;
        }

        withScratch(m, alloc => {
            const posUvPtr = alloc(vertexCount * 4 * 4);
            const posUv = new Float32Array(m.HEAPU8.buffer, posUvPtr, vertexCount * 4);
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
                const packed = new Uint32Array(m.HEAPU8.buffer, colorsPtr, vertexCount);
                for (let v = 0; v < vertexCount; v++) packed[v] = packRgba(colors, v);
            }

            const indicesPtr = alloc(indexCount * 4);
            new Uint32Array(m.HEAPU8.buffer, indicesPtr, indexCount).set(geometry.indices);

            m.mesh2d_setGeometry!(this.registry_, entity, posUvPtr, vertexCount,
                                  colorsPtr, indicesPtr, indexCount);
        });
        this.authored_.set(entity, geometry);
    }

    /** Clear an entity's mesh geometry (a valid state: the mesh renders nothing). */
    clearGeometry(entity: Entity): void {
        this.module_.mesh2d_setGeometry?.(this.registry_, entity, 0, 0, 0, 0, 0);
        this.authored_.delete(entity);
    }

    /** The last geometry uploaded for this entity (scene-export source). */
    getGeometry(entity: Entity): Mesh2DGeometry | undefined {
        return this.authored_.get(entity);
    }
}

export const Meshes2D = defineResource<Mesh2DAPI>(null!, 'Meshes2D');

export class Mesh2DPlugin implements Plugin {
    name = 'mesh2d';
    private offDespawn_: (() => void) | null = null;

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new Mesh2DAPI(module, registry);
        app.insertResource(Meshes2D, api);

        this.offDespawn_ = app.world.onDespawn((entity: Entity) => {
            if (api.getGeometry(entity)) api.clearGeometry(entity);
        });

        // The geometry payload is authored in the component data but isn't a C++
        // field — carry it out-of-band and upload it through the validated entry
        // point on load (the same pattern as particle gradients / tilemap chunks).
        registerSceneComponentCodec('Mesh2D', {
            outOfBandFields: ['geometry'],
            importData: (entity, outOfBand) => {
                const g = outOfBand.geometry as Mesh2DGeometry | undefined;
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

export const mesh2dPlugin = new Mesh2DPlugin();
