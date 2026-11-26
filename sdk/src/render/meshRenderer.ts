// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * MeshRenderer geometry API — uploads a MeshRenderer component's local-space geometry to the
 * engine (meshRenderer_setGeometry) and carries it through scene save/load as an
 * out-of-band field (variable-size payloads are not C++ component fields).
 */
import type { App, Plugin } from '../app/app';
import { PluginInstallations } from '../app/pluginInstallations';
import { disposeAll } from '../util/disposeAll';
import type { Entity } from '../types';
import type { CppRegistry } from '../wasm';
import type { EngineApi } from '../ecs/bridge/engineApi';
import { engineApi } from '../ecs/bridge/engineApi';
import type { MeshRendererGeometry } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import { registerWorldSceneComponentCodec } from '../scene/scene';
import { withScratch } from '../wasm/wasmScratch';
import { installBlobShadows } from './blobShadow';

function packRgba(colors: number[], v: number): number {
    const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    return (clamp(colors[v * 4 + 0] ?? 1)
        | (clamp(colors[v * 4 + 1] ?? 1) << 8)
        | (clamp(colors[v * 4 + 2] ?? 1) << 16)
        | (clamp(colors[v * 4 + 3] ?? 1) << 24)) >>> 0;
}

/** The inline vertices are the codec's, not a field's — known before the plugin builds (scene.ts declares them as well). */
const OUT_OF_BAND = ['geometry'] as const;

function copyGeometry(geometry: MeshRendererGeometry): MeshRendererGeometry {
    const copy = { ...geometry, positions: geometry.positions.slice(), indices: geometry.indices.slice() };
    if (geometry.uvs) copy.uvs = geometry.uvs.slice();
    if (geometry.colors) copy.colors = geometry.colors.slice();
    return copy;
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
        const upload = m.meshRenderer_trySetGeometry ?? m.meshRenderer_setGeometry;
        // A core that compiles no mesh renderer, or marshals no buffers, uploads nothing.
        // The heap is wasm linear memory on the web and the host's arena on a
        // device — the writes below are identical either way.
        if (!upload || !m._malloc || !m._free || !m.HEAPU8) return;
        const allocator = { _malloc: m._malloc, _free: m._free };
        const vertexCount = Math.floor(geometry.positions.length / 2);
        const indexCount = geometry.indices.length;
        if (vertexCount === 0 || indexCount === 0) {
            this.clearGeometry(entity);
            return;
        }

        const captured = copyGeometry(geometry);
        const accepted = withScratch<boolean | void>(allocator, alloc => {
            const colors = captured.colors;
            const hasColors = !!colors?.length;
            const posUvPtr = alloc(vertexCount * 4 * 4);
            const colorsPtr = hasColors ? alloc(vertexCount * 4) : 0;
            const indicesPtr = alloc(indexCount * 4);
            if (!posUvPtr || !indicesPtr || (hasColors && !colorsPtr)) throw new Error('Could not allocate mesh geometry');
            // Any allocation can grow linear memory and detach earlier heap views.
            const buffer = m.HEAPU8!.buffer;
            const posUv = new Float32Array(buffer, posUvPtr, vertexCount * 4);
            const uvs = captured.uvs;
            for (let v = 0; v < vertexCount; v++) {
                posUv[v * 4 + 0] = captured.positions[v * 2 + 0] ?? 0;
                posUv[v * 4 + 1] = captured.positions[v * 2 + 1] ?? 0;
                posUv[v * 4 + 2] = uvs?.[v * 2 + 0] ?? 0;
                posUv[v * 4 + 3] = uvs?.[v * 2 + 1] ?? 0;
            }

            if (hasColors) {
                const packed = new Uint32Array(buffer, colorsPtr, vertexCount);
                for (let v = 0; v < vertexCount; v++) packed[v] = packRgba(colors, v);
            }

            new Uint32Array(buffer, indicesPtr, indexCount).set(captured.indices);

            return upload(this.registry_, entity, posUvPtr, vertexCount,
                   colorsPtr, indicesPtr, indexCount);
        });
        if (accepted !== false) this.authored_.set(entity, captured);
    }

    /** Clear an entity's mesh geometry (a valid state: the mesh renders nothing). */
    clearGeometry(entity: Entity): void {
        const upload = this.module_.meshRenderer_trySetGeometry ?? this.module_.meshRenderer_setGeometry;
        upload?.(this.registry_, entity, 0, 0, 0, 0, 0);
        this.authored_.delete(entity);
    }

    /** @internal Whether the entity carries uploaded inline geometry. */
    hasGeometry(entity: Entity): boolean {
        return this.authored_.has(entity);
    }

    /** A copy of the last inline geometry uploaded for this entity. */
    getGeometry(entity: Entity): MeshRendererGeometry | undefined {
        const geometry = this.authored_.get(entity);
        return geometry && copyGeometry(geometry);
    }
}

export const MeshRenderers = defineResource<MeshRendererAPI>(null!, 'MeshRenderers');

export class MeshRendererPlugin implements Plugin {
    name = 'meshRenderer';
    readonly profileDomain = 'render';
    private readonly cleanups_ = new PluginInstallations<Array<() => void>>();

    build(app: App): void {
        this.cleanup(app);
        const cleanups: Array<() => void> = [];
        this.cleanups_.set(app, cleanups);
        // `?? {}`: an app with no engine core (a test, a pure-logic host) still gets
        // the resource, and every call through it no-ops.
        const engine = engineApi(app) ?? {};
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new MeshRendererAPI(engine, registry);
        app.insertResource(MeshRenderers, api);
        // A BlobShadow on an entity is a mesh this plugin draws; with none in the scene its system finds nothing and returns.
        cleanups.push(installBlobShadows(app));

        cleanups.push(app.world.onDespawn((entity: Entity) => {
            if (api.hasGeometry(entity)) api.clearGeometry(entity);
        }));

        // The geometry payload is authored in the component data but isn't a C++
        // field — carry it out-of-band and upload it through the validated entry
        // point on load (the same pattern as particle gradients / tilemap chunks).
        cleanups.push(registerWorldSceneComponentCodec(app.world, 'MeshRenderer', {
            outOfBandFields: OUT_OF_BAND,
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
        }));
    }

    cleanup(app?: App): void {
        disposeAll(this.cleanups_.take(app) ?? [], release => release(), true);
    }
}

export const meshRendererPlugin = new MeshRendererPlugin();
