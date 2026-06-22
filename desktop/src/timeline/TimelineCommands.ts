/**
 * @file    TimelineCommands.ts
 * @brief   Undoable edits to the open timeline document (docs/REARCH_ANIMATION.md P2).
 *
 * Mirrors the scene's SceneCommands: a command mutates the document's asset and
 * registers one undo step on the shared {@link EditorHistory} (so timeline edits
 * sit on the same undo stack as scene edits). Each command snapshots the whole
 * asset before/after — timelines are small JSON, so whole-asset snapshots are the
 * simplest correct undo unit (no per-keyframe inverse bookkeeping), and they make
 * the preview self-consistent through undo/redo (TimelinePreview re-syncs on the
 * document bump).
 */

import {
  TrackType,
  serializeTimelineToJson,
  type TimelineAsset,
  type InterpType,
  type WrapMode,
  type PropertyChannel,
  type PropertyTrack,
} from 'esengine';
import { TimelineDocument } from './TimelineDocument';
import { findChannel, upsertKeyframe, type ChannelRef } from './timelineView';
import { Toasts } from '@/store/Toasts';

export type { ChannelRef };

// Keyframes equal within this many seconds are treated as the same key.
const EPS = 1e-4;

function sortKeys(ch: PropertyChannel): void {
  ch.keyframes.sort((a, b) => a.time - b.time);
}

// Commands mutate the open document via `TimelineDocument.edit` — the shared
// AssetDocument snapshot-undo helper (one EditorHistory step per command).
class TimelineCommandsImpl {
  addKey(ref: ChannelRef, time: number, value: number, interp?: InterpType): void {
    TimelineDocument.edit('Add Keyframe', (a) => {
      const ch = findChannel(a, ref);
      if (ch) upsertKeyframe(ch, time, value, interp);
    });
  }

  /**
   * Add an animatable channel (creating its property track if needed) and seed it
   * with one keyframe at `time` holding `valueAtTime` — so a new track is animated,
   * not empty. No-op if the channel already exists.
   */
  addTrack(ref: ChannelRef, valueAtTime: number, time: number): void {
    if (findChannel(TimelineDocument.asset ?? ({} as TimelineAsset), ref)) return;
    TimelineDocument.edit('Add Track', (a) => {
      let track = a.tracks.find(
        (t): t is PropertyTrack =>
          t.type === TrackType.Property && t.childPath === ref.childPath && t.component === ref.component,
      );
      if (!track) {
        track = { type: TrackType.Property, name: ref.component, childPath: ref.childPath, component: ref.component, channels: [] };
        a.tracks.push(track);
      }
      let ch = track.channels.find((c) => c.property === ref.property);
      if (!ch) {
        ch = { property: ref.property, keyframes: [] };
        track.channels.push(ch);
      }
      upsertKeyframe(ch, time, valueAtTime);
    });
  }

  /** Remove an animatable channel; drop its property track when it goes empty. */
  removeChannel(ref: ChannelRef): void {
    TimelineDocument.edit('Remove Track', (a) => {
      for (let ti = a.tracks.length - 1; ti >= 0; ti--) {
        const t = a.tracks[ti];
        if (t.type !== TrackType.Property || t.childPath !== ref.childPath || t.component !== ref.component) continue;
        t.channels = t.channels.filter((c) => c.property !== ref.property);
        if (t.channels.length === 0) a.tracks.splice(ti, 1);
      }
    });
  }

  deleteKey(ref: ChannelRef, time: number): void {
    TimelineDocument.edit('Delete Keyframe', (a) => {
      const ch = findChannel(a, ref);
      if (!ch) return;
      const i = ch.keyframes.findIndex((k) => Math.abs(k.time - time) < EPS);
      if (i >= 0) ch.keyframes.splice(i, 1);
    });
  }

  setKeyValue(ref: ChannelRef, time: number, value: number): void {
    TimelineDocument.edit('Edit Keyframe', (a) => {
      const k = findChannel(a, ref)?.keyframes.find((x) => Math.abs(x.time - time) < EPS);
      if (k) k.value = value;
    });
  }

  setKeyInterp(ref: ChannelRef, time: number, interp: InterpType): void {
    TimelineDocument.edit('Set Interpolation', (a) => {
      const k = findChannel(a, ref)?.keyframes.find((x) => Math.abs(x.time - time) < EPS);
      if (k) k.interpolation = interp;
    });
  }

  /** Move a key in time AND set its value in one step (curve-view 2D drag). */
  editKey(ref: ChannelRef, fromTime: number, toTime: number, value: number): void {
    TimelineDocument.edit('Edit Keyframe', (a) => {
      const ch = findChannel(a, ref);
      const k = ch?.keyframes.find((x) => Math.abs(x.time - fromTime) < EPS);
      if (!ch || !k) return;
      if (Math.abs(toTime - fromTime) >= EPS) {
        const dup = ch.keyframes.findIndex((x) => x !== k && Math.abs(x.time - toTime) < EPS);
        if (dup >= 0) ch.keyframes.splice(dup, 1);
        k.time = toTime;
      }
      k.value = value;
      sortKeys(ch);
    });
  }

  /** Set a key's in/out tangents (and switch it to Hermite) — curve handle drag. */
  setKeyTangents(ref: ChannelRef, time: number, inTangent: number, outTangent: number): void {
    TimelineDocument.edit('Edit Tangents', (a) => {
      const k = findChannel(a, ref)?.keyframes.find((x) => Math.abs(x.time - time) < EPS);
      if (!k) return;
      k.inTangent = inTangent;
      k.outTangent = outTangent;
      k.interpolation = undefined; // Hermite is the default (uses tangents)
    });
  }

  /** Move a keyframe in time (drag). A key already at `toTime` is overwritten. */
  moveKey(ref: ChannelRef, fromTime: number, toTime: number): void {
    if (Math.abs(fromTime - toTime) < EPS) return;
    TimelineDocument.edit('Move Keyframe', (a) => {
      const ch = findChannel(a, ref);
      if (!ch) return;
      const k = ch.keyframes.find((x) => Math.abs(x.time - fromTime) < EPS);
      if (!k) return;
      const dup = ch.keyframes.findIndex((x) => x !== k && Math.abs(x.time - toTime) < EPS);
      if (dup >= 0) ch.keyframes.splice(dup, 1);
      k.time = toTime;
      sortKeys(ch);
    });
  }

  setDuration(seconds: number): void {
    TimelineDocument.edit('Set Duration', (a) => {
      a.duration = Math.max(0, seconds);
    });
  }

  setWrapMode(mode: WrapMode): void {
    TimelineDocument.edit('Set Wrap Mode', (a) => {
      a.wrapMode = mode;
    });
  }

  /** Write the document back to its .esanim file. */
  async save(): Promise<void> {
    const asset = TimelineDocument.asset;
    const { filePath } = TimelineDocument.meta;
    if (!asset) return;
    if (!filePath) {
      Toasts.push('动画未关联文件（示例片段无法保存）', 'error');
      return;
    }
    try {
      await window.estella.fs.write(filePath, serializeTimelineToJson(asset) + '\n');
      TimelineDocument.markSaved();
      Toasts.push('动画已保存', 'success', 1500);
    } catch (e) {
      Toasts.push(`保存失败：${String(e)}`, 'error');
    }
  }
}

export const TimelineCommands = new TimelineCommandsImpl();
