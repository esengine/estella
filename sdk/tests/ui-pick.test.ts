// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { uiHitTestWorld } from '../src/ui/uiPick';

const mod = (hit: number) =>
  ({ uiHitTest_update: vi.fn(), uiHitTest_getHitEntity: () => hit }) as any;

describe('uiHitTestWorld', () => {
  it('returns the hit entity', () => {
    const m = mod(42);
    expect(uiHitTestWorld(m, {} as any, 10, 20)).toBe(42);
    expect(m.uiHitTest_update).toHaveBeenCalledWith({}, 10, 20, false, false, false);
  });

  it('maps the no-hit sentinel to null', () => {
    expect(uiHitTestWorld(mod(0xffffffff), {} as any, 0, 0)).toBeNull();
  });

  it('passes mouse flags through (the input path)', () => {
    const m = mod(7);
    uiHitTestWorld(m, {} as any, 1, 2, true, true, false);
    expect(m.uiHitTest_update).toHaveBeenCalledWith({}, 1, 2, true, true, false);
  });
});
