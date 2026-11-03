// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ambient most of a project's game scenes set is what a converted effect's scene parameters start at.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ambientOfScene, dominantAmbient } from '../src/import/cocos/sceneAmbient';
import type { CocosAssetEntry, CocosAssetIndex } from '../src/import/cocos/assets';

const v4 = (x: number, y: number, z: number) => ({ __type__: 'cc.Vec4', x, y, z, w: 0 });
const scene = (sky: [number, number, number], illum: number, ground: [number, number, number]) => [
    { __type__: 'cc.SceneAsset', scene: { __id__: 1 } },
    { __type__: 'cc.Scene', _globals: { __id__: 2 } },
    { __type__: 'cc.SceneGlobals', ambient: { __id__: 3 } },
    { __type__: 'cc.AmbientInfo', _skyColorLDR: v4(...sky), _skyIllumLDR: illum, _groundAlbedoLDR: v4(...ground) },
];

describe('the ambient of a project', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cocos-ambient-scenes-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    const entries: CocosAssetEntry[] = [];
    const put = (rel: string, content: unknown): void => {
        const file = path.join(dir, rel.replace(/\//g, '_'));
        writeFileSync(file, JSON.stringify(content));
        entries.push({ uuid: String(entries.length), file, rel, importer: 'scene', userData: {}, subs: new Map() });
    };
    const index = (): CocosAssetIndex => ({ root: dir, byUuid: new Map(entries.map((e) => [e.uuid, e])), bundles: [] });

    it('reads the sky colour with its illumination, and the ground', () => {
        put('a/one.scene', scene([0.5, 0.6, 1], 0.8, [1, 1, 1]));
        expect(ambientOfScene(entries[0]!.file)).toEqual({ sky: [0.5, 0.6, 1, 0.8], ground: [1, 1, 1, 1] });
    });

    it('is the one most game scenes set, and not what the editor tools set', () => {
        put('a/two.scene', scene([0.5, 0.6, 1], 0.8, [1, 1, 1]));
        put('a/three.scene', scene([1, 1, 1], 1, [0.6, 0.6, 0.5]));
        for (const n of ['x', 'y', 'z', 'w']) put(`editor/${n}.scene`, scene([0.2, 0.2, 0.2], 0.5, [0.1, 0.1, 0.1]));
        expect(dominantAmbient(index())).toEqual({ sky: [0.5, 0.6, 1, 0.8], ground: [1, 1, 1, 1] });
    });

    it('is null for a project whose scenes set none', () => {
        expect(dominantAmbient({ root: dir, byUuid: new Map(), bundles: [] })).toBeNull();
    });
});
