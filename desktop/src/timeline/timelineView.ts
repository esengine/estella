// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineView.ts
 * @brief   Read projection for the Sequencer panel — derive a renderable
 *          entity→component→channel row tree (and keyframe times) from the flat
 *          TimelineAsset. The seed of TimelineQuery.
 *
 * The asset stores tracks flat (each carries childPath + component + channels);
 * the UI shows them as the design's nested tree (Player → Transform → 位置/…),
 * grouped by entity (childPath) then component, with each property channel a leaf
 * lane. Non-property tracks (spine/audio/activation/…) render as single rows.
 */

import {
  TrackType,
  type TimelineAsset,
  type Track,
  type PropertyTrack,
  type PropertyChannel,
  type InterpType,
} from 'esengine';

/** Addresses one animatable channel: entity (childPath) + component + property. */
export interface ChannelRef {
  childPath: string;
  component: string;
  property: string;
}

/** Stable string key for a channel (mute set / lookups). */
export function muteKey(ref: ChannelRef): string {
  return `${ref.childPath}|${ref.component}|${ref.property}`;
}

/** Resolve the property channel a {@link ChannelRef} points at (or null). */
export function findChannel(asset: TimelineAsset, ref: ChannelRef): PropertyChannel | null {
  for (const t of asset.tracks) {
    if (t.type === TrackType.Property && t.childPath === ref.childPath && t.component === ref.component) {
      const ch = t.channels.find((c) => c.property === ref.property);
      if (ch) return ch;
    }
  }
  return null;
}

const KEY_EPS = 1e-4;

/** Insert or replace a keyframe at `time` in a channel (keeps the array sorted). */
export function upsertKeyframe(ch: PropertyChannel, time: number, value: number, interp?: InterpType): void {
  const i = ch.keyframes.findIndex((k) => Math.abs(k.time - time) < KEY_EPS);
  const kf = { time, value, inTangent: 0, outTangent: 0, ...(interp ? { interpolation: interp } : {}) };
  if (i >= 0) ch.keyframes[i] = kf;
  else {
    ch.keyframes.push(kf);
    ch.keyframes.sort((a, b) => a.time - b.time);
  }
}

export type SeqRowKind = 'entity' | 'component' | 'channel' | 'track';

export interface SeqRow {
  /** Stable, unique row id (also the collapse/selection key). */
  id: string;
  kind: SeqRowKind;
  label: string;
  depth: number;
  /** Set on collapsible group rows (entity / component). */
  groupKey?: string;
  /** Ancestor groupKeys — the row hides when any ancestor is collapsed. */
  parentGroups: string[];
  /** Keyframe times (seconds) for lane rendering; empty for group rows. */
  keyframes: number[];
  trackType: string;
  /** Set on channel rows — the animatable target for keyframe edits. */
  ref?: ChannelRef;
}

// Inset the lane edges so frame 0 / the last frame aren't flush against the
// border (matches the design's PAD/SPAN mapping).
export const LANE_PAD = 1;
export const LANE_SPAN = 98;

/** Frames in the clip given the editor display rate (asset time is seconds). */
export function frameCount(asset: TimelineAsset, fps: number): number {
  return Math.max(1, Math.round(asset.duration * fps));
}

/** Map a time (seconds) to a left-offset percentage within the timeline. */
export function timeToPct(time: number, duration: number): number {
  if (duration <= 0) return LANE_PAD;
  return LANE_PAD + (time / duration) * LANE_SPAN;
}

/** Inverse of {@link timeToPct} — a left-offset percentage back to seconds. */
export function pctToTime(pct: number, duration: number): number {
  if (duration <= 0) return 0;
  return ((pct - LANE_PAD) / LANE_SPAN) * duration;
}

/** Representative keyframe/event times for a non-property track (for its lane). */
function trackEventTimes(track: Track): number[] {
  switch (track.type) {
    case TrackType.Spine:
      return track.clips.map((c) => c.start);
    case TrackType.Audio:
      return track.events.map((e) => e.time);
    case TrackType.Activation:
      return track.ranges.flatMap((r) => [r.start, r.end]);
    case TrackType.SpriteAnim:
      return [track.startTime];
    case TrackType.AnimFrames: {
      const times: number[] = [];
      let t = 0;
      for (const f of track.frames) {
        times.push(t);
        t += f.duration ?? 1 / 12;
      }
      return times;
    }
    default:
      return [];
  }
}

export function buildTimelineRows(asset: TimelineAsset | null): SeqRow[] {
  if (!asset) return [];

  const byEntity = new Map<string, Track[]>();
  for (const t of asset.tracks) {
    const key = t.childPath ?? '';
    const list = byEntity.get(key);
    if (list) list.push(t);
    else byEntity.set(key, [t]);
  }

  const rows: SeqRow[] = [];
  for (const [childPath, tracks] of byEntity) {
    const entityKey = `e:${childPath}`;
    rows.push({
      id: entityKey,
      kind: 'entity',
      label: childPath || '根实体',
      depth: 0,
      groupKey: entityKey,
      parentGroups: [],
      keyframes: [],
      trackType: 'entity',
    });

    // Property tracks: group by component, then a leaf per channel.
    const propTracks = tracks.filter((t): t is PropertyTrack => t.type === TrackType.Property);
    const byComponent = new Map<string, PropertyTrack[]>();
    for (const t of propTracks) {
      const list = byComponent.get(t.component);
      if (list) list.push(t);
      else byComponent.set(t.component, [t]);
    }
    for (const [component, compTracks] of byComponent) {
      const compKey = `${entityKey}/c:${component}`;
      rows.push({
        id: compKey,
        kind: 'component',
        label: component,
        depth: 1,
        groupKey: compKey,
        parentGroups: [entityKey],
        keyframes: [],
        trackType: 'component',
      });
      for (const track of compTracks) {
        for (const ch of track.channels) {
          rows.push({
            id: `${compKey}/${ch.property}`,
            kind: 'channel',
            label: ch.property,
            depth: 2,
            parentGroups: [entityKey, compKey],
            keyframes: ch.keyframes.map((k) => k.time),
            trackType: 'property',
            ref: { childPath, component, property: ch.property },
          });
        }
      }
    }

    // Non-property tracks (spine/audio/activation/spriteAnim/animFrames) → one row.
    for (const t of tracks) {
      if (t.type === TrackType.Property) continue;
      rows.push({
        id: `${entityKey}/t:${t.name}:${t.type}`,
        kind: 'track',
        label: t.name || t.type,
        depth: 1,
        parentGroups: [entityKey],
        keyframes: trackEventTimes(t),
        trackType: t.type,
      });
    }
  }

  return rows;
}

/** Filter out rows whose ancestor group is collapsed. */
export function visibleRows(rows: SeqRow[], collapsed: Set<string>): SeqRow[] {
  if (collapsed.size === 0) return rows;
  return rows.filter((r) => !r.parentGroups.some((g) => collapsed.has(g)));
}
