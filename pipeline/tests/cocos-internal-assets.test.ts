// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A scene names the editor's built-in assets (the default progress bar images) by uuid and the project does not hold them: they are
 *        read from the Creator install, and come into the converted project like any image.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importCocosProject } from '../src/import/cocos';
import { buildCocosAssetIndex, cocosEditorAssets, INTERNAL_FOLDER } from '../src/import/cocos/assets';

const BAR = '24a704da-2867-446d-8d1a-5e920c75e09d';
const meta = (uuid: string, importer: string, subMetas: object = {}): object => ({ ver: '1', importer, uuid, subMetas, userData: {} });

describe('built-in editor assets', () => {
    let root: string;
    let editor: string;
    const saved = process.env.COCOS_EDITOR_ASSETS;

    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'cocos-internal-'));
        editor = path.join(root, 'editor-assets');
        mkdirSync(path.join(editor, 'default_ui'), { recursive: true });
        writeFileSync(path.join(editor, 'default_ui', 'default_progressbar.png'), 'png');
        writeFileSync(path.join(editor, 'default_ui', 'default_progressbar.png.meta'), JSON.stringify(meta('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'image', { f9941: { importer: 'sprite-frame', uuid: BAR, name: 'spriteFrame', userData: {} } })));
        process.env.COCOS_EDITOR_ASSETS = editor;

        const dir = path.join(root, 'creator', 'assets');
        mkdirSync(dir, { recursive: true });
        const unit = { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 }, zero = { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 };
        const scene = [
            { __type__: 'cc.SceneAsset', _name: 'main', scene: { __id__: 1 } },
            { __type__: 'cc.Scene', _name: 'main', _children: [{ __id__: 2 }] },
            { __type__: 'cc.Node', _name: 'Bar', _parent: { __id__: 1 }, _children: [], _active: true, _components: [{ __id__: 3 }], _prefab: null, _lpos: zero, _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 }, _lscale: unit, _layer: 1 },
            { __type__: 'cc.Sprite', node: { __id__: 2 }, _enabled: true, _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 }, _spriteFrame: { __uuid__: `${BAR}`, __expectedType__: 'cc.SpriteFrame' }, _type: 1, _sizeMode: 0 },
        ];
        writeFileSync(path.join(dir, 'main.scene'), JSON.stringify(scene));
        writeFileSync(path.join(dir, 'main.scene.meta'), JSON.stringify(meta('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'scene')));
        writeFileSync(path.join(root, 'creator', 'package.json'), JSON.stringify({ creator: { version: '3.7.3' } }));
        await importCocosProject({ source: path.join(root, 'creator'), out: path.join(root, 'out') });
    });
    afterAll(() => {
        if (saved === undefined) delete process.env.COCOS_EDITOR_ASSETS; else process.env.COCOS_EDITOR_ASSETS = saved;
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });

    it('finds the install folder, and none for a version nobody has', () => {
        expect(cocosEditorAssets('3.7.3')).toBe(editor);
        delete process.env.COCOS_EDITOR_ASSETS;
        expect(cocosEditorAssets('0.0.0-none')).toBeNull();
        process.env.COCOS_EDITOR_ASSETS = editor;
    });

    it('lets the project\'s own assets win over a built-in of the same uuid', () => {
        const own = path.join(root, 'own');
        mkdirSync(own, { recursive: true });
        writeFileSync(path.join(own, 'mine.png.meta'), JSON.stringify(meta('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'image')));
        writeFileSync(path.join(own, 'mine.png'), 'png');
        const index = buildCocosAssetIndex(own, editor);
        expect(index.byUuid.get('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb')!.rel).toBe('mine.png');
        expect(index.byUuid.get(BAR)!.rel).toBe(`${INTERNAL_FOLDER}/default_ui/default_progressbar.png`);
    });

    it('brings the image in and points the sprite at it', () => {
        const scene = JSON.parse(readFileSync(path.join(root, 'out', 'assets', 'cocos', 'main.esscene'), 'utf8')) as { entities: Array<{ name: string; components: Array<{ type: string; data: Record<string, unknown> }> }> };
        const sprite = scene.entities.find((e) => e.name === 'Bar')!.components.find((c) => c.type === 'Sprite')!;
        expect(sprite.data.texture).toBe(`assets/cocos/${INTERNAL_FOLDER}/default_ui/default_progressbar.png`);
        expect(sprite.data.enabled).not.toBe(false);
        expect(existsSync(path.join(root, 'out', 'assets', 'cocos', INTERNAL_FOLDER, 'default_ui', 'default_progressbar.png'))).toBe(true);
    });
});
