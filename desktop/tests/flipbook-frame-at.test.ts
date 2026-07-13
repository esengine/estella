// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import type { AnimClipAssetData } from 'esengine';
import { flipbookFrameAt } from '@/engine/FlipbookViewportPreview';

function clip(frames: AnimClipAssetData['frames'], fps = 10, loop = true): AnimClipAssetData {
  return { version: '1.2', type: 'animation-clip', fps, loop, frames };
}

describe('flipbookFrameAt', () => {
  it('walks fps-default frames (0.1s each at 10fps)', () => {
    const c = clip([{ cell: 0 }, { cell: 1 }, { cell: 2 }]);
    expect(flipbookFrameAt(c, 0)!.cell).toBe(0);
    expect(flipbookFrameAt(c, 0.15)!.cell).toBe(1);
    expect(flipbookFrameAt(c, 0.25)!.cell).toBe(2);
  });

  it('honors per-frame durations', () => {
    const c = clip([{ cell: 0, duration: 0.5 }, { cell: 1 }]);
    expect(flipbookFrameAt(c, 0.4)!.cell).toBe(0);
    expect(flipbookFrameAt(c, 0.55)!.cell).toBe(1);
  });

  it('loops when loop is on and clamps to the last frame when off', () => {
    const looping = clip([{ cell: 0 }, { cell: 1 }]);
    expect(flipbookFrameAt(looping, 0.25)!.cell).toBe(0); // wrapped past 0.2 total
    const once = clip([{ cell: 0 }, { cell: 1 }], 10, false);
    expect(flipbookFrameAt(once, 5)!.cell).toBe(1);
  });

  it('returns null for an empty clip', () => {
    expect(flipbookFrameAt(clip([]), 0)).toBeNull();
  });
});
