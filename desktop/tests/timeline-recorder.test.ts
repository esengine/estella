import { describe, it, expect, beforeEach } from 'vitest';
import { WrapMode, TrackType, type TimelineAsset } from 'esengine';
import { TimelineDocument } from '@/timeline/TimelineDocument';
import { TimelineRecorder } from '@/timeline/TimelineRecorder';
import { findChannel } from '@/timeline/timelineView';
import { useSequencerStore } from '@/store/sequencerStore';
import { SceneCommands } from '@/engine/SceneCommands';
import { EditorHistory } from '@/engine/EditorHistory';

TimelineRecorder.attach(); // registers the SceneCommands edit hook once

const ROOT = 7 as const;

function assetWith(props: string[]): TimelineAsset {
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
        channels: props.map((property) => ({
          property,
          keyframes: [{ time: 0, value: 0, inTangent: 0, outTangent: 0 }],
        })),
      },
    ],
  };
}

const keysAt = (property: string) =>
  findChannel(TimelineDocument.asset!, { childPath: '', component: 'Transform', property })!.keyframes;

describe('TimelineRecorder (record auto-key)', () => {
  beforeEach(() => {
    EditorHistory.clear();
    useSequencerStore.getState().setPlaying(false);
    useSequencerStore.setState({ recording: false, snap: true });
    TimelineDocument.open({ asset: assetWith(['position.x', 'position.y']), filePath: 'a.esanim', fps: 12, rootEntity: ROOT });
    useSequencerStore.getState().setTime(1);
  });

  it('does nothing when not recording', () => {
    SceneCommands.setField(ROOT, 'Transform', 'position', 'vec3', [9, 9, 0]);
    expect(keysAt('position.x').map((k) => k.time)).toEqual([0]); // unchanged
  });

  it('keys mapped scalar channels at the playhead while recording', () => {
    useSequencerStore.setState({ recording: true });
    SceneCommands.setField(ROOT, 'Transform', 'position', 'vec3', [42, 24, 0]);
    // Flush the coalesced burst by toggling recording off.
    useSequencerStore.setState({ recording: false });

    const x = keysAt('position.x');
    const y = keysAt('position.y');
    expect(x.map((k) => k.time)).toEqual([0, 1]);
    expect(x.find((k) => k.time === 1)?.value).toBe(42);
    expect(y.find((k) => k.time === 1)?.value).toBe(24);
  });

  it('ignores edits to a non-bound entity', () => {
    useSequencerStore.setState({ recording: true });
    SceneCommands.setField(999 as typeof ROOT, 'Transform', 'position', 'vec3', [1, 2, 0]);
    useSequencerStore.setState({ recording: false });
    expect(keysAt('position.x').map((k) => k.time)).toEqual([0]); // unchanged
  });

  it('coalesces a burst into one undo step', () => {
    useSequencerStore.setState({ recording: true });
    SceneCommands.setField(ROOT, 'Transform', 'position', 'vec3', [10, 0, 0]);
    SceneCommands.setField(ROOT, 'Transform', 'position', 'vec3', [20, 0, 0]);
    SceneCommands.setField(ROOT, 'Transform', 'position', 'vec3', [30, 0, 0]);
    useSequencerStore.setState({ recording: false }); // flush → one commit

    expect(keysAt('position.x').find((k) => k.time === 1)?.value).toBe(30);
    EditorHistory.undo();
    expect(keysAt('position.x').map((k) => k.time)).toEqual([0]); // single undo reverts the whole burst
  });
});
