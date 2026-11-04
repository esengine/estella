// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { levelsFrom } from '../src/asset/compressed';
import { discoverSceneAssets } from '../src/asset/discoverAssets';

const level = (side: number) => ({ width: side, height: side / 2, data: new Uint8Array(side) });

describe('a KTX2 chain cut at a level', () => {
    const chain = { width: 1024, height: 512, data: new Uint8Array(1024), levels: [level(1024), level(512), level(256), level(128), level(64)] };

    it('starts at the first level no larger than asked, and keeps every level below it', () => {
        const cut = levelsFrom(chain, 300);
        expect(cut.width).toBe(256);
        expect(cut.height).toBe(128);
        expect(cut.levels!.map((l) => l.width)).toEqual([256, 128, 64]);
        expect(cut.data).toBe(chain.levels[2]!.data);
    });

    it('leaves a chain whole when nothing is asked, or when it is small enough already', () => {
        expect(levelsFrom(chain, 0)).toBe(chain);
        expect(levelsFrom(chain, 4096)).toBe(chain);
    });

    it('keeps the smallest level when every level is larger than asked', () => {
        expect(levelsFrom(chain, 16).width).toBe(64);
    });
});

describe('which textures a scene\'s meshes draw', () => {
    it('are a MeshRenderer\'s texture and normal map, and the materials it draws with, and not a sprite\'s', () => {
        const scene = {
            version: '1.0', name: 'S', entities: [
                { id: 1, name: 'Wall', parent: null, children: [], visible: true, components: [
                    { type: 'MeshRenderer', data: { mesh: 'builtin:cube', texture: 'wall.png', normalMap: 'wall_n.png', material: 'wall.esmaterial' } }] },
                { id: 2, name: 'Sign', parent: null, children: [], visible: true, components: [
                    { type: 'Sprite', data: { texture: 'sign.png' } }] },
            ],
        };
        const found = discoverSceneAssets(scene as never, (ref) => `assets/${ref}`);
        expect([...found.meshTextures].sort()).toEqual(['assets/wall.png', 'assets/wall_n.png']);
        expect([...found.meshMaterials]).toEqual(['assets/wall.esmaterial']);
    });
});
