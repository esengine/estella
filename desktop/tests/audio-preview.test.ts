// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Content Browser audio preview — one clip at a time, toggle to stop,
 *        switching clips stops the previous. DOM <audio> mocked via the factory.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { toggleAudioPreview, stopAudioPreview, previewingPath, _setAudioFactory } from '@/project/audioPreview';

function fakeAudio() {
  const calls: string[] = [];
  _setAudioFactory((url) => ({
    play: () => {
      calls.push(`play:${url}`);
      return Promise.resolve();
    },
    pause: () => calls.push(`pause:${url}`),
    currentTime: 0,
    onended: null,
  }));
  return calls;
}

describe('audio preview', () => {
  beforeEach(() => stopAudioPreview());

  it('plays a clip over the estella:// transport and tracks it', () => {
    const calls = fakeAudio();
    toggleAudioPreview('sfx/jump.wav');
    expect(previewingPath()).toBe('sfx/jump.wav');
    expect(calls).toContain('play:estella://project/sfx/jump.wav');
  });

  it('re-triggering the playing clip stops it (toggle)', () => {
    fakeAudio();
    toggleAudioPreview('a.wav');
    toggleAudioPreview('a.wav');
    expect(previewingPath()).toBeNull();
  });

  it('switching to another clip stops the previous one', () => {
    const calls = fakeAudio();
    toggleAudioPreview('a.wav');
    toggleAudioPreview('b.wav');
    expect(previewingPath()).toBe('b.wav');
    expect(calls).toContain('pause:estella://project/a.wav');
    expect(calls).toContain('play:estella://project/b.wav');
  });
});
