// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Two Cocos scripts may write the same `@ccclass` name (Cocos tells classes apart by their script). Here a name is a component, so
 *        the second is given a name of its own, and the decorator in the bundle says so.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { importCocosProject } from '../src/import/cocos';
import { buildCocosAssetIndex } from '../src/import/cocos/assets';
import { buildScriptIndex, compressUuid } from '../src/import/cocos/scripts';
import { cocosCompatPlugin, renameClass } from '../src/bundle/cocosCompat';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const meta = (uuid: string, importer: string): object => ({ ver: '1', importer, uuid, subMetas: {}, userData: {} });

describe('two scripts that write the same class name', () => {
    let root: string;
    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'cocos-names-'));
        const put = (rel: string, v: string | object): void => {
            const f = path.join(root, 'creator', 'assets', rel);
            mkdirSync(path.dirname(f), { recursive: true });
            writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
        };
        put('a/Skin.ts', "import { _decorator, Component } from 'cc';\nconst { ccclass } = _decorator;\n@ccclass('Skin')\nexport class Skin extends Component {}\n");
        put('a/Skin.ts.meta', meta(A, 'typescript'));
        put('b/Skin.ts', "import { _decorator, Component } from 'cc';\nconst { ccclass } = _decorator;\n@ccclass('Skin')\nexport class Skin extends Component {}\n");
        put('b/Skin.ts.meta', meta(B, 'typescript'));
        const unit = { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 };
        const zero = { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 };
        const node = (name: string, comp: number): object => ({ __type__: 'cc.Node', _name: name, _parent: { __id__: 1 }, _children: [], _active: true, _components: [{ __id__: comp }], _prefab: null, _lpos: zero, _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 }, _lscale: unit, _layer: 1 });
        put('main.scene', [
            { __type__: 'cc.SceneAsset', _name: 'main', scene: { __id__: 1 } },
            { __type__: 'cc.Scene', _name: 'main', _children: [{ __id__: 2 }, { __id__: 3 }] },
            node('one', 4), node('two', 5),
            { __type__: compressUuid(A), node: { __id__: 2 }, _enabled: true, hp: 1 },
            { __type__: compressUuid(B), node: { __id__: 3 }, _enabled: true, mp: 2 },
        ]);
        put('main.scene.meta', meta('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'scene'));
        mkdirSync(path.join(root, 'out', 'src'), { recursive: true });
        writeFileSync(path.join(root, 'out', 'src', 'main.ts'), "// entry\nimport './components';\n");
        await importCocosProject({ source: path.join(root, 'creator'), out: path.join(root, 'out') });
    });
    afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    it('numbers the second, in path order', () => {
        const index = buildScriptIndex(buildCocosAssetIndex(path.join(root, 'creator', 'assets')));
        expect(index.get(compressUuid(A))).toEqual({ name: 'Skin', rel: 'a/Skin.ts' });
        expect(index.get(compressUuid(B))).toEqual({ name: 'Skin_2', rel: 'b/Skin.ts', wrote: 'Skin' });
    });

    it('names each instance by its own class in the scene', () => {
        const scene = JSON.parse(readFileSync(path.join(root, 'out', 'assets', 'cocos', 'main.esscene'), 'utf8')) as { entities: Array<{ name: string; components: Array<{ type: string }> }> };
        const types = (name: string) => scene.entities.find((e) => e.name === name)!.components.map((c) => c.type);
        expect(types('one')).toContain('Cocos.Skin');
        expect(types('two')).toContain('Cocos.Skin_2');
    });

    it('writes which script was renamed, beside the entry, and the editor declarations carry both', () => {
        const names = JSON.parse(readFileSync(path.join(root, 'out', 'src', 'cocos-class-names.json'), 'utf8')) as Record<string, { from: string; to: string }>;
        expect(Object.values(names)).toEqual([{ from: 'Skin', to: 'Skin_2' }]);
        const components = readFileSync(path.join(root, 'out', 'src', 'components.ts'), 'utf8');
        expect(components).toContain('"Cocos.Skin"');
        expect(components).toContain('"Cocos.Skin_2"');
    });

    it('bundles the renamed class under its new name', async () => {
        const result = await build({
            entryPoints: [path.join(root, 'out', 'src', 'cocos-scripts.ts')],
            bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
            external: ['esengine/cocos'], plugins: [cocosCompatPlugin()],
        }).catch((e) => e);
        const text = result.outputFiles?.[0]?.text ?? '';
        expect((text.match(/ccclass\d*\("Skin_2"\)/g) ?? []).length).toBe(1);
        expect((text.match(/ccclass\d*\("Skin"\)/g) ?? []).length).toBe(1);
    });
});

describe('renaming a decorator', () => {
    it('rewrites the named form and the bare one', () => {
        expect(renameClass("@ccclass('Skin')\nclass Skin {}", 'Skin', 'Skin_2')).toContain("@ccclass('Skin_2')");
        expect(renameClass('@ccclass("Skin")\nclass Skin {}', 'Skin', 'Skin_2')).toContain("@ccclass('Skin_2')");
        expect(renameClass('@ccclass\nclass Skin {}', 'Skin', 'Skin_2')).toContain("@ccclass('Skin_2')");
    });
});
