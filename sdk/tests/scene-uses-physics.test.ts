// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Physics self-gating scan: a scene needs the physics module when it has
 *        physics components OR a TilemapLayer that may spawn tile colliders —
 *        baked ids (legacy) or a `.estileset` reference whose collision derives
 *        live at load. Editor-created tilemaps stopped baking collidableTileIds,
 *        so the ref check is what keeps tilemap-only-collision scenes working.
 */
import { describe, it, expect } from 'vitest';
import { sceneUsesPhysics } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';

function scene(components: Array<{ type: string; data?: Record<string, unknown> }>): SceneData {
    return {
        version: '1.0',
        name: 'test',
        entities: [{ id: 1, name: 'e', parent: null, children: [], components: components.map(c => ({ type: c.type, data: c.data ?? {} })) }],
    };
}

describe('sceneUsesPhysics', () => {
    it('false for a scene with no physics surface', () => {
        expect(sceneUsesPhysics(scene([{ type: 'Sprite' }]))).toBe(false);
    });

    it('true for a physics component', () => {
        expect(sceneUsesPhysics(scene([{ type: 'RigidBody' }]))).toBe(true);
    });

    it('true for a TilemapLayer with baked collidable ids (legacy scenes)', () => {
        expect(sceneUsesPhysics(scene([
            { type: 'TilemapLayer', data: { collidableTileIds: [1, 2] } },
        ]))).toBe(true);
    });

    it('true for a TilemapLayer referencing a .estileset (live-derived collision)', () => {
        expect(sceneUsesPhysics(scene([
            { type: 'TilemapLayer', data: { tilesetAsset: '@uuid:e43a0ed9-50e9-46d8-b1db-da1c549590a8' } },
        ]))).toBe(true);
    });

    it('false for a TilemapLayer with neither ids nor a tileset ref', () => {
        expect(sceneUsesPhysics(scene([
            { type: 'TilemapLayer', data: { collidableTileIds: [], tilesetAsset: '' } },
        ]))).toBe(false);
    });
});
