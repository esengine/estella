// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which outliner rows the agent touched JUST NOW. The dot is a standing
 *        fact and cannot also say "a second ago", so arrival is its own signal —
 *        and arrival means ADDITIONS, never the set emptying.
 */
import { describe, it, expect } from 'vitest';
import { newlyAdded } from '../src/outliner/agentFresh';

const set = (...ids: number[]): ReadonlySet<number> => new Set(ids);

describe('newlyAdded', () => {
  it('reports what joined', () => {
    expect(newlyAdded(set(1, 2), set(1, 2, 7)).sort()).toEqual([7]);
  });

  it('says nothing when the set did not grow', () => {
    expect(newlyAdded(set(1, 2), set(1, 2))).toEqual([]);
  });

  it('ignores what LEFT — acknowledging a checkpoint clears every dot at once, and flashing the whole tree on the click meant to calm it is backwards', () => {
    expect(newlyAdded(set(1, 2, 3), set(2))).toEqual([]);
  });

  it('reports additions even when others left in the same change', () => {
    expect(newlyAdded(set(1, 2), set(2, 9)).sort()).toEqual([9]);
  });

  it('treats everything as new against an empty start', () => {
    expect(newlyAdded(set(), set(4, 5)).sort()).toEqual([4, 5]);
  });
});
