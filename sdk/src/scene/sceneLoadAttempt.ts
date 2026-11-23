// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneAssetResult } from '../asset/Assets';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { log } from '../util/logger';
import type { ScenePhaseSink } from './scene';

/** Resources and entities owned by one load until publication succeeds. */
export interface SceneLoadAttempt {
    assets?: SceneAssetResult;
    entities?: Map<number, Entity>;
}

export function discardSceneEntities(world: World, entities: Iterable<Entity>): void {
    for (const entity of entities) {
        try { if (world.valid(entity)) world.despawn(entity); }
        catch (error) { log.warn('scene', `Failed to discard scene entity ${entity}`, error); }
    }
}

export async function runSceneLoad<T>(
    world: World, work: (attempt: SceneLoadAttempt) => Promise<T>, assets?: SceneAssetResult,
): Promise<T> {
    const attempt: SceneLoadAttempt = { assets };
    try { return await work(attempt); }
    catch (error) {
        if (attempt.entities) discardSceneEntities(world, attempt.entities.values());
        try { attempt.assets?.scope.releaseAll(); }
        catch (cleanupError) { log.warn('scene', 'Scene asset cleanup failed', cleanupError); }
        throw error;
    }
}

export function scenePhaseRunner(onPhase?: ScenePhaseSink) {
    return async <T>(phase: string, run: () => Promise<T> | T): Promise<T> => {
        if (!onPhase) return run();
        const began = performance.now();
        try { return await run(); } finally { onPhase(phase, performance.now() - began); }
    };
}
