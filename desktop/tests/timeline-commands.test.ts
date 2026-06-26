// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from 'esengine';
import { TimelineDocument } from '@/timeline/TimelineDocument';
import { TimelineCommands } from '@/timeline/TimelineCommands';
import { findChannel } from '@/timeline/timelineView';
import { EditorHistory } from '@/engine/EditorHistory';

const REF = { childPath: '', component: 'Transform', property: 'position.x' };

function freshAsset(): TimelineAsset {
  return {
    version: '1.1',
    type: 'timeline',
    duration: 2,
    wrapMode: WrapMode.Once,
    tracks: [
      {
        type: TrackType.Property,
        name: 'Move',
        childPath: '',
        component: 'Transform',
        channels: [
          {
            property: 'position.x',
            keyframes: [{ time: 0, value: 0, inTangent: 0, outTangent: 0 }],
          },
        ],
      },
    ],
  };
}

const keys = () => findChannel(TimelineDocument.asset!, REF)!.keyframes;

describe('TimelineCommands', () => {
  beforeEach(() => {
    EditorHistory.clear();
    TimelineDocument.open({ asset: freshAsset(), filePath: 'a.esanim', fps: 12 });
  });

  it('addKey inserts (sorted) and is undoable/redoable', () => {
    TimelineCommands.addKey(REF, 1, 50);
    expect(keys().map((k) => k.time)).toEqual([0, 1]);
    expect(keys()[1].value).toBe(50);

    EditorHistory.undo();
    expect(keys().map((k) => k.time)).toEqual([0]);

    EditorHistory.redo();
    expect(keys().map((k) => k.time)).toEqual([0, 1]);
  });

  it('moveKey changes time and re-sorts', () => {
    TimelineCommands.addKey(REF, 1.5, 10);
    TimelineCommands.moveKey(REF, 1.5, 0.5);
    expect(keys().map((k) => k.time)).toEqual([0, 0.5]);
  });

  it('setKeyInterp sets the interpolation mode', () => {
    TimelineCommands.addKey(REF, 1, 10);
    TimelineCommands.setKeyInterp(REF, 1, InterpType.Step);
    expect(keys().find((k) => k.time === 1)?.interpolation).toBe(InterpType.Step);
  });

  it('deleteKey removes the keyframe', () => {
    TimelineCommands.addKey(REF, 1, 10);
    TimelineCommands.deleteKey(REF, 1);
    expect(keys().map((k) => k.time)).toEqual([0]);
  });

  it('marks the document dirty on edit', () => {
    expect(TimelineDocument.meta.dirty).toBe(false);
    TimelineCommands.addKey(REF, 1, 10);
    expect(TimelineDocument.meta.dirty).toBe(true);
  });

  it('addTrack creates a new channel+track seeded with a key, and is undoable', () => {
    const NEW = { childPath: '', component: 'Sprite', property: 'color.a' };
    expect(findChannel(TimelineDocument.asset!, NEW)).toBeNull();

    TimelineCommands.addTrack(NEW, 0.5, 1);
    const ch = findChannel(TimelineDocument.asset!, NEW);
    expect(ch).not.toBeNull();
    expect(ch!.keyframes).toEqual([{ time: 1, value: 0.5, inTangent: 0, outTangent: 0 }]);

    EditorHistory.undo();
    expect(findChannel(TimelineDocument.asset!, NEW)).toBeNull();
  });

  it('addTrack is a no-op when the channel already exists', () => {
    const before = keys().length;
    TimelineCommands.addTrack(REF, 9, 1); // REF.position.x already tracked
    expect(keys().length).toBe(before);
  });

  it('removeChannel drops the channel and its now-empty track', () => {
    TimelineCommands.removeChannel(REF);
    expect(findChannel(TimelineDocument.asset!, REF)).toBeNull();
    expect(TimelineDocument.asset!.tracks.length).toBe(0); // the only channel was removed
  });

  it('editKey sets time and value together (curve 2D drag)', () => {
    TimelineCommands.addKey(REF, 1, 10);
    TimelineCommands.editKey(REF, 1, 1.5, 88);
    const k = keys().find((x) => Math.abs(x.time - 1.5) < 1e-4);
    expect(k?.value).toBe(88);
    expect(keys().some((x) => Math.abs(x.time - 1) < 1e-4)).toBe(false); // moved off 1
  });

  it('setKeyTangents writes in/out and reverts to Hermite', () => {
    TimelineCommands.addKey(REF, 1, 10);
    TimelineCommands.setKeyTangents(REF, 1, 2, -3);
    const k = keys().find((x) => x.time === 1)!;
    expect(k.inTangent).toBe(2);
    expect(k.outTangent).toBe(-3);
    expect(k.interpolation).toBeUndefined(); // Hermite default
  });
});
