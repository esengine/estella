// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   esengine/persist — what a server keeps across restarts. A store
 *          interface with versioned writes (memory and file implementations;
 *          a database is the game's adapter), schema-versioned records with
 *          migrations, entity snapshots, per-player records that follow the
 *          players present, and world entities marked `Persistent`.
 */
export {
    MemoryStore,
    PersistConflict,
    type PersistStore,
    type PersistWriteOptions,
    type StoredDocument,
} from './store';
export { FileStore } from './fileStore';
export { RecordBook, type RecordBookOptions, type RecordEnvelope, type LoadedRecord } from './records';
export { snapshotEntity, restoreEntity, type EntitySnapshot, type EntitySnapshotOptions } from './entitySnapshot';
export { PlayerPersistence, type PlayerPersistenceOptions } from './players';
export {
    Persistent,
    WorldPersistence,
    ensurePersistComponentsRegistered,
    type PersistentData,
    type WorldPersistenceOptions,
    type WorldFlushResult,
} from './world';
export type { SaveMigration } from '../scene/saveGame';
