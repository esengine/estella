// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One target screen, obeyed by both the edit viewport and the running game.
 *
 * The device selection used to shape only the authoring overlay: a game played in
 * the viewport or the Game panel filled whatever the dock had been dragged to, so
 * a project authored for a phone was never actually RUN at a phone's shape. These
 * pin the sizing rule the play hosts apply.
 */
import { describe, it, expect } from 'vitest';
import { playHostAspectStyle, targetScreenLabel } from '@/mode/TargetScreen';
import { deviceDims } from '@/mode/resolutionPresets';

describe('play host sizing', () => {
  it('leaves the host unconstrained for the `design` sentinel', () => {
    // No simulated device means "fill the panel" — the behaviour someone
    // authoring for desktop expects, and what every view did before.
    expect(playHostAspectStyle('design', 'landscape')).toBeNull();
    expect(playHostAspectStyle('design', 'portrait')).toBeNull();
    expect(targetScreenLabel('design', 'landscape')).toBeNull();
  });

  it('constrains the host to the device aspect, orientation applied', () => {
    const portrait = playHostAspectStyle('iphone', 'portrait');
    const landscape = playHostAspectStyle('iphone', 'landscape');

    expect(portrait?.aspectRatio).toBe('1170 / 2532');
    expect(landscape?.aspectRatio).toBe('2532 / 1170');
    // Fits INSIDE the panel either way rather than overflowing it.
    expect(portrait?.maxWidth).toBe('100%');
    expect(portrait?.maxHeight).toBe('100%');
  });

  it('reports the simulated pixel size the aspect came from', () => {
    expect(targetScreenLabel('iphone', 'portrait')).toBe('1170 × 2532');
    expect(targetScreenLabel('ipad', 'landscape')).toBe('2360 × 1640');
    expect(targetScreenLabel('720p', 'portrait')).toBe('720 × 1280');
  });

  it('agrees with the dims the authoring overlay draws from', () => {
    // The frame the edit viewport draws and the box the game runs in must come
    // from one source, or the preview stops predicting the run.
    for (const device of ['iphone', 'ipad', '1080p', '720p'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const d = deviceDims(device, orientation)!;
        expect(playHostAspectStyle(device, orientation)?.aspectRatio).toBe(`${d.w} / ${d.h}`);
      }
    }
  });
});
