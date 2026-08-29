// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rebuild-plan.test.ts
 * @brief   The order to rebuild in, over ASSETS rather than over paths.
 *
 * @details A change names a file; everything that follows from it is an asset,
 *          and an asset is (type, path). Flattening the vertices to the paths
 *          they carry looks harmless while every path means one asset — and
 *          silently invents cycles the moment two of them share a file.
 */
import { describe, it, expect } from 'vitest';
import { rebuildPlan } from '../src/asset/dependencies';
import type { AssetIdentity } from '../src/asset/dependencies';

/** A reverse graph as a table: the file's readers under its path, and each
 *  asset's acquirers under `type:path`. */
function graph(edges: Record<string, AssetIdentity[]>) {
    return {
        ofSource: (path: string): readonly AssetIdentity[] => edges[path] ?? [],
        ofAsset: (asset: AssetIdentity): readonly AssetIdentity[] =>
            edges[`${asset.type}:${asset.path}`] ?? [],
    };
}

describe('a rebuild plan is over assets, not over paths', () => {
    it('the deepest dependency comes first, each cycle one group', () => {
        const plan = rebuildPlan('terrain.png', graph({
            'terrain.png': [{ type: 'tileset', path: 'terrain.estileset' }],
            'tileset:terrain.estileset': [{ type: 'tilemap', path: 'level.tmj' }],
        }));

        expect(plan).toEqual([
            [{ type: 'tileset', path: 'terrain.estileset' }],
            [{ type: 'tilemap', path: 'level.tmj' }],
        ]);
    });

    it('two assets under one path stay two vertices', () => {
        // The chain is a→b→a', where a and a' share a path and nothing else. As
        // paths it reads as a cycle between two of them, which collapses three
        // rebuilds into one group and loses the order between them.
        const plan = rebuildPlan('x', graph({
            x: [{ type: 'aa', path: 'p' }],
            'aa:p': [{ type: 'bb', path: 'q' }],
            'bb:q': [{ type: 'cc', path: 'p' }],
        }));

        expect(plan).toEqual([
            [{ type: 'aa', path: 'p' }],
            [{ type: 'bb', path: 'q' }],
            [{ type: 'cc', path: 'p' }],
        ]);
    });

    it('a real cycle is one group, not a hang', () => {
        const plan = rebuildPlan('x', graph({
            x: [{ type: 'aa', path: 'a' }],
            'aa:a': [{ type: 'bb', path: 'b' }],
            'bb:b': [{ type: 'aa', path: 'a' }],
        }));

        expect(plan).toHaveLength(1);
        expect(plan[0]).toEqual(expect.arrayContaining([
            { type: 'aa', path: 'a' }, { type: 'bb', path: 'b' },
        ]));
    });

    it('a file two assets read fans out to both, and each is visited once', () => {
        const plan = rebuildPlan('shared.tsj', graph({
            'shared.tsj': [{ type: 'tilemap', path: 'a.tmj' }, { type: 'tilemap', path: 'b.tmj' }],
            'tilemap:a.tmj': [{ type: 'scene', path: 'level.esscene' }],
            'tilemap:b.tmj': [{ type: 'scene', path: 'level.esscene' }],
        }));

        expect(plan.flat().filter((v) => v.path === 'level.esscene')).toHaveLength(1);
        const order = plan.flat().map((v) => v.path);
        expect(order.indexOf('level.esscene'), 'a scene rebuilt before the maps it holds')
            .toBeGreaterThan(order.indexOf('b.tmj'));
    });

    it('nothing depends on it, so there is nothing to do', () => {
        expect(rebuildPlan('lonely.png', graph({}))).toEqual([]);
    });
});
