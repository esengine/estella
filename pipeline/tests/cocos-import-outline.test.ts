// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A material whose effect has an outline pass, switched on, draws the mesh a second time: the outline is a material of its own, with the width
 *        and colour the Cocos material gave it, on a renderer that stands with the first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importCocosProject } from '../src/import/cocos';

const MODEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PREFAB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EFFECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MAT_ON = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MAT_OFF = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const vec = (x: number, y: number, z = 0) => ({ __type__: 'cc.Vec3', x, y, z });
const ident = { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };

const gltf = (): string => {
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
};

const EFFECT_TEXT = `
CCEffect %{
  techniques:
  - name: opaque
    passes:
    - switch: USE_OUTLINE_PASS
      vert: outline-vs:vert
      frag: outline-fs:frag
      rasterizerState: { cullMode: front }
      properties:
        lineWidth: { value: 10, target: outlineParams.x }
        baseColor: { editor: { type: color } }
    - vert: main-vs:vert
      frag: main-fs:frag
      properties:
        mainColor: { value: [1, 1, 1, 1], editor: { type: color } }
}%
CCProgram outline-vs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  in vec3 a_position;
  uniform OutlineVert { vec4 outlineParams; };
  vec4 vert () { return cc_matViewProj * vec4(a_position, 1); }
}%
CCProgram outline-fs %{
  precision highp float;
  uniform OutlineFrag { vec4 baseColor; };
  vec4 frag () { return vec4(baseColor.rgb, 1.0); }
}%
CCProgram main-vs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  in vec3 a_position;
  in vec2 a_texCoord;
  out vec2 uv0;
  vec4 vert () { uv0 = a_texCoord; return cc_matViewProj * vec4(a_position, 1); }
}%
CCProgram main-fs %{
  precision highp float;
  in vec2 uv0;
  uniform Constant { vec4 mainColor; };
  vec4 frag () { return mainColor; }
}%
`;

const prefab = [
    { __type__: 'cc.Prefab', _name: 'tri', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Drawn', _parent: null, _children: [], _active: true, _components: [{ __id__: 2 }], _prefab: { __id__: 3 }, _lpos: vec(0, 0), _lrot: ident, _lscale: vec(1, 1, 1), _layer: 1073741824 },
    { __type__: 'cc.MeshRenderer', node: { __id__: 1 }, _enabled: true, __prefab: { __id__: 4 }, _materials: [{ __uuid__: MAT_ON }], _mesh: { __uuid__: `${MODEL}@00a01` } },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'triRoot', instance: null },
    { __type__: 'cc.CompPrefabInfo', fileId: 'triMesh' },
];

const meta = (uuid: string, importer: string, extra: object = {}) => ({ ver: '1', importer, uuid, subMetas: {}, userData: {}, ...extra });
const material = (outline: boolean) => ({
    __type__: 'cc.Material', _effectAsset: { __uuid__: EFFECT }, _techIdx: 0,
    _defines: [{ USE_OUTLINE_PASS: outline }, {}],
    _props: [{ lineWidth: 8, baseColor: { __type__: 'cc.Color', r: 255, g: 0, b: 0, a: 255 } }, { mainColor: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 } }],
});

let root: string;
let out: string;

beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'cocos-outline-'));
    const src = path.join(root, 'creator');
    out = path.join(root, 'estella');
    const put = (rel: string, v: unknown): void => {
        const f = path.join(src, 'assets', rel);
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
    };
    put('models/tri/tri.gltf', gltf());
    put('models/tri/tri.gltf.meta', meta(MODEL, 'gltf', {
        subMetas: { '00a01': { importer: 'gltf-mesh', uuid: `${MODEL}@00a01`, name: 'tri.mesh', userData: { gltfIndex: 0 } } },
    }));
    put('fx/outlined.effect', EFFECT_TEXT);
    put('fx/outlined.effect.meta', meta(EFFECT, 'effect'));
    put('mat/on.mtl', material(true));
    put('mat/on.mtl.meta', meta(MAT_ON, 'material'));
    put('mat/off.mtl', material(false));
    put('mat/off.mtl.meta', meta(MAT_OFF, 'material'));
    put('props/tri.prefab', prefab);
    put('props/tri.prefab.meta', meta(PREFAB, 'prefab'));
    await importCocosProject({ source: src, out, only: ['props/'] });
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const json = (rel: string): any => JSON.parse(readFileSync(path.join(out, rel), 'utf8'));

describe('a material with its outline switched on', () => {
    it('has an outline material with the width and colour it gave the pass', () => {
        const m = json('assets/cocos/materials/mat/on.outline.esmaterial');
        expect(m.properties.lineWidth).toBe(8);
        expect(m.properties.baseColor).toMatchObject({ r: 1, g: 0, b: 0 });
        expect(m.cull).toBe(2);
        expect(existsSync(path.join(out, 'assets/cocos/effects/cocos-outline.esshader'))).toBe(true);
    });

    it('draws the mesh a second time, on a renderer beside the first', () => {
        const doc = json('assets/cocos/props/tri.esprefab');
        const drawn = doc.entities.find((e: any) => e.name === 'Drawn');
        const part = doc.entities.find((e: any) => e.name === 'Drawn_1');
        expect(part.parent).toBe(drawn.prefabEntityId);
        const first = drawn.components.find((c: any) => c.type === 'MeshRenderer').data;
        const second = part.components.find((c: any) => c.type === 'MeshRenderer').data;
        expect(second.mesh).toBe(first.mesh);
        expect(second.material).toBe('assets/cocos/materials/mat/on.outline.esmaterial');
    });

    it('is not made for a material that leaves the outline off', () => {
        expect(existsSync(path.join(out, 'assets/cocos/materials/mat/off.outline.esmaterial'))).toBe(false);
    });
});
