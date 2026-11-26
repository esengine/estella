// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world.ts
 * @brief   The entities of a world that outlive the process: mark one
 *          `Persistent` and it is written to the store under its key, and a
 *          server that starts again restores it — onto the entity with that
 *          key if the scene already has one, as a new entity if not.
 *
 *          Writes are by difference: a flush serializes every persistent
 *          entity, compares it with what it last wrote, and writes only the
 *          ones that changed, so flushing often costs little when little moves.
 */
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { defineComponent } from '../ecs/component';
import type { SaveMigration } from '../scene/saveGame';
import { restoreEntity, snapshotEntity, type EntitySnapshot, type EntitySnapshotOptions } from './entitySnapshot';
import { RecordBook, type LoadedRecord } from './records';
import type { PersistStore } from './store';

export interface PersistentData {
    /** The entity's key in the store. Empty: one is made up on its first flush and written back here. */
    key: string;
}

/** Marks an entity whose state is kept across restarts. */
export const Persistent = defineComponent<PersistentData>('Persistent', { key: '' });

/** Register again after a user-component registry reset (see `ensureReplicationComponentsRegistered`). */
export function ensurePersistComponentsRegistered(): void {
    defineComponent<PersistentData>('Persistent', { key: '' });
}

export interface WorldPersistenceOptions extends EntitySnapshotOptions {
    store: PersistStore;
    /** Current schema version of a saved entity. */
    schema: number;
    /** `migrations[n]` upgrades an entity snapshot written at schema n to n + 1. */
    migrations?: Record<number, SaveMigration>;
    /** Key prefix in the store. Default `entity:`. */
    prefix?: string;
}

export interface WorldFlushResult {
    written: number;
    deleted: number;
}

let keySeq = 0;
function makeKey(): string {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}-${rand}-${(keySeq++).toString(36)}`;
}

export class WorldPersistence {
    private readonly book_: RecordBook<EntitySnapshot>;
    private readonly snapshot_: EntitySnapshotOptions;
    /** key -> the JSON last written (or restored) and the store version it is at. */
    private readonly written_ = new Map<string, { json: string; version: number }>();
    private operation_: Promise<unknown> | null = null;

    constructor(options: WorldPersistenceOptions) {
        ensurePersistComponentsRegistered();
        this.book_ = new RecordBook<EntitySnapshot>({
            store: options.store, schema: options.schema, migrations: options.migrations,
            prefix: options.prefix ?? 'entity:',
        });
        this.snapshot_ = { include: options.include, exclude: options.exclude };
    }

    /**
     * Bring back every stored entity. One the world already holds under the
     * same key (placed by the scene) takes the stored state; the rest are
     * spawned. Returns how many were restored. Queue it before the first flush.
     */
    async restore(world: World): Promise<number> {
        const lifetime = world.entityLifetime;
        return this.enqueue_(() => this.restoreNow_(world, lifetime));
    }

    private async restoreNow_(world: World, lifetime: symbol): Promise<number> {
        const assertCurrent = () => {
            if (world.entityLifetime !== lifetime) throw new Error('[persist] the world changed during entity restore');
        };
        assertCurrent();
        const rows: { key: string; loaded: LoadedRecord<EntitySnapshot>; json: string }[] = [];
        for (const key of await this.book_.keys()) {
            const loaded = await this.book_.load(key);
            if (loaded) rows.push({ key, loaded, json: JSON.stringify(loaded.data) });
        }
        assertCurrent();

        const byKey = new Map<string, Entity>();
        for (const e of world.getEntitiesWithComponents([Persistent])) {
            const key = (world.tryGet(e, Persistent) as PersistentData).key;
            if (key) byKey.set(key, e);
        }
        for (const { key, loaded, json } of rows) {
            const target = byKey.get(key);
            const into = target !== undefined && !world.isDestructionPending(target)
                && world.tryGet(target, Persistent)?.key === key ? target : undefined;
            const e = restoreEntity(world, loaded.data, into);
            if (into === undefined) {
                assertCurrent();
                world.insert(e, Persistent, { key });
            }
            assertCurrent();
            this.written_.set(key, { json, version: loaded.version });
        }
        return rows.length;
    }

    /**
     * Write every persistent entity that changed since it was last written,
     * and delete the stored ones whose entity is gone. Queued with restores and other flushes.
     */
    flush(world: World): Promise<WorldFlushResult> {
        return this.enqueue_(() => this.flushNow_(world));
    }

    private enqueue_<T>(run: () => Promise<T>): Promise<T> {
        const next: Promise<T> = (this.operation_ ?? Promise.resolve()).then(run, run).finally(() => {
            if (this.operation_ === next) this.operation_ = null;
        });
        this.operation_ = next;
        return next;
    }

    private async flushNow_(world: World): Promise<WorldFlushResult> {
        // Snapshot everything first, synchronously, so the flush records one
        // moment of the world however long the writes take.
        const now = new Map<string, string>();
        const snaps = new Map<string, EntitySnapshot>();
        for (const e of world.getEntitiesWithComponents([Persistent])) {
            let key = (world.tryGet(e, Persistent) as PersistentData).key;
            if (!key) {
                key = makeKey();
                world.insert(e, Persistent, { key });
            }
            const snap = snapshotEntity(world, e, this.snapshot_);
            snaps.set(key, snap);
            now.set(key, JSON.stringify(snap));
        }
        let written = 0;
        let deleted = 0;
        for (const [key, json] of now) {
            const prev = this.written_.get(key);
            if (prev?.json === json) continue;
            const version = await this.book_.save(key, snaps.get(key)!, prev?.version ?? 0);
            this.written_.set(key, { json, version });
            written++;
        }
        for (const [key, prev] of [...this.written_]) {
            if (now.has(key)) continue;
            await this.book_.delete(key, prev.version);
            this.written_.delete(key);
            deleted++;
        }
        return { written, deleted };
    }
}
