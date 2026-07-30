// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineRoot.ts
 * @brief   Which entity a timeline previews against — derived from the document
 *          rather than asked for.
 *
 * A timeline's tracks address their targets by child path, so the preview needs the
 * ROOT of the subtree the clip animates. That root is not a mystery: it is the entity
 * whose `TimelinePlayer` plays this very asset. Binding to "whatever was selected when
 * you opened the file" instead meant that opening a clip from the Content Browser —
 * where the selection is an asset, not an entity — bound to nothing, and playing the
 * Sequencer then animated nothing at all, silently.
 *
 * The selection still wins when it is a player for this asset (or sits inside one), so
 * picking one of several instances previews that one; and an unbound selection is still
 * the answer when authoring a fresh clip onto a chosen entity, which is what the
 * recorder needs.
 *
 * Pure over the model's entity list — no store, no World.
 */

/** The entity shape this reads: identity, parent link, and component data. */
export interface TimelineRootEntity {
  id: number;
  parent?: number | null;
  components: readonly { type: string; data?: Record<string, unknown> }[];
}

const PLAYER = 'TimelinePlayer';

/** Whether this entity plays the asset `matches` accepts. */
function playsAsset(e: TimelineRootEntity, matches: (ref: string) => boolean): boolean {
  const player = e.components.find((c) => c.type === PLAYER);
  const ref = player?.data?.timeline;
  return typeof ref === 'string' && ref !== '' && matches(ref);
}

/**
 * The preview root for the open timeline, in order of preference:
 *   1. the selection, or its nearest ancestor, that plays this asset — so selecting a
 *      node inside an effect previews the effect, not the node;
 *   2. the only entity in the document that plays it (any of them, in document order,
 *      when a scene holds several instances);
 *   3. the raw selection — authoring a new clip onto the entity you picked;
 *   4. null, when there is nothing to preview against.
 */
export function resolveTimelineRoot(
  entities: readonly TimelineRootEntity[],
  selectedId: number | null,
  matches: (ref: string) => boolean,
): number | null {
  const byId = new Map(entities.map((e) => [e.id, e]));

  for (let cur = selectedId; cur != null; ) {
    const e = byId.get(cur);
    if (!e) break;
    if (playsAsset(e, matches)) return e.id;
    cur = e.parent ?? null;
  }

  const player = entities.find((e) => playsAsset(e, matches));
  if (player) return player.id;

  return selectedId ?? null;
}

/** Every entity that plays the asset — for telling the user a scene holds more than
 *  one instance of the effect they are editing. */
export function timelinePlayersFor(
  entities: readonly TimelineRootEntity[],
  matches: (ref: string) => boolean,
): number[] {
  return entities.filter((e) => playsAsset(e, matches)).map((e) => e.id);
}
