// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which entity a timeline previews against (timeline/timelineRoot.ts).
 *        The Sequencer used to bind to "whatever was selected when you opened the
 *        file", so opening a clip from the Content Browser — where the selection is an
 *        asset — bound to nothing and playing animated nothing, silently. The root is
 *        derivable: it is the entity whose TimelinePlayer plays this asset.
 */
import { describe, it, expect } from 'vitest';
import { resolveTimelineRoot, timelinePlayersFor, type TimelineRootEntity } from '@/timeline/timelineRoot';

const REF = '@uuid:11111111-2222-3333-4444-555555555555';
const PATH = 'assets/timelines/fx-twinkle.estimeline';
const matches = (ref: string): boolean => ref === REF || ref === PATH;

/** An effect instance: a player root with two children, plus an unrelated entity. */
function scene(): TimelineRootEntity[] {
  return [
    { id: 1, parent: null, components: [{ type: 'Transform', data: {} }] },
    { id: 2, parent: 1, components: [{ type: 'UINode', data: {} }, { type: 'TimelinePlayer', data: { timeline: REF } }] },
    { id: 3, parent: 2, components: [{ type: 'UIVisual', data: {} }] },
    { id: 4, parent: 2, components: [{ type: 'UIVisual', data: {} }] },
    { id: 5, parent: 1, components: [{ type: 'Text', data: {} }] },
  ];
}

describe('resolveTimelineRoot', () => {
  it('finds the player when nothing is selected — the Content Browser case', () => {
    expect(resolveTimelineRoot(scene(), null, matches)).toBe(2);
  });

  it('climbs from a node INSIDE the effect to the player, not the node', () => {
    expect(resolveTimelineRoot(scene(), 3, matches)).toBe(2);
  });

  it('keeps the selected player when several instances exist', () => {
    const two = [
      ...scene(),
      { id: 6, parent: 1, components: [{ type: 'TimelinePlayer', data: { timeline: REF } }] },
      { id: 7, parent: 6, components: [{ type: 'UIVisual', data: {} }] },
    ];
    expect(resolveTimelineRoot(two, 7, matches)).toBe(6);
    expect(resolveTimelineRoot(two, null, matches)).toBe(2); // document order
    expect(timelinePlayersFor(two, matches)).toEqual([2, 6]);
  });

  it('matches the path form as well as the uuid ref', () => {
    const byPath = scene().map((e) =>
      e.id === 2 ? { ...e, components: [{ type: 'TimelinePlayer', data: { timeline: PATH } }] } : e);
    expect(resolveTimelineRoot(byPath, null, matches)).toBe(2);
  });

  it('falls back to the raw selection — authoring a fresh clip onto a chosen entity', () => {
    const noPlayers = scene().filter((e) => e.id !== 2);
    expect(resolveTimelineRoot(noPlayers, 5, matches)).toBe(5);
  });

  it('answers null when there is nothing to preview against', () => {
    const noPlayers = scene().filter((e) => e.id !== 2);
    expect(resolveTimelineRoot(noPlayers, null, matches)).toBeNull();
    expect(timelinePlayersFor(noPlayers, matches)).toEqual([]);
  });

  it('ignores a player bound to a different timeline', () => {
    const other = scene().map((e) =>
      e.id === 2 ? { ...e, components: [{ type: 'TimelinePlayer', data: { timeline: '@uuid:other' } }] } : e);
    expect(resolveTimelineRoot(other, null, matches)).toBeNull();
  });
});
