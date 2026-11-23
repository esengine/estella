// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AnyComponentDef } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { Pose, PoseWorld } from './pose';

type ComponentKeys = Record<string, object | undefined>;

type AnimationWorld = PoseWorld & Partial<Pick<World, 'onDespawn' | 'onCoreDisconnect' | 'isDestructionPending'>>;

/** Each animated entity owns a key into the scratch poses and timeline rests that sampled it. */
export class PoseStorage {
    entities: Record<number, ComponentKeys | undefined> = Object.create(null);
    /** Lets an in-flight writer recheck its tracks only after a sampled lifetime ends. */
    retirementRevision = 0;
    private readonly active_: Pose[] = [];
    private depth_ = 0;
    private entityCount_ = 0;

    private watch(world: AnimationWorld): void {
        const detach = () => { offDespawn?.(); offCore?.(); };
        const offDespawn = world.onDespawn?.(entity => {
            if (!this.entities[entity]) return;
            delete this.entities[entity];
            this.retirementRevision++;
            if (--this.entityCount_ === 0) detach();
        });
        const offCore = world.onCoreDisconnect?.(() => {
            this.entities = Object.create(null);
            this.retirementRevision++;
            this.entityCount_ = 0;
            detach();
        });
    }

    keyFor(entity: Entity, world: AnimationWorld): ComponentKeys | undefined {
        let keys = this.entities[entity];
        if (keys) return keys;
        // A listener can still read a component during teardown.
        if (world.isDestructionPending?.(entity)) return undefined;
        keys = Object.create(null) as ComponentKeys;
        this.entities[entity] = keys;
        if (++this.entityCount_ === 1) this.watch(world);
        return keys;
    }

    // The ordered track lists are strong only while the evaluator and its consumers run.
    // A nested sample returns its own lists and leaves the outer sample intact.
    begin(): number {
        this.depth_++;
        return this.active_.length;
    }

    hold(pose: Pose): boolean {
        if (this.depth_ === 0) return false;
        this.active_.push(pose);
        return true;
    }

    end(mark: number): void {
        while (this.active_.length > mark) this.active_.pop()!.finishEvaluation();
        this.depth_--;
    }
}

const stores = new WeakMap<PoseWorld, PoseStorage>();

export function poseStorageFor(world: AnimationWorld): PoseStorage {
    let storage = stores.get(world);
    if (!storage) {
        storage = new PoseStorage();
        stores.set(world, storage);
    }
    return storage;
}

/** A track belongs to both its evaluator and its entity's registered component name. */
export class StoredPoseTracks<T> {
    private readonly values_ = new WeakMap<object, T>();

    constructor(public storage: PoseStorage) {}

    lookup(entity: Entity, def: AnyComponentDef): T | undefined {
        const key = this.storage.entities[entity]?.[def._name];
        return key && this.values_.get(key);
    }

    /** Take the key before reading the world: a custom getter can retire the entity or replace the core. */
    keyFor(entity: Entity, def: AnyComponentDef, world: AnimationWorld): object | undefined {
        const keys = this.storage.keyFor(entity, world);
        return keys && (keys[def._name] ??= {});
    }

    remember(key: object | undefined, value: T): void {
        if (key) this.values_.set(key, value);
    }
}
