// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    previewRoot.ts
 * @brief   The one door for "which entity should the Sequencer preview against" —
 *          the open document + selection, resolved through {@link resolveTimelineRoot}.
 *
 * Kept apart from the pure resolver so the rule stays unit-testable while this side
 * owns the wiring: the model, the selection store, and the asset registry that turns
 * the open file path into the `@uuid:` ref a `TimelinePlayer` actually stores.
 */

import { SceneModel } from '@/engine/SceneModel';
import { useSelection } from '@/store/selectionStore';
import { ProjectStore } from '@/project/ProjectStore';
import { resolveTimelineRoot, timelinePlayersFor, type TimelineRootEntity } from './timelineRoot';

/** Matches the refs that name this project-relative asset path: a `TimelinePlayer`
 *  may hold the `@uuid:` form (what the editor writes) or the path itself. */
function refMatcher(filePath: string | null): (ref: string) => boolean {
  if (!filePath) return () => false;
  const uuidRef = ProjectStore.assetRef(filePath);
  return (ref) => ref === filePath || (!!uuidRef && ref === uuidRef);
}

function modelEntities(): TimelineRootEntity[] {
  return (SceneModel.current?.entities ?? []) as unknown as TimelineRootEntity[];
}

/** The preview root for the timeline at `filePath`, given the current selection. */
export function previewRootFor(filePath: string | null): number | null {
  return resolveTimelineRoot(modelEntities(), useSelection.getState().selectedId ?? null, refMatcher(filePath));
}

/** How many entities in the open document play this timeline (the Sequencer says so
 *  when there is more than one, since the preview shows exactly one of them). */
export function playerCountFor(filePath: string | null): number {
  return timelinePlayersFor(modelEntities(), refMatcher(filePath)).length;
}
