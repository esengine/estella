// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneAssetResult } from '../asset/Assets';
import { AssetScope, type AssetLease } from '../asset/AssetLease';
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

function releaseSceneAssets(result?: SceneAssetResult): void {
    try { result?.scope.releaseAll(); }
    catch (error) { log.warn('scene', 'Scene asset cleanup failed', error); }
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

    isCurrent(): boolean {
        return this.world.entityLifetime === this.lifetime && !this.owner?.signal?.aborted;
    }

    assertCurrent(): void {
        if (!this.isCurrent()) throw new SceneLoadCancelled(this.name);
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

    /** Stop waiting when this scene retires, disposing any unclaimed result it would have owned. */
    async waitForShared<T>(read: () => Promise<T>, discard?: (value: T) => void): Promise<T> {
        this.assertCurrent();
        let release: (() => void) | undefined;
        let abandoned = false;
        let discardUnclaimed: (() => void) | undefined;
        try {
            const value = await new Promise<T>((resolve, reject) => {
                release = this.onCancel_(() => reject(new SceneLoadCancelled(this.name)));
                read().then(result => {
                    if (abandoned) { discard?.(result); return; }
                    if (discard) discardUnclaimed = () => discard(result);
                    resolve(result);
                }, reject);
            });
            this.assertCurrent();
            discardUnclaimed = undefined;
            return value;
        } finally {
            abandoned = true;
            release?.();
            discardUnclaimed?.();
        }
    }

    async preloadAssets(read: () => Promise<SceneAssetResult>): Promise<SceneAssetResult> {
        return this.assets = await this.waitForShared(read, releaseSceneAssets);
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
        releaseSceneAssets(this.assets);
    }

    /** An in-flight read can deliver a receipt after cancellation has closed its scope. */
    async acquireTemporaryAsset<T>(scope: AssetScope, read: () => Promise<AssetLease<T>>): Promise<AssetLease<T>> {
        this.assertCurrent();
        const lease = await read();
        try { this.assertCurrent(); }
        catch (error) {
            try { lease.release(); }
            catch (cleanupError) { log.warn('scene', 'Temporary scene asset cleanup failed', cleanupError); }
            throw error;
        }
        return scope.add(lease);
    }

    /** Close temporary prefab receipts without replacing an existing load error. */
    closeTemporaryScope(scope: AssetScope, completed: boolean): void {
        try { AssetScope.closeAll([scope]); }
        catch (error) {
            if (completed) {
                this.discardAssets();
                throw error;
            }
            log.warn('scene', 'Temporary scene asset cleanup failed', error);
        }
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
