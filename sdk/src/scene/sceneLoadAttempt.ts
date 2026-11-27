// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneAssetResult } from '../asset/Assets';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { log } from '../util/logger';
import type { ScenePhaseSink } from './scene';
import type { SceneContext } from './sceneManager';
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

    constructor(private readonly world: World, private readonly name: string,
        private readonly owner?: { signal?: AbortSignal; check?(): void }) {
        this.lifetime = world.entityLifetime;
    }

    assertCurrent(): void {
        if (this.world.entityLifetime !== this.lifetime || this.owner?.signal?.aborted) throw new SceneLoadCancelled(this.name);
        this.owner?.check?.();
    }

    /** Publish the whole hierarchy while the origin and its world can still accept it. */
    adoptEntities(entities: Map<number, Entity>, scene?: Pick<SceneContext, 'adopt'> | null): void {
        this.entities = entities;
        if (scene) for (const entity of entities.values()) {
            this.assertCurrent();
            scene.adopt(entity);
        }
        this.assertCurrent();
    }

    observe(sink?: ScenePhaseSink): ScenePhaseSink | undefined {
        if (!sink) return undefined;
        return (phase, ms) => {
            if (this.world.entityLifetime !== this.lifetime) return;
            this.assertCurrent();
            sink(phase, ms);
            this.assertCurrent();
        };
    }

    private onCancel_(cancel: () => void): () => void {
        const release = this.world.onCoreDisconnect(cancel);
        const signal = this.owner?.signal;
        signal?.addEventListener('abort', cancel);
        return () => { signal?.removeEventListener('abort', cancel); release(); };
    }

    /** Stop waiting for shared data when this scene retires. The underlying read still serves its other callers. */
    async waitForShared<T>(read: () => Promise<T>): Promise<T> {
        this.assertCurrent();
        let release: (() => void) | undefined;
        try {
            const value = await new Promise<T>((resolve, reject) => {
                release = this.onCancel_(() => reject(new SceneLoadCancelled(this.name)));
                read().then(resolve, reject);
            });
            this.assertCurrent();
            return value;
        } finally { release?.(); }
    }

    /** A staged spawn and its outer publication share the same cancellation cleanup. */
    watch(): () => void {
        if (this.watching) return () => {};
        this.watching = true;
        const release = this.onCancel_(() => {
            try { this.discardEntities(); }
            finally { this.discardAssets(); }
        });
        return () => { this.watching = false; release(); };
    }

    discardAssets(): void {
        try { this.assets?.scope.releaseAll(); }
        catch (error) { log.warn('scene', 'Scene asset cleanup failed', error); }
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
    attempt: SceneLoadAttempt, work: () => Promise<T>, assets?: SceneAssetResult, publish?: () => void,
): Promise<T> {
    attempt.assets = assets;
    const release = attempt.watch();
    try {
        attempt.assertCurrent();
        const value = await work();
        attempt.assertCurrent();
        publish?.();
        return value;
    } catch (error) {
        attempt.discardEntities();
        attempt.discardAssets();
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
