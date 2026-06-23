// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseAnimationClip } from '../src/timeline/AnimationClip';
import { WrapMode, TrackType } from '../src/timeline/TimelineTypes';

describe('parseAnimationClip (unified .esanim loader)', () => {
  it('passes a rich multi-track clip straight through', () => {
    const clip = parseAnimationClip({
      version: '1.1', type: 'timeline', duration: 3, wrapMode: 'loop',
      tracks: [{ type: 'property', name: 'M', childPath: '', component: 'Transform', channels: [] }],
    });
    expect(clip.duration).toBe(3);
    expect(clip.wrapMode).toBe(WrapMode.Loop);
    expect(clip.tracks).toHaveLength(1);
    expect(clip.tracks[0].type).toBe(TrackType.Property);
  });

  it('converts a legacy flipbook AnimClip into one sprite-frame track', () => {
    const clip = parseAnimationClip({
      version: '1', type: 'animation-clip', fps: 10, loop: true,
      frames: [{ texture: 'a' }, { texture: 'b' }, { texture: 'c' }],
    });
    expect(clip.tracks).toHaveLength(1);
    const t = clip.tracks[0];
    expect(t.type).toBe(TrackType.AnimFrames);
    if (t.type === TrackType.AnimFrames) {
      expect(t.frames.map((f) => f.texture)).toEqual(['a', 'b', 'c']);
    }
    expect(clip.duration).toBeCloseTo(0.3, 5); // 3 frames @ 10fps
    expect(clip.wrapMode).toBe(WrapMode.Loop);
  });

  it('honors loop:false as Once', () => {
    const clip = parseAnimationClip({ type: 'animation-clip', fps: 12, loop: false, frames: [{ texture: 'a' }] });
    expect(clip.wrapMode).toBe(WrapMode.Once);
  });
});
