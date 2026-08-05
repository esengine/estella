// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A `.esfsm` the editor cannot read opens empty, not fatal.
 *
 * From a dogfood run: an agent hand-wrote a state machine with the fields it
 * guessed at, opened it, and the panel died on `def.states.map` with "Cannot
 * read properties of undefined" — a message naming neither the file nor the
 * reason, in the one place the file could have been repaired from.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';

afterEach(() => FsmGraphDocument.close());

describe('opening a .esfsm', () => {
  it('keeps a well-formed machine exactly as it is', () => {
    const def = { initial: 'Idle', states: [{ name: 'Idle', transitions: [] }] };
    FsmGraphDocument.openJson(def, 'assets/ai.esfsm');
    expect(FsmGraphDocument.asset?.initial).toBe('Idle');
    expect(FsmGraphDocument.asset?.states).toHaveLength(1);
  });

  // The shape a person (or an agent) writes when guessing at the format.
  it('opens a foreign document as an empty machine', () => {
    FsmGraphDocument.openJson({ states: undefined, transitions: [], variables: {} }, 'assets/chess.esfsm');
    expect(FsmGraphDocument.asset?.states).toEqual([]);
    expect(FsmGraphDocument.asset?.initial).toBe('');
  });

  it('survives a file that holds nothing like an object', () => {
    for (const raw of [null, undefined, 42, 'a string', []]) {
      FsmGraphDocument.openJson(raw, 'assets/x.esfsm');
      expect(Array.isArray(FsmGraphDocument.asset?.states)).toBe(true);
    }
  });
});
