// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entityRef.ts — what "the same entity" means across the play boundary.
 *
 * The editor's scene document and the running realm are two worlds with two id
 * spaces: a document `src` id, and a realm runtime handle. A ref names an entity
 * in whichever of the two owns it, so one tree, one selection and one inspector
 * can span both instead of being switched between.
 *
 * A ref is pure identity — it holds no live id for an authored entity, because
 * that changes with every play session. Ask {@link liveIdOf} for the current one.
 */
import type { EntityId } from '@/types';

export type EntityRef =
  /** An entity the open scene document declares; `src` is its document id. */
  | { world: 'authored'; src: EntityId }
  /** An entity only the running game has — it despawns with the realm. */
  | { world: 'spawned'; live: EntityId };

export const authoredRef = (src: EntityId): EntityRef => ({ world: 'authored', src });
export const spawnedRef = (live: EntityId): EntityRef => ({ world: 'spawned', live });

/** Row/expansion key. Authored keys match the plain-scene ones, so a saved
 *  expansion set still opens the same rows after a play session. */
export const refKey = (ref: EntityRef): string =>
  ref.world === 'authored' ? `e${ref.src}` : `l${ref.live}`;

export const sameRef = (a: EntityRef | null, b: EntityRef | null): boolean =>
  a === b || (a != null && b != null && refKey(a) === refKey(b));

/** The document id, or null for something only the running game has. */
export const srcIdOf = (ref: EntityRef | null): EntityId | null =>
  ref?.world === 'authored' ? ref.src : null;

/** Where a live tree entity's identity comes from: its `src` when the realm
 *  reported one, else the realm handle itself. */
export const refOfLive = (id: EntityId, src: number | undefined): EntityRef =>
  src === undefined ? spawnedRef(id) : authoredRef(src);
