// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Timeline bindings: a track path `@Name` resolves through the playing TimelinePlayer's binding of that name,
 *        anywhere in the scene, and a scene's binding is carried to the entity it loads as.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Name } from '../src/ecs/component';
import { TimelinePlayer } from '../src/timeline/TimelinePlayerComponent';
import { resolveTimelinePath, splitBoundPath } from '../src/timeline/timelineBindings';
import { resolveActiveShot } from '../src/timeline/timelineSequences';
import { TrackType, WrapMode, type TimelineAsset } from '../src/timeline/TimelineTypes';
import { loadSceneData, type SceneData } from '../src/scene/scene';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

describe('timeline bindings', () => {
    let world: World;
    let stage: Entity, hero: Entity, arm: Entity, child: Entity;
    beforeEach(() => {
        world = new World();
        const mod = createMockModule();
        world.connectCpp(mod.getRegistry(), mod);
        stage = world.spawn('stage'); world.insert(stage, Transform, {});
        child = world.spawn('Door'); world.insert(child, Transform, {}); world.insert(child, Name, { value: 'Door' }); world.setParent(child, stage);
        hero = world.spawn('hero'); world.insert(hero, Transform, {});
        arm = world.spawn('Arm'); world.insert(arm, Transform, {}); world.insert(arm, Name, { value: 'Arm' }); world.setParent(arm, hero);
        world.insert(stage, TimelinePlayer, { timeline: 'cut', bindingNames: ['Hero'], bindings: [hero] });
    });

    it('splits a bound path into its binding and the path below it', () => {
        expect(splitBoundPath('@Hero')).toEqual({ name: 'Hero', rest: '' });
        expect(splitBoundPath('@Hero/Arm/Hand')).toEqual({ name: 'Hero', rest: 'Arm/Hand' });
    });

    it('resolves @Name through the player’s binding, anywhere in the scene, and a plain path below the root', () => {
        expect(resolveTimelinePath(world, stage, stage, '@Hero')).toBe(hero);
        expect(resolveTimelinePath(world, stage, stage, '@Hero/Arm')).toBe(arm);
        expect(resolveTimelinePath(world, stage, stage, 'Door')).toBe(child);
        expect(resolveTimelinePath(world, stage, stage, '')).toBe(stage);
    });

    it('resolves nothing for a binding the player does not have, or one whose entity is gone', () => {
        expect(resolveTimelinePath(world, stage, stage, '@Villain')).toBeNull();
        world.despawn(hero);
        expect(resolveTimelinePath(world, stage, stage, '@Hero')).toBeNull();
    });

    it('binds two players of one timeline to two different entities', () => {
        const other = world.spawn('other'); world.insert(other, Transform, {});
        const twin = world.spawn('twin'); world.insert(twin, TimelinePlayer, { timeline: 'cut', bindingNames: ['Hero'], bindings: [other] });
        expect(resolveTimelinePath(world, twin, twin, '@Hero')).toBe(other);
        expect(resolveTimelinePath(world, stage, stage, '@Hero')).toBe(hero);
    });

    it('cuts between a local shot and a shot below an external binding', () => {
        const asset: TimelineAsset = { version: '1.3', type: 'timeline', duration: 2, wrapMode: WrapMode.Once, tracks: [{
            type: TrackType.Camera, name: 'Shots', childPath: '', clips: [
                { start: 0, duration: 1, camera: 'Door' },
                { start: 1, duration: 1, camera: '@Hero/Arm' },
            ],
        }] };
        const resolve = (root: Entity, path: string) => resolveTimelinePath(world, stage, root, path);
        expect(resolveActiveShot(asset, 0.5, stage, resolve, () => undefined)?.to).toBe(child);
        expect(resolveActiveShot(asset, 1, stage, resolve, () => undefined)?.to).toBe(arm);
    });

    it('carries a scene’s binding to the entity it loads as', async () => {
        const scene: SceneData = { version: 4, name: 'S', entities: [
            { id: 4, name: 'Stage', parent: null, children: [], components: [{ type: 'TimelinePlayer', data: { timeline: 'cut', bindingNames: ['Hero'], bindings: [9] } }] },
            { id: 9, name: 'Hero', parent: null, children: [], components: [{ type: 'Transform', data: {} }] },
        ] };
        const w = new World();
        const mod = createMockModule();
        w.connectCpp(mod.getRegistry(), mod);
        const map = await loadSceneData(w, scene);
        expect(w.get(map.get(4)!, TimelinePlayer).bindings).toEqual([map.get(9)]);
    });
});
