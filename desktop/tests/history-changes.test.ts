// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a recorded step SAYS it did.
 *
 *        The ops on an entry are opaque closures — they can undo an edit but
 *        cannot describe it — which is why "what changed since this mark" was
 *        previously unanswerable and the agent's change set could not be built.
 *        Declaring is optional, so the guarantee is a FLOOR: everything listed
 *        happened, not everything that happened is listed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorHistoryImpl } from '@/engine/EditorHistory';

describe('describing a step', () => {
  let history: EditorHistoryImpl;
  const noop = () => {};

  beforeEach(() => {
    history = new EditorHistoryImpl();
  });

  it('attaches what was declared to the step that follows it', () => {
    const mark = history.mark();
    history.describe({ kind: 'add', entity: 7, name: 'PauseRoot' });
    history.record('Add Entity', noop, noop);
    expect(history.changesSince(mark)).toEqual([{ kind: 'add', entity: 7, name: 'PauseRoot' }]);
  });

  it('leaves a step that declared nothing empty rather than guessing', () => {
    const mark = history.mark();
    history.record('Something', noop, noop);
    expect(history.changesSince(mark)).toEqual([]);
  });

  // Each step consumes its own declarations; otherwise one described edit would
  // colour every step recorded after it.
  it('does not carry declarations into the next step', () => {
    history.describe({ kind: 'add', entity: 1, name: 'A' });
    history.record('First', noop, noop);
    const mark = history.mark();
    history.record('Second', noop, noop);
    expect(history.changesSince(mark)).toEqual([]);
  });

  // A group is one undo step, so it is also one description — inner records do
  // not commit on their own and must not lose what they declared.
  it('gathers a group into the single step it becomes', () => {
    const mark = history.mark();
    history.group('Build a menu', () => {
      history.describe({ kind: 'add', entity: 1, name: 'Root' });
      history.record('a', noop, noop);
      history.describe({ kind: 'add', entity: 2, name: 'Panel' });
      history.record('b', noop, noop);
    });
    expect(history.changesSince(mark).map((c) => c.name)).toEqual(['Root', 'Panel']);
  });

  it('reports only what happened after the mark', () => {
    history.describe({ kind: 'add', entity: 1, name: 'Before' });
    history.record('before', noop, noop);
    const mark = history.mark();
    history.describe({ kind: 'add', entity: 2, name: 'After' });
    history.record('after', noop, noop);
    expect(history.changesSince(mark).map((c) => c.name)).toEqual(['After']);
  });

  // Undo puts the step back on the redo stack, so it is no longer something
  // that happened — a change set still listing it would be describing a scene
  // the user is not looking at.
  it('drops a step that has been undone', () => {
    const mark = history.mark();
    history.describe({ kind: 'add', entity: 1, name: 'Gone' });
    history.record('add', noop, noop);
    history.undo();
    expect(history.changesSince(mark)).toEqual([]);
  });
});
