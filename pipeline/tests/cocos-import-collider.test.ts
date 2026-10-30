// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos BoxCollider keeps where it stood: `_center`, scaled by the node, becomes the engine collider's `center`.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importCocosProject } from '../src/import/cocos';

const vec = (x: number, y: number, z: number) => ({ __type__: 'cc.Vec3', x, y, z });
const scene = [
    { __type__: 'cc.SceneAsset', _name: 'main', scene: { __id__: 1 } },
    { __type__: 'cc.Scene', _name: 'main', _children: [{ __id__: 2 }] },
    {
        __type__: 'cc.Node', _name: 'Crate', _parent: { __id__: 1 }, _children: [], _active: true, _components: [{ __id__: 3 }], _prefab: null,
        _lpos: vec(0, 0, 0), _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 }, _lscale: vec(2, 3, 1), _layer: 1,
    },
    { __type__: 'cc.BoxCollider', node: { __id__: 2 }, _enabled: true, _isTrigger: false, _size: vec(1, 1, 1), _center: vec(0.5, 1, -2) },
];

describe('a Cocos box collider off its node\'s origin', () => {
    let root: string;
    let crate: { components: Array<{ type: string; data: Record<string, any> }> };
    let report: Awaited<ReturnType<typeof importCocosProject>>;

    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'cocos-collider-'));
        const dir = path.join(root, 'creator', 'assets');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'main.scene'), JSON.stringify(scene));
        writeFileSync(path.join(dir, 'main.scene.meta'), JSON.stringify({ ver: '1', importer: 'scene', uuid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', subMetas: {}, userData: {} }));
        report = await importCocosProject({ source: path.join(root, 'creator'), out: path.join(root, 'out') });
        const doc = JSON.parse(readFileSync(path.join(root, 'out', 'assets', 'cocos', 'main.esscene'), 'utf8'));
        crate = doc.entities.find((e: { name: string }) => e.name === 'Crate');
    });
    afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    it('carries the centre, scaled by the node, and the scaled half size', () => {
        const box = crate.components.find((c) => c.type === 'BoxCollider3D')!;
        expect(box.data.halfExtents).toEqual({ x: 1, y: 1.5, z: 0.5 });
        expect(box.data.center).toEqual({ x: 1, y: 3, z: -2 });
    });

    it('counts the collider as fully mapped', () => {
        expect(report.components['cc.BoxCollider']).toEqual(expect.objectContaining({ mapped: 1 }));
        expect(report.components['cc.BoxCollider']?.partial ?? 0).toBe(0);
    });
});
