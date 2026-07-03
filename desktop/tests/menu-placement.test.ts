// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { submenuPlacement } from '@/components/menuPlacement';

const fly = { width: 180, height: 200 };
const row = (over: Partial<{ left: number; right: number; top: number }>) =>
  ({ left: 100, right: 240, top: 100, width: 140, height: 24, ...over });

describe('submenuPlacement (keeps flyouts inside the window)', () => {
  it('opens to the right when there is room', () => {
    const s = submenuPlacement(row({}), fly, 1200, 800);
    expect(s.left).toBe('100%');
    expect(s.right).toBeUndefined();
  });

  it('flips left when the right edge would overflow', () => {
    const s = submenuPlacement(row({ left: 1000, right: 1150 }), fly, 1200, 800);
    expect(s.right).toBe('100%');
    expect(s.left).toBeUndefined();
  });

  it('stays right when neither side fits (degrades, not flips into worse overflow)', () => {
    const s = submenuPlacement(row({ left: 50, right: 250 }), fly, 300, 800);
    expect(s.left).toBe('100%'); // left has no room (50 - 180 < pad), so keep right
  });

  it('shifts up when it would run past the bottom', () => {
    const s = submenuPlacement(row({ top: 700 }), fly, 1200, 800); // 700 + 200 = 900 > 792
    expect(s.top).toBe(-108);
  });

  it('no vertical shift when it fits', () => {
    expect(submenuPlacement(row({ top: 100 }), fly, 1200, 800).top).toBe(0);
  });
});
