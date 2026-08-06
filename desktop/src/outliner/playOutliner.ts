// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  playOutliner.ts — the running world's tree view-state.
 *
 * The second {@link createOutlinerStore} instance, over the live realm snapshot
 * instead of the edited scene. It is a separate store rather than a mode of the
 * editor one because the two speak different id spaces — source ids and realm
 * runtime ids — and one expansion set across both would open rows at random.
 *
 * The live world has no folders (nothing organizes a running game but its own
 * hierarchy), so `folderOf` is always the root.
 */
import { PlayInspect } from '@/engine/PlayInspect';
import type { EntityId } from '@/types';
import { createOutlinerStore } from './OutlinerController';
import { ROOT_FOLDER } from './folders';

export const usePlayOutliner = createOutlinerStore({
  parentOf: (id) => PlayInspect.getTree()?.entities.find((e) => e.id === id)?.parent ?? null,
  folderOf: () => ROOT_FOLDER,
});

/**
 * Drop expansion for entities the running world no longer has.
 *
 * Not housekeeping: the ECS recycles entity ids, so without this a bullet
 * spawned into a despawned parent's id arrives already expanded — and rows open
 * on their own while you are reading somewhere else in the tree.
 */
export function pruneToLiveEntities(ids: ReadonlySet<EntityId>): void {
  usePlayOutliner.getState().retainIds(ids);
}
