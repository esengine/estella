// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { MeshRenderers, MeshRendererAPI, meshRendererPlugin } from '../src/render/meshRenderer';
import { MeshRenderer } from '../src/ecs/component';
import { createNativeEngineApi } from '../src/ecs/bridge/nativeEngineApi.generated';
import { loadSceneData, registerWorldSceneComponentCodec, registerWorldSceneExportFilter, serializeScene, type SceneData, type SceneExportFilter } from '../src/scene/scene';
import type { CppRegistry } from '../src/wasm';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

function triangle(size: number) {
    return { positions: [0, 0, size, 0, 0, size], indices: [0, 1, 2], colors: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1] };
}

function scene(size: number): SceneData {
    return { version: 4, name: 'map', entities: [{ id: 1, name: 'triangle', parent: null, children: [],
        components: [{ type: 'Transform', data: {} }, { type: 'MeshRenderer', data: { geometry: triangle(size) } }],
    }] };
}

describe('inline mesh geometry', () => {
    it.skipIf(!HAS_WASM)('keeps the last accepted geometry when the core rejects an upload', async () => {
        const engine = await loadWasmModule();
        const app = App.new();
        try {
            const registry = new engine.Registry();
            app.connectCpp(registry, engine, { ownedRegistry: true });
            app.addPlugin(meshRendererPlugin);
            const entity = app.world.spawn('Geometry'), api = app.getResource(MeshRenderers);
            app.world.insert(entity, MeshRenderer);
            api.setGeometry(entity, triangle(3));
            for (const indices of [[0, 1], [0, 1, 3]]) {
                api.setGeometry(entity, { ...triangle(7), indices });
                const data = serializeScene(app.world).entities[0].components.find(c => c.type === 'MeshRenderer')!.data;
                expect(data.geometry).toEqual(triangle(3));
                expect(engine.meshRenderer_localBounds!(registry, entity)).toMatchObject({ maxX: 3, maxY: 3 });
            }
            const other = app.world.spawn('No mesh');
            api.setGeometry(other, triangle(7));
            expect(api.getGeometry(other)).toBeUndefined();
            api.setGeometry(entity, triangle(4));
            expect(api.getGeometry(entity)).toEqual(triangle(4));
            api.clearGeometry(entity);
            expect(api.getGeometry(entity)).toBeUndefined();
            expect(engine.meshRenderer_localBounds!(registry, entity)).toBeNull();
        } finally { app.quit({ keepRenderer: true }); }
    });

    it.skipIf(!HAS_WASM)('keeps uploaded geometry independent from caller and scene records', async () => {
        const engine = await loadWasmModule();
        const app = App.new();
        try {
            app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
            app.addPlugin(meshRendererPlugin);
            const id = app.world.spawn('Triangle'), api = app.getResource(MeshRenderers);
            app.world.insert(id, MeshRenderer);
            const source = triangle(3);
            api.setGeometry(id, source);
            const saved = () => serializeScene(app.world).entities[0].components.find(c => c.type === 'MeshRenderer')!.data.geometry as typeof source;
            source.positions[2] = 70;
            expect(saved()).toEqual(triangle(3));
            api.getGeometry(id)!.positions[2] = 80;
            saved().positions[2] = 90;
            expect(saved()).toEqual(triangle(3));
            expect(engine.meshRenderer_localBounds!(app.world.getCppRegistry()!, id)).toMatchObject({ maxX: 3, maxY: 3 });
        } finally { app.quit({ keepRenderer: true }); }
    });

    it.skipIf(!HAS_WASM)('uploads and saves each world independently when both worlds use the same entity id', async () => {
        const engine = await loadWasmModule();
        const a = App.new(), b = App.new();
        function check(app: App, id: Entity, size: number) {
            expect(app.getResource(MeshRenderers).getGeometry(id)).toEqual(triangle(size));
            expect(engine.meshRenderer_localBounds!(app.world.getCppRegistry()!, id)).toMatchObject({ minX: 0, minY: 0, maxX: size, maxY: size });
            const data = serializeScene(app.world).entities[0]!.components.find(c => c.type === 'MeshRenderer')!.data;
            expect(data.geometry).toEqual(triangle(size));
        }
        try {
            for (const app of [a, b]) {
                app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
                app.addPlugin(meshRendererPlugin);
            }
            const x = loadSceneData(a.world, scene(3)).get(1)!, y = loadSceneData(b.world, scene(7)).get(1)!;
            expect(x).toBe(y);
            check(a, x, 3);
            check(b, y, 7);
            a.quit({ keepRenderer: true });
            check(b, y, 7);
            b.world.despawn(y);
            expect(b.getResource(MeshRenderers).getGeometry(y)).toBeUndefined();
            const next = loadSceneData(b.world, scene(4)).get(1)!;
            check(b, next, 4);
        } finally { a.quit({ keepRenderer: true }); b.quit({ keepRenderer: true }); }
    });

    it.skipIf(!HAS_WASM)('keeps replacement scene hooks when an older registration is released twice', async () => {
        const engine = await loadWasmModule();
        const app = App.new();
        try {
            app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
            loadSceneData(app.world, scene(3));
            const codec = { exportData: (_entity: number, data: Record<string, unknown>) => { data.extra = 'codec'; } };
            const filter: SceneExportFilter = (_entity, type, data) => { if (type === 'MeshRenderer') data.filtered = true; };
            const install = () => {
                const a = registerWorldSceneComponentCodec(app.world, 'MeshRenderer', codec);
                const b = registerWorldSceneExportFilter(app.world, filter);
                return () => { a(); b(); };
            };
            const first = install();
            first();
            const second = install(), current = install();
            first();
            second();
            const saved = () => serializeScene(app.world).entities[0]!.components.find(c => c.type === 'MeshRenderer')!.data;
            expect(saved()).toMatchObject({ extra: 'codec', filtered: true });
            current();
            expect(saved()).not.toHaveProperty('extra');
            expect(saved()).not.toHaveProperty('filtered');
        } finally { app.quit({ keepRenderer: true }); }
    });

    it('uploads positions, colors and indices even when each allocation grows the WASM heap', () => {
        const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
        const freed: number[] = [];
        const registry = {} as CppRegistry;
        const upload = vi.fn((owner: CppRegistry, entity: number, positions: number, vertices: number, colors: number, indices: number, count: number) => {
            expect(owner).toBe(registry);
            expect(entity).toBe(1);
            expect([...new Float32Array(memory.buffer, positions, vertices * 4)]).toEqual([0,0,0,0, 3,0,0,0, 0,3,0,0]);
            expect([...new Uint32Array(memory.buffer, colors, vertices)]).toEqual([0xff0000ff, 0xff00ff00, 0xffff0000]);
            expect([...new Uint32Array(memory.buffer, indices, count)]).toEqual([0, 1, 2]);
        });
        const api = new MeshRendererAPI({ get HEAPU8() { return new Uint8Array(memory.buffer); },
            _malloc: () => memory.grow(1) * 65536, _free: p => freed.push(p), meshRenderer_setGeometry: upload,
        }, registry);
        api.setGeometry(1 as Entity, triangle(3));
        expect(upload).toHaveBeenCalledOnce();
        expect(freed).toEqual([3 * 65536, 2 * 65536, 65536]);
    });
    it('keeps the prior mesh when an allocation fails and can retry the upload', () => {
        const heap = new Uint8Array(1024);
        const free = vi.fn(), upload = vi.fn();
        let next = 16, available = true;
        const api = new MeshRendererAPI({ HEAPU8: heap,
            _malloc: (bytes: number) => {
                if (!available && bytes === 12) return 0;
                const ptr = next; next += bytes; return ptr;
            }, _free: free, meshRenderer_setGeometry: upload,
        }, {} as CppRegistry);
        const entity = 1 as Entity;
        api.setGeometry(entity, triangle(3));
        available = false;
        free.mockClear();
        expect(() => api.setGeometry(entity, triangle(7))).toThrow('allocate mesh geometry');
        expect(free).toHaveBeenCalledTimes(1);
        expect(api.getGeometry(entity)).toEqual(triangle(3));
        expect(upload).toHaveBeenCalledTimes(1);
        available = true;
        api.setGeometry(entity, triangle(7));
        expect(api.getGeometry(entity)).toEqual(triangle(7));
        expect(upload).toHaveBeenCalledTimes(2);
    });

    it('uses the native host acknowledgement to decide whether to retain an upload', () => {
        const checked = vi.fn((_entity: number) => true).mockReturnValueOnce(true).mockReturnValueOnce(false);
        const legacy = vi.fn();
        const bindings = createNativeEngineApi({
            es_meshRenderer_trySetGeometry: checked, es_meshRenderer_setGeometry: legacy,
        });
        let offset = 16;
        const api = new MeshRendererAPI({
            ...bindings, HEAPU8: new Uint8Array(256),
            _malloc: (bytes: number) => { const ptr = offset; offset += bytes; return ptr; }, _free: vi.fn(),
        }, {} as CppRegistry);
        const entity = 1 as Entity;
        api.setGeometry(entity, triangle(3));
        api.setGeometry(entity, triangle(7));
        expect(api.getGeometry(entity)).toEqual(triangle(3));
        expect(checked).toHaveBeenCalledTimes(2);
        expect(checked.mock.calls[0][0]).toBe(entity);
        expect(legacy).not.toHaveBeenCalled();
    });
});
