// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineRecorder.ts
 * @brief   Record mode — auto-key inspector/gizmo edits into the open clip.
 *
 * Registers a generic edit hook on SceneCommands (the single field-edit door): when
 * recording is on and the edited entity is the clip's bound preview root, it drops
 * a keyframe at the playhead on every EXISTING channel the edited field maps to
 * (vec fields fan out to their scalar channels, e.g. position → position.x/y/z).
 *
 * Observe-only: the hook returns false, so the edit still lands on the scene as
 * usual and the viewport stays consistent (TimelinePreview re-samples the timeline,
 * which now holds the keyed value). Rapid edits (a drag) are coalesced into ONE
 * undo step via a short settle timer, so dragging doesn't flood the undo stack.
 *
 * Known P2 limitation: it keys only channels whose track already exists, and the
 * edit also moves the entity's scene base value (true non-destructive record —
 * suppress the scene write + read the inspector live — is a P3 upgrade the hook's
 * boolean return already supports).
 */

import { TrackType, type TimelineAsset } from 'esengine';
import { TimelineDocument } from './TimelineDocument';
import { upsertKeyframe } from './timelineView';
import { useSequencerStore } from '@/store/sequencerStore';
import { SceneCommands } from '@/engine/SceneCommands';
import { EditorHistory } from '@/engine/EditorHistory';
import type { EntityId, InspectorFieldType, InspectorFieldValue } from '@/types';

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

// Vector/color sub-field suffix → component index (value arrays are [x,y,z,w] /
// [r,g,b,a]; the channel property is e.g. "position.x").
const SUB_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };

/** Extract the scalar a channel `property` wants from an edited field's value. */
function scalarFor(value: InspectorFieldValue, property: string, key: string): number | null {
  if (property === key) return typeof value === 'number' ? value : null;
  const suffix = property.slice(key.length + 1);
  const i = SUB_INDEX[suffix];
  if (i == null) return null;
  if (Array.isArray(value)) return typeof value[i] === 'number' ? (value[i] as number) : null;
  if (value && typeof value === 'object') {
    const v = (value as unknown as Record<string, unknown>)[suffix];
    return typeof v === 'number' ? v : null;
  }
  return null;
}

class TimelineRecorderImpl {
  private attached = false;
  private burstBefore: TimelineAsset | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    SceneCommands.setEditHook((sourceId, compName, key, type, value) =>
      this.onEdit(sourceId, compName, key, type, value),
    );
    // Flush the pending burst the moment recording is switched off.
    useSequencerStore.subscribe(() => {
      if (!useSequencerStore.getState().recording && this.timer != null) this.flush();
    });
  }

  private onEdit(
    sourceId: EntityId,
    compName: string,
    key: string,
    _type: InspectorFieldType,
    value: InspectorFieldValue,
  ): boolean {
    const seq = useSequencerStore.getState();
    const asset = TimelineDocument.asset;
    const root = TimelineDocument.rootEntity;
    if (!seq.recording || !asset || root == null || sourceId !== root) return false;

    const fps = TimelineDocument.meta.fps;
    const time = seq.snap && fps > 0 ? Math.round(seq.time * fps) / fps : seq.time;

    const draft = clone(asset);
    let keyed = 0;
    for (const track of draft.tracks) {
      if (track.type !== TrackType.Property || track.childPath !== '' || track.component !== compName) continue;
      for (const ch of track.channels) {
        if (ch.property !== key && !ch.property.startsWith(`${key}.`)) continue;
        const scalar = scalarFor(value, ch.property, key);
        if (scalar == null) continue;
        upsertKeyframe(ch, time, scalar);
        keyed++;
      }
    }
    if (keyed === 0) return false;

    if (!this.burstBefore) this.burstBefore = clone(asset); // pre-burst state for one undo
    TimelineDocument.replaceAsset(draft); // live (preview re-samples); undo recorded on settle
    this.scheduleCommit();
    return false; // observe-only — the scene edit still applies
  }

  private scheduleCommit(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), 200);
  }

  private flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.commit();
  }

  /** Record the whole burst (pre-burst → now) as one undo step. */
  private commit(): void {
    this.timer = null;
    const before = this.burstBefore;
    this.burstBefore = null;
    const after = TimelineDocument.asset;
    if (!before || !after) return;
    EditorHistory.record(
      'Record Keyframes',
      () => TimelineDocument.replaceAsset(after),
      () => TimelineDocument.replaceAsset(before),
    );
  }
}

export const TimelineRecorder = new TimelineRecorderImpl();
