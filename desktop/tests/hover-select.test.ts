// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The move gate behind picker hover-selection. A palette opens under
 *        wherever the cursor rests, so "the pointer is over this row" must not
 *        be mistaken for "the user pointed at this row" — Enter runs the active
 *        row, and Close Project is one of them.
 */
import { describe, it, expect } from 'vitest';
import { makeMoveGate } from '@/components/hoverSelect';

describe('makeMoveGate', () => {
  it('refuses the first position — a picker opening under a still cursor', () => {
    const moved = makeMoveGate();
    expect(moved(400, 300)).toBe(false);
  });

  it('refuses repeats at the resting position (scroll-driven boundary events)', () => {
    const moved = makeMoveGate();
    moved(400, 300);
    expect(moved(400, 300)).toBe(false);
    expect(moved(400, 300)).toBe(false);
  });

  it('passes a real move, on either axis', () => {
    const moved = makeMoveGate();
    moved(400, 300);
    expect(moved(401, 300)).toBe(true);
    expect(moved(401, 301)).toBe(true);
  });

  it('keeps refusing once the pointer settles again', () => {
    const moved = makeMoveGate();
    moved(400, 300);
    expect(moved(420, 340)).toBe(true);
    expect(moved(420, 340)).toBe(false);
  });

  it('gates each picker independently', () => {
    const a = makeMoveGate();
    const b = makeMoveGate();
    a(10, 10);
    expect(a(11, 10)).toBe(true);
    expect(b(11, 10)).toBe(false);
  });
});
