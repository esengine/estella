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
function planFrom(changed: string, edges: Record<string, AssetIdentity[]>) {
    return rebuildPlan(edges[changed] ?? [], asset => edges[`${asset.type}:${asset.path}`] ?? []);
}

describe('a rebuild plan is over assets, not over paths', () => {
    it('the deepest dependency comes first, each cycle one group', () => {
        const plan = planFrom('terrain.png', {
            'terrain.png': [{ type: 'tileset', path: 'terrain.estileset' }],
            'tileset:terrain.estileset': [{ type: 'tilemap', path: 'level.tmj' }],
        });

        expect(plan).toEqual([
            [{ type: 'tileset', path: 'terrain.estileset' }],
            [{ type: 'tilemap', path: 'level.tmj' }],
        ]);
    });

    it('two assets under one path stay two vertices', () => {
        // The chain is a→b→a', where a and a' share a path and nothing else. As
        // paths it reads as a cycle between two of them, which collapses three
        // rebuilds into one group and loses the order between them.
        const plan = planFrom('x', {
            x: [{ type: 'aa', path: 'p' }],
            'aa:p': [{ type: 'bb', path: 'q' }],
            'bb:q': [{ type: 'cc', path: 'p' }],
        });

        expect(plan).toEqual([
            [{ type: 'aa', path: 'p' }],
            [{ type: 'bb', path: 'q' }],
            [{ type: 'cc', path: 'p' }],
        ]);
    });

    it('a real cycle is one group, not a hang', () => {
        const plan = planFrom('x', {
            x: [{ type: 'aa', path: 'a' }],
            'aa:a': [{ type: 'bb', path: 'b' }],
            'bb:b': [{ type: 'aa', path: 'a' }],
        });

        expect(plan).toHaveLength(1);
        expect(plan[0]).toEqual(expect.arrayContaining([
            { type: 'aa', path: 'a' }, { type: 'bb', path: 'b' },
        ]));
    });

    it('a file two assets read fans out to both, and each is visited once', () => {
        const plan = planFrom('shared.tsj', {
            'shared.tsj': [{ type: 'tilemap', path: 'a.tmj' }, { type: 'tilemap', path: 'b.tmj' }],
            'tilemap:a.tmj': [{ type: 'scene', path: 'level.esscene' }],
            'tilemap:b.tmj': [{ type: 'scene', path: 'level.esscene' }],
        });

        expect(plan.flat().filter((v) => v.path === 'level.esscene')).toHaveLength(1);
        const order = plan.flat().map((v) => v.path);
        expect(order.indexOf('level.esscene'), 'a scene rebuilt before the maps it holds')
            .toBeGreaterThan(order.indexOf('b.tmj'));
    });

    it('nothing depends on it, so there is nothing to do', () => {
        expect(planFrom('lonely.png', {})).toEqual([]);
    });

    it('orders a deep chain ending in a cycle without using the host call stack', () => {
        const nodes = Array.from({ length: 12000 }, (_, i) => ({ type: 'material', path: String(i) }));
        const plan = rebuildPlan([nodes[0]], node => [nodes[Number(node.path) + 1] ?? nodes[nodes.length - 2]]);
        expect(plan).toHaveLength(nodes.length - 1);
        expect(plan.slice(0, -1).map(group => group[0])).toEqual(nodes.slice(0, -2));
        expect(plan[plan.length - 1]).toEqual([nodes[nodes.length - 1], nodes[nodes.length - 2]]);
    });
});
