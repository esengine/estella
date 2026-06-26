// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-apply-routing.test.ts
 * @brief   Regression: after S3 (native runtime deleted), applySpineEntities must
 *          route EVERY version — including 4.2 — to the SpineManager. The pre-fix
 *          code skipped 4.2 (`version === '4.2'` → continue), a native-routing
 *          remnant that left 4.2 spine unrendered in the runtime/play path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, clearUserComponents } from '../src/component';
import { applySpineEntities } from '../src/spine/loadSpineScene';
import type { SceneData } from '../src/scene';
import type { Entity } from '../src/types';

const SPINE_COMP = 'ApplyRouting_Spine';

beforeEach(() => {
    clearUserComponents();
    defineComponent(SPINE_COMP, { skeleton: '', atlas: '' }, {
        spineFields: { skeletonField: 'skeleton', atlasField: 'atlas' },
    });
});

function makeManager() {
    return {
        loadEntity: vi.fn(async () => '4.2'),
        setEntityProps: vi.fn(),
        setSkin: vi.fn(),
        setAnimation: vi.fn(),
    };
}

function sceneWith(skel: string, atlas: string): SceneData {
    return {
        version: 1,
        entities: [{
            id: 1,
            components: [{ type: SPINE_COMP, data: { skeleton: skel, atlas, animation: 'walk' } }],
        }],
    } as unknown as SceneData;
}

describe('applySpineEntities routes every version to the SpineManager (S3)', () => {
    it('loads a 4.2 entity — there is no native fallback to skip to', async () => {
        const manager = makeManager();
        const entity = 42 as Entity;
        await applySpineEntities({
            spineManager: manager as never,
            sceneData: sceneWith('hero.skel', 'hero.atlas'),
            entityMap: new Map([[1, entity]]),
            registry: {} as never,
            assetInfo: new Map([['hero.skel:hero.atlas', {
                version: '4.2' as const, skelData: new Uint8Array(), atlasText: '', textures: new Map(),
            }]]),
        });
        expect(manager.loadEntity).toHaveBeenCalledTimes(1);
        expect(manager.loadEntity).toHaveBeenCalledWith(
            entity, expect.anything(), '', expect.anything(), expect.anything(), 'hero.skel:hero.atlas');
        expect(manager.setAnimation).toHaveBeenCalledWith(entity, 'walk', true);
    });

    it('still skips an asset with no detected version (no manager could load it)', async () => {
        const manager = makeManager();
        await applySpineEntities({
            spineManager: manager as never,
            sceneData: sceneWith('x.skel', 'x.atlas'),
            entityMap: new Map([[1, 7 as Entity]]),
            registry: {} as never,
            assetInfo: new Map([['x.skel:x.atlas', {
                version: null, skelData: new Uint8Array(), atlasText: '', textures: new Map(),
            }]]),
        });
        expect(manager.loadEntity).not.toHaveBeenCalled();
    });
});
