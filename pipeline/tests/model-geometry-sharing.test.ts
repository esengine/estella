// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importModelFile } from '../src/assets/importModelFile';
import { plainTriangle } from './fixtures/gltfFixtures.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const renderers = (prefab: any) => prefab.entities.flatMap((e: any) => e.components.filter((c: any) => c.type === 'MeshRenderer'));

function fixture() {
    const doc = JSON.parse(new TextDecoder().decode(plainTriangle()));
    doc.materials = [
        { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0 } },
        { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1], metallicFactor: 0 } },
    ];
    const primitive = doc.meshes[0].primitives[0];
    doc.meshes = Array.from({ length: 32 }, (_, i) => ({ name: `Cell${i}`, primitives: [{ ...primitive, material: i % 2 }] }));
    doc.nodes = doc.meshes.map((_: unknown, i: number) => ({ name: `Placed${i}`, mesh: i, translation: [i * 3, 0, 0] }));
    doc.scenes = [{ nodes: doc.nodes.map((_: unknown, i: number) => i) }];
    doc.scene = 0;
    return doc;
}

async function importDoc(doc: any, settings = {}) {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-shared-geometry-')); roots.push(root);
    const source = path.join(root, 'cells.gltf');
    writeFileSync(source, JSON.stringify(doc));
    const options = { root, destDir: 'assets', absSource: source, settings };
    const result = await importModelFile(options);
    return { root, source, options, result, prefab: json(path.join(root, result.prefab!)) };
}

describe('model geometry sharing', () => {
    it('loads repeated geometry once while preserving every node, transform and material', async () => {
        const { root, result, prefab, options } = await importDoc(fixture());
        const drawn = renderers(prefab);
        expect(drawn).toHaveLength(32);
        expect(new Set(drawn.map((c: any) => c.data.mesh)).size).toBe(1);
        expect(result.products.filter(p => p.endsWith('.esmesh'))).toHaveLength(1);
        expect(drawn[0].data.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect(drawn[1].data.color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
        expect(prefab.entities.find((e: any) => e.name === 'Placed31').components[0].data.position.x).toBe(93);
        expect(result.nodeMeshes.get('Placed31')).toEqual(result.nodeMeshes.get('Placed0'));
        const mesh = path.join(root, drawn[0].data.mesh), uuid = json(mesh + '.meta').uuid;
        const again = await importModelFile(options);
        expect(json(mesh + '.meta').uuid).toBe(uuid);
        expect(json(path.join(root, again.prefab!))).toEqual(prefab);
    });

    it('does not share equal-sized meshes with different UV data', async () => {
        const doc = fixture(), uv = new Float32Array([.5, .5, 1, .5, .5, 1]);
        doc.buffers.push({ byteLength: uv.byteLength, uri: 'data:application/octet-stream;base64,' + Buffer.from(uv.buffer).toString('base64') });
        doc.bufferViews.push({ buffer: 1, byteLength: uv.byteLength });
        doc.accessors.push({ bufferView: 3, componentType: 5126, count: 3, type: 'VEC2' });
        doc.meshes[31].primitives[0].attributes = { POSITION: 0, TEXCOORD_0: 3 };
        const { result, prefab } = await importDoc(doc);
        expect(result.products.filter(p => p.endsWith('.esmesh'))).toHaveLength(2);
        const drawn = renderers(prefab);
        expect(drawn[31].data.mesh).not.toBe(drawn[0].data.mesh);
    });

    it('updates a legacy duplicate product without changing its UUID or using it in the new prefab', async () => {
        const { root, options, prefab } = await importDoc(fixture());
        const canonical = renderers(prefab)[0].data.mesh;
        const alias = path.join(root, 'assets/cells_1_0.esmesh');
        writeFileSync(alias, 'stale geometry');
        writeFileSync(alias + '.meta', JSON.stringify({ uuid: 'legacy-mesh-id', type: 'mesh', importer: {} }));
        const result = await importModelFile(options);
        expect(readFileSync(alias)).toEqual(readFileSync(path.join(root, canonical)));
        expect(json(alias + '.meta').uuid).toBe('legacy-mesh-id');
        expect(new Set(renderers(json(path.join(root, result.prefab!))).map((c: any) => c.data.mesh)).size).toBe(1);
    });

    it('shares skinned geometry without sharing the actors joint entities', async () => {
        const doc = fixture();
        const joints = new Uint8Array(12), weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
        const bytes = Buffer.concat([Buffer.from(joints.buffer), Buffer.from(weights.buffer)]);
        doc.buffers.push({ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + bytes.toString('base64') });
        doc.bufferViews.push({ buffer: 1, byteLength: joints.byteLength }, { buffer: 1, byteOffset: joints.byteLength, byteLength: weights.byteLength });
        doc.accessors.push({ bufferView: 3, componentType: 5121, count: 3, type: 'VEC4' }, { bufferView: 4, componentType: 5126, count: 3, type: 'VEC4' });
        doc.meshes = doc.meshes.slice(0, 2);
        for (const m of doc.meshes) m.primitives[0].attributes = { POSITION: 0, TEXCOORD_0: 1, JOINTS_0: 3, WEIGHTS_0: 4 };
        doc.nodes = [{ name: 'ActorA', mesh: 0, skin: 0 }, { name: 'ActorB', mesh: 1, skin: 1 }, { name: 'BoneA' }, { name: 'BoneB' }];
        doc.skins = [{ joints: [2] }, { joints: [3] }]; doc.scenes[0].nodes = [0, 1, 2, 3];
        const { result, prefab } = await importDoc(doc);
        expect(result.products.filter(p => p.endsWith('.esmesh'))).toHaveLength(1);
        const skins = prefab.entities.flatMap((e: any) => e.components.filter((c: any) => c.type === 'MeshSkin'));
        expect(skins.map((c: any) => c.data.joints)).toEqual([['n2'], ['n3']]);
    });

    it('shares generated LOD products and keeps every LOD reference resolvable', async () => {
        const doc = fixture(), positions: number[] = [], indices: number[] = [];
        for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) positions.push(x, y, Math.sin(x) * .01);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = y * 9 + x; indices.push(i, i + 1, i + 9, i + 1, i + 10, i + 9); }
        const pos = new Float32Array(positions), idx = new Uint16Array(indices);
        const bytes = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
        doc.buffers = [{ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + bytes.toString('base64') }];
        doc.bufferViews = [{ buffer: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }];
        doc.accessors = [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' }];
        doc.meshes = doc.meshes.slice(0, 2).map((m: any) => ({ ...m, primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }));
        doc.nodes = doc.nodes.slice(0, 2); doc.scenes[0].nodes = [0, 1];
        const { root, prefab } = await importDoc(doc, { lodLevels: 2, lodMinTriangles: 1 });
        const groups = prefab.entities.flatMap((e: any) => e.components.filter((c: any) => c.type === 'LODGroup'));
        expect(groups).toHaveLength(2);
        expect(groups[0].data).toEqual(groups[1].data);
        for (const key of ['lod1', 'lod2']) { expect(groups[0].data[key]).toBeTruthy(); expect(readFileSync(path.join(root, groups[0].data[key])).length).toBeGreaterThan(0); }
    });
});
