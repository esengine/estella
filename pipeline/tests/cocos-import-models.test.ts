// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The models a Cocos project draws, taken in with the engine's own model import.
 *
 * The fixture is one glTF triangle standing in for an `.fbx`, a prefab that draws it two ways (a MeshRenderer on a node, and an instance of
 * the model's scene), and a quad from Cocos's built-in shapes. The claims: the model is imported once and its products land beside where it
 * lay in the Cocos project; a MeshRenderer takes the model's own mesh and material; an instance of the model keeps its root's name and place;
 * a built-in shape becomes the engine's, resized so it stays the size the scene meant; and the source is never written to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importCocosProject } from '../src/import/cocos';

const MODEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PREFAB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRIMITIVES = '1263d74c-8167-4928-91a6-4e2672411f47';

const vec = (x: number, y: number, z = 0) => ({ __type__: 'cc.Vec3', x, y, z });
const ident = { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };

function triangleGltf(): string {
    const buffer = Buffer.alloc(44);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => buffer.writeFloatLE(v, i * 4));
    [0, 1, 2].forEach((v, i) => buffer.writeUInt16LE(v, 36 + i * 2));
    return JSON.stringify({
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
        nodes: [{ name: 'tri', mesh: 0 }],
        meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
        ],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
        buffers: [{ byteLength: 44, uri: `data:application/octet-stream;base64,${buffer.toString('base64')}` }],
    });
}

const node = (name: string, parent: number | null, children: number[], components: number[], prefab: number, pos = vec(0, 0), scale = vec(1, 1, 1)) => ({
    __type__: 'cc.Node', _name: name, _parent: parent === null ? null : { __id__: parent }, _children: children.map((__id__) => ({ __id__ })), _active: true,
    _components: components.map((__id__) => ({ __id__ })), _prefab: { __id__: prefab }, _lpos: pos, _lrot: ident, _lscale: scale, _layer: 1073741824,
});

/** props.prefab: a root with three children: a node drawing the model's mesh, a built-in quad, and an instance of the model's scene. */
const propsPrefab = [
    { __type__: 'cc.Prefab', _name: 'props', data: { __id__: 1 } },
    node('Props', null, [2, 5, 8], [], 4),                                                              // 1
    node('Tri', 1, [], [3], 11, vec(5, 0)),                                                             // 2
    { __type__: 'cc.MeshRenderer', node: { __id__: 2 }, _enabled: true, __prefab: { __id__: 12 }, _materials: [], _mesh: { __uuid__: `${MODEL}@00a01` } }, // 3
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'propsRoot', instance: null }, // 4
    node('Ground', 1, [], [6], 13, vec(0, 0), vec(2, 2, 2)),                                            // 5
    { __type__: 'cc.MeshRenderer', node: { __id__: 5 }, _enabled: true, __prefab: { __id__: 14 }, _materials: [], _mesh: { __uuid__: `${PRIMITIVES}@fc873` } }, // 6
    { __type__: 'cc.Node', _name: 'unused' },                                                           // 7
    { __type__: 'cc.Node', _objFlags: 0, _parent: { __id__: 1 }, _prefab: { __id__: 9 } },              // 8  (instance of the model's scene)
    { __type__: 'cc.PrefabInfo', root: { __id__: 8 }, asset: { __uuid__: `${MODEL}@00b02` }, fileId: 'modelRoot', instance: { __id__: 10 } }, // 9
    { __type__: 'cc.PrefabInstance', fileId: 'inst', prefabRootNode: { __id__: 1 }, mountedChildren: [], mountedComponents: [], removedComponents: [],
        propertyOverrides: [{ __id__: 15 }, { __id__: 17 }, { __id__: 19 }] },                          // 10
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'triInfo', instance: null }, // 11
    { __type__: 'cc.CompPrefabInfo', fileId: 'triMesh' },                                               // 12
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'groundInfo', instance: null }, // 13
    { __type__: 'cc.CompPrefabInfo', fileId: 'groundMesh' },                                            // 14
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 16 }, propertyPath: ['_name'], value: 'renamed' }, // 15
    { __type__: 'cc.TargetInfo', localID: ['sceneRootId'] },                                            // 16
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 16 }, propertyPath: ['_lpos'], value: vec(3, 4, 5) }, // 17
    { __type__: 'cc.TargetInfo', localID: ['sceneRootId', 'partId'] },                                  // 18  (a part of the model)
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 18 }, propertyPath: ['_lpos'], value: vec(9, 9, 9) }, // 19
];

