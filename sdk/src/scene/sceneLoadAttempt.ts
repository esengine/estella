// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneAssetResult } from '../asset/Assets';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { log } from '../util/logger';
import type { ScenePhaseSink } from './scene';
import { SceneEntityBatch } from './sceneHierarchy';

/** A pending scene lost its owner before it could publish. */
export class SceneLoadCancelled extends Error {
    constructor(name: string) {
        super(`Scene load for "${name}" was cancelled (the scene was unloaded or its world or manager was reset)`);
        this.name = 'SceneLoadCancelled';
    }
}

/** Resources and entities owned by one load until publication succeeds. */
export class SceneLoadAttempt {
    assets?: SceneAssetResult;
    entities?: Map<number, Entity>;
    readonly lifetime: symbol;
    private watching = false;

    constructor(private readonly world: World, private readonly name: string) {
        this.lifetime = world.entityLifetime;
    }

    assertCurrent(): void {
        if (this.world.entityLifetime !== this.lifetime) throw new SceneLoadCancelled(this.name);
    }

    observe(sink?: ScenePhaseSink): ScenePhaseSink | undefined {
        if (!sink) return undefined;
        return (phase, ms) => {
            if (this.world.entityLifetime !== this.lifetime) return;
            sink(phase, ms);
            this.assertCurrent();
        };
    }

    /** A staged spawn and its outer publication share one disconnect listener. */
    watch(): () => void {
        if (this.watching) return () => {};
        this.watching = true;
        const release = this.world.onCoreDisconnect(() => {
            try { this.discardEntities(); }
            finally { this.assets?.scope.releaseAll(); }
        });
        return () => { this.watching = false; release(); };
    }

    discardEntities(): void {
        const entities = this.entities;
        this.entities = undefined;
        if (entities) discardSceneEntities(this.world, entities.values(), this.lifetime);
    }
}

export function discardSceneEntities(world: World, entities: Iterable<Entity>, lifetime: symbol): void {
    if (world.entityLifetime !== lifetime) return;
    const doomed = Array.from(entities);
    const batch = new SceneEntityBatch(world, doomed, lifetime);
    for (const entity of doomed) {
        try { batch.despawn(entity); }
        catch (error) { log.warn('scene', `Failed to discard scene entity ${entity}`, error); }
    }
}

export async function runSceneLoad<T>(
    attempt: SceneLoadAttempt, work: () => Promise<T>, assets?: SceneAssetResult,
): Promise<T> {
    attempt.assets = assets;
    const release = attempt.watch();
    try {
        attempt.assertCurrent();
        const value = await work();
        attempt.assertCurrent();
        return value;
    } catch (error) {
        attempt.discardEntities();
        try { attempt.assets?.scope.releaseAll(); }
        catch (cleanupError) { log.warn('scene', 'Scene asset cleanup failed', cleanupError); }
        throw error;
    } finally { release(); }
}

export function scenePhaseRunner(onPhase?: ScenePhaseSink) {
    return async <T>(phase: string, run: () => Promise<T> | T): Promise<T> => {
        if (!onPhase) return run();
        const began = performance.now();
        try { return await run(); } finally { onPhase(phase, performance.now() - began); }
    };
}
