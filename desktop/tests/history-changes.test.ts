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

  // A run's header reports what THAT run did. Without an upper bound an older
  // run keeps absorbing everything after it — the runs that followed, and the
  // edits the person made in between — so its count grows while it sits there
  // finished, which is the opposite of a summary.
  it('reports only the window between two marks', () => {
    const first = history.mark();
    history.describe({ kind: 'add', entity: 1, name: 'FromFirstRun' });
    history.record('first run', noop, noop);

    const second = history.mark();
    history.describe({ kind: 'add', entity: 2, name: 'FromSecondRun' });
    history.record('second run', noop, noop);

    expect(history.changesSince(first, second).map((c) => c.name)).toEqual(['FromFirstRun']);
    expect(history.changesSince(second, null).map((c) => c.name)).toEqual(['FromSecondRun']);
    // Unbounded is still "everything since" — what the newest run wants.
    expect(history.changesSince(first).map((c) => c.name))
      .toEqual(['FromFirstRun', 'FromSecondRun']);
  });

  it('excludes the user\'s own edits from the run that preceded them', () => {
    const run = history.mark();
    history.describe({ kind: 'add', entity: 1, name: 'ByTheAgent' });
    history.record('agent step', noop, noop);

    const after = history.mark();
    history.describe({ kind: 'modify', entity: 1, name: 'ByHand' });
    history.record('user edit', noop, noop);

    expect(history.changesSince(run, after).map((c) => c.name)).toEqual(['ByTheAgent']);
  });

  // The window is FOUND by binary search rather than scanned for, which is only
  // sound while ids stay ordered. These are the edges that search gets wrong if
  // it is wrong at all — and getting it wrong shows up as a change set quietly
  // missing its first or last step, not as a crash.
  describe('locating a run in a long stack', () => {
    const marks: ReturnType<EditorHistoryImpl['mark']>[] = [];

    beforeEach(() => {
      marks.length = 0;
      for (let i = 0; i < 50; i++) {
        marks.push(history.mark());
        history.describe({ kind: 'modify', entity: i, name: `step${i}` });
        history.record(`step ${i}`, noop, noop);
      }
    });

    it('takes the very first step and the very last', () => {
      expect(history.changesSince(marks[0]).map((c) => c.name)[0]).toBe('step0');
      expect(history.changesSince(marks[49]).map((c) => c.name)).toEqual(['step49']);
    });

    it('takes a window from the middle, both ends included exactly once', () => {
      expect(history.changesSince(marks[20], marks[23]).map((c) => c.name))
        .toEqual(['step20', 'step21', 'step22']);
    });

    it('reports nothing for a mark taken after the newest step', () => {
      expect(history.changesSince(history.mark())).toEqual([]);
    });

    it('counts the steps in a window the same way it lists them', () => {
      expect(history.stepsSince(marks[47])).toBe(3);
      expect(history.stepsSince(marks[0])).toBe(50);
      expect(history.stepsSince(history.mark())).toBe(0);
    });

    it('follows the stack back down as steps are undone', () => {
      history.undo();
      history.undo();
      expect(history.stepsSince(marks[47])).toBe(1);
      expect(history.changesSince(marks[47]).map((c) => c.name)).toEqual(['step47']);
    });
  });
});
