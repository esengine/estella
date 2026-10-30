// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A document the creator edited keeps what they did, and still moves to the engine's `RectAnchors` from the compatibility layer's
 *        `Cocos.Widget`: only the component's name changes.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importCocosProject } from '../src/import/cocos';

const meta = (uuid: string, importer: string): object => ({ ver: '1', importer, uuid, subMetas: {}, userData: {} });

describe('a kept document that holds a Cocos.Widget', () => {
    let root: string;
    let file: string;
    let second: Awaited<ReturnType<typeof importCocosProject>>;

    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'cocos-migrate-'));
        const dir = path.join(root, 'creator', 'assets');
        mkdirSync(dir, { recursive: true });
        const zero = { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 };
        writeFileSync(path.join(dir, 'main.scene'), JSON.stringify([
            { __type__: 'cc.SceneAsset', _name: 'main', scene: { __id__: 1 } },
            { __type__: 'cc.Scene', _name: 'main', _children: [{ __id__: 2 }] },
            { __type__: 'cc.Node', _name: 'N', _parent: { __id__: 1 }, _children: [], _active: true, _components: [], _prefab: null, _lpos: zero, _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 }, _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 }, _layer: 1 },
        ]));
        writeFileSync(path.join(dir, 'main.scene.meta'), JSON.stringify(meta('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'scene')));
        const source = path.join(root, 'creator'), out = path.join(root, 'out');
        await importCocosProject({ source, out });
        // the creator edits it, and it was written back when widgets were the layer's
        file = path.join(out, 'assets', 'cocos', 'main.esscene');
        const doc = JSON.parse(readFileSync(file, 'utf8')) as { entities: Array<{ name: string; components: unknown[] }> };
        doc.entities.find((e) => e.name === 'N')!.components.push({ type: 'Cocos.Widget', data: { enabled: true, alignFlags: 45, left: 5, target: 3 } }, { type: 'Name', data: { value: 'edited by hand' } });
        writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
        second = await importCocosProject({ source, out });
    });
    afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    it('is kept, and says it was migrated', () => {
        expect(second.sync.kept).toContain('assets/cocos/main.esscene');
        expect(second.notes['widget-migrated']?.count).toBe(1);
    });

    it('holds a RectAnchors with the same fields (and no target), and nothing else changed', () => {
        const doc = JSON.parse(readFileSync(file, 'utf8')) as { entities: Array<{ name: string; components: Array<{ type: string; data: Record<string, unknown> }> }> };
        const components = doc.entities.find((e) => e.name === 'N')!.components;
        const anchors = components.find((c) => c.type === 'RectAnchors')!;
        expect(anchors.data).toEqual({ enabled: true, alignFlags: 45, left: 5 });
        expect(components.some((c) => c.type === 'Cocos.Widget')).toBe(false);
        expect(components.find((c) => c.type === 'Name')!.data.value).toBe('edited by hand');
    });
});
