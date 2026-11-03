// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos mesh of two primitives with a material in each slot is drawn whole: the first primitive on the node, the second on a part that
 *        stands with it, each with the material of its own slot.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importCocosProject } from '../src/import/cocos';

const MODEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PREFAB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MAT_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MAT_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const STANDARD = 'a3cd009f-0ab0-420d-9278-b9fdab939bbc';

const vec = (x: number, y: number, z = 0) => ({ __type__: 'cc.Vec3', x, y, z });
const ident = { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };

/** One mesh of two triangles, each its own primitive, each with its own glTF material. */
function twoPrimitiveGltf(): string {
    const buffer = Buffer.alloc(80);
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1].forEach((v, i) => buffer.writeFloatLE(v, i * 4));
    [0, 1, 2, 0, 1, 2].forEach((v, i) => buffer.writeUInt16LE(v, 72 + (i % 3) * 2 + Math.floor(i / 3) * 0));
    return JSON.stringify({
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
        nodes: [{ name: 'pair', mesh: 0 }],
        materials: [{ name: 'a' }, { name: 'b' }],
        meshes: [{ name: 'pair', primitives: [
            { attributes: { POSITION: 0 }, indices: 2, material: 0 },
            { attributes: { POSITION: 1 }, indices: 2, material: 1 },
        ] }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
            { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 1], max: [1, 1, 1] },
            { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
        ],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 6 }],
        buffers: [{ byteLength: 80, uri: `data:application/octet-stream;base64,${buffer.toString('base64')}` }],
    });
}

const prefab = [
    { __type__: 'cc.Prefab', _name: 'pair', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Pair', _parent: null, _children: [], _active: true, _components: [{ __id__: 2 }], _prefab: { __id__: 3 }, _lpos: vec(0, 0), _lrot: ident, _lscale: vec(1, 1, 1), _layer: 1073741824 },
    { __type__: 'cc.MeshRenderer', node: { __id__: 1 }, _enabled: true, __prefab: { __id__: 4 }, _materials: [{ __uuid__: MAT_A }, { __uuid__: MAT_B }], _mesh: { __uuid__: `${MODEL}@00a01` } },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'pairRoot', instance: null },
    { __type__: 'cc.CompPrefabInfo', fileId: 'pairMesh' },
];

const meta = (uuid: string, importer: string, extra: object = {}) => ({ ver: '1', importer, uuid, subMetas: {}, userData: {}, ...extra });
const material = (r: number) => ({
    __type__: 'cc.Material', _effectAsset: { __uuid__: STANDARD }, _techIdx: 0,
    _props: [{ mainColor: { __type__: 'cc.Color', r, g: 0, b: 0, a: 255 } }],
    _states: [{ rasterizerState: { cullMode: 2 } }],
});

let root: string;
let out: string;

beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'cocos-multi-'));
    const src = path.join(root, 'creator');
    out = path.join(root, 'estella');
    const put = (rel: string, v: unknown): void => {
        const f = path.join(src, 'assets', rel);
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
    };
    put('models/pair/pair.gltf', twoPrimitiveGltf());
    put('models/pair/pair.gltf.meta', meta(MODEL, 'gltf', {
        subMetas: { '00a01': { importer: 'gltf-mesh', uuid: `${MODEL}@00a01`, name: 'pair.mesh', userData: { gltfIndex: 0 } } },
    }));
    put('mat/a.mtl', material(255));
    put('mat/a.mtl.meta', meta(MAT_A, 'material'));
    put('mat/b.mtl', material(10));
    put('mat/b.mtl.meta', meta(MAT_B, 'material'));
    put('props/pair.prefab', prefab);
    put('props/pair.prefab.meta', meta(PREFAB, 'prefab'));
    await importCocosProject({ source: src, out, only: ['props/'] });
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('a mesh of two primitives', () => {
    it('is two renderers, one on the node and one on a part beside it', () => {
        const doc = JSON.parse(readFileSync(path.join(out, 'assets/cocos/props/pair.esprefab'), 'utf8'));
        const holders = doc.entities.filter((e: any) => e.components.some((c: any) => c.type === 'MeshRenderer'));
        expect(holders.map((e: any) => e.name)).toEqual(['Pair', 'Pair_1']);
        const part = holders[1];
        expect(part.parent).toBe(holders[0].prefabEntityId);
        expect(holders[0].children).toContain(part.prefabEntityId);
    });

    it('draws each primitive with the colour of its own slot', () => {
        const doc = JSON.parse(readFileSync(path.join(out, 'assets/cocos/props/pair.esprefab'), 'utf8'));
        const colour = (name: string): number => doc.entities.find((e: any) => e.name === name).components.find((c: any) => c.type === 'MeshRenderer').data.color.r;
        expect(colour('Pair')).toBeCloseTo(1, 2);
        expect(colour('Pair_1')).toBeCloseTo(10 / 255, 2);
    });
});