const meta = (uuid: string, importer: string, extra: object = {}) => ({ ver: '1', importer, uuid, subMetas: {}, userData: {}, ...extra });

let root: string;
let src: string;
let out: string;
let sourceBefore: string;
let report: Awaited<ReturnType<typeof importCocosProject>>;

beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'cocos-models-'));
    src = path.join(root, 'creator');
    out = path.join(root, 'estella');
    const put = (rel: string, v: unknown): void => {
        const f = path.join(src, 'assets', rel);
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
    };
    put('models/tri/tri.gltf', triangleGltf());
    put('models/tri/tri.gltf.meta', meta(MODEL, 'gltf', {
        subMetas: {
            '00a01': { importer: 'gltf-mesh', uuid: `${MODEL}@00a01`, name: 'tri.mesh', userData: { gltfIndex: 0 } },
            '00b02': { importer: 'gltf-scene', uuid: `${MODEL}@00b02`, name: 'tri.prefab', userData: { gltfIndex: 0 } },
        },
    }));
    put('props/props.prefab', propsPrefab);
    put('props/props.prefab.meta', meta(PREFAB, 'prefab'));
    sourceBefore = readFileSync(path.join(src, 'assets', 'models/tri/tri.gltf'), 'utf8');
    report = await importCocosProject({ source: src, out, only: ['props/'] });
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const readJson = (rel: string): any => JSON.parse(readFileSync(path.join(out, rel), 'utf8'));
const entity = (doc: any, name: string): any => doc.entities.find((e: any) => e.name === name);

describe('a model a Cocos project draws', () => {
    it('is imported once, with its products beside where it lay', () => {
        expect(report.documents.failed).toEqual([]);
        for (const f of ['tri.esprefab', 'tri.esmesh']) expect(existsSync(path.join(out, 'assets/cocos/models/tri', f))).toBe(true);
    });

    it('never writes to the model it reads', () => {
        expect(readFileSync(path.join(src, 'assets', 'models/tri/tri.gltf'), 'utf8')).toBe(sourceBefore);
    });

    it('gives a MeshRenderer on a node the model\'s own mesh', () => {
        const tri = entity(readJson('assets/cocos/props/props.esprefab'), 'Tri');
        const mesh = tri.components.find((c: any) => c.type === 'MeshRenderer');
        expect(mesh.data.mesh).toBe('assets/cocos/models/tri/tri.esmesh');
        expect(mesh.data.enabled).toBe(true);
    });

    it('turns an instance of the model\'s scene into a nested prefab that keeps the root\'s name and place', () => {
        const doc = readJson('assets/cocos/props/props.esprefab');
        const inst = doc.entities.find((e: any) => e.nestedPrefab);
        expect(inst.nestedPrefab.prefabPath).toBe('assets/cocos/models/tri/tri.esprefab');
        const modelRoot = readJson('assets/cocos/models/tri/tri.esprefab').rootEntityId;
        const byProperty = (name: string) => inst.nestedPrefab.overrides.find((o: any) => o.type === name || o.propertyName === name);
        expect(inst.nestedPrefab.overrides.every((o: any) => o.prefabEntityId === modelRoot)).toBe(true);
        expect(byProperty('name').value).toBe('renamed');
        expect(byProperty('position').value).toMatchObject({ x: 3, y: 4, z: 5 });
    });

    it('counts what an instance changed on the model\'s own parts instead of losing it silently', () => {
        expect(report.notes['model-instance-overrides']?.count).toBe(1);
    });
});

describe('a Cocos built-in shape', () => {
    it('becomes the engine\'s own, resized so the scene keeps its size', () => {
        const ground = entity(readJson('assets/cocos/props/props.esprefab'), 'Ground');
        const mesh = ground.components.find((c: any) => c.type === 'MeshRenderer');
        expect(mesh.data.mesh).toBe('builtin:quad');
        // the engine's quad is 100 across and Cocos's is 1: a node scaled 2 stands at 2 / 100 of the engine's
        const transform = ground.components.find((c: any) => c.type === 'Transform');
        expect(transform.data.scale.x).toBeCloseTo(0.02, 6);
    });
});
