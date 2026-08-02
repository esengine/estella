// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Folding the oldest runs away when a conversation outgrows its window.
 *
 *        Two things have to survive it: what the PERSON asked (intent governs
 *        the ninth run as much as the first), and the turn COORDINATES the rest
 *        of the system names runs by — those count from the start of the
 *        conversation, so they must outlive the messages they pointed at.
 */
import { describe, it, expect } from 'vitest';
import { compactHistory } from '../electron/agent/anthropic';

type Message = Parameters<typeof compactHistory>[0][number];

/** `runs` turns, each: the person's line, the model's reply, a tool result. */
function history(runs: number): { messages: Message[]; turnStarts: number[] } {
  const messages: Message[] = [];
  const turnStarts: number[] = [];
  for (let i = 0; i < runs; i++) {
    turnStarts.push(messages.length);
    messages.push({ role: 'user', content: `ask ${i}` });
    messages.push({ role: 'assistant', content: `reply ${i}` });
    messages.push({ role: 'user', content: `tool result ${i}` });
  }
  return { messages, turnStarts };
}

describe('compacting a long conversation', () => {
  it('leaves a short one alone', () => {
    const { messages, turnStarts } = history(3);
    expect(compactHistory(messages, turnStarts, 0, 3)).toBeNull();
    expect(compactHistory(messages, turnStarts, 0, 5)).toBeNull();
  });

  it('keeps the last runs whole and folds the rest into one note', () => {
    const { messages, turnStarts } = history(6);
    const out = compactHistory(messages, turnStarts, 0, 2)!;

    // Note + acknowledgement, then the last two runs verbatim (3 messages each).
    expect(out.messages).toHaveLength(2 + 6);
    expect(out.messages[0].role).toBe('user');
    expect(out.messages[2]).toEqual({ role: 'user', content: 'ask 4' });
    expect(out.messages.at(-1)).toEqual({ role: 'user', content: 'tool result 5' });
  });

  it('carries what was asked, and says the rest was dropped', () => {
    const { messages, turnStarts } = history(5);
    const note = String(compactHistory(messages, turnStarts, 0, 2)!.messages[0].content);

    for (const asked of ['ask 0', 'ask 1', 'ask 2']) expect(note).toContain(asked);
    // Told it is a summary, and told to re-read rather than trust it — a model
    // that believes this IS the state will edit from a scene it never saw.
    expect(note).toMatch(/dropped|read it back/i);
  });

  // The whole point of the bookkeeping: run 7 stays run 7 after its messages are
  // gone, or "re-ask this one" rewinds the session to the wrong place.
  it('keeps turn coordinates counting from the start of the conversation', () => {
    const { messages, turnStarts } = history(6);
    const out = compactHistory(messages, turnStarts, 0, 2)!;

    expect(out.dropped).toBe(4);
    // Next turn opens at 6 — the same number it would have without compaction.
    expect(out.dropped + out.turnStarts.length).toBe(6);
  });

  it('re-bases what is left so each start still points at that person\'s line', () => {
    const { messages, turnStarts } = history(6);
    const out = compactHistory(messages, turnStarts, 0, 2)!;

    expect(out.turnStarts.map((s) => out.messages[s])).toEqual([
      { role: 'user', content: 'ask 4' },
      { role: 'user', content: 'ask 5' },
    ]);
  });

  it('numbers the note from the runs already folded away, not from zero', () => {
    const { messages, turnStarts } = history(5);
    const out = compactHistory(messages, turnStarts, 10, 2)!;

    expect(String(out.messages[0].content)).toContain('11. ask 0');
    expect(out.dropped).toBe(13);
  });

  // Compacting twice is the ordinary case in a conversation long enough to need
  // it once — the second pass must fold the note itself away with the rest.
  it('can be applied again to its own output', () => {
    const first = compactHistory(...Object.values(history(6)) as [Message[], number[]], 0, 2)!;
    const grown = {
      messages: [...first.messages, { role: 'user' as const, content: 'ask 6' }],
      turnStarts: [...first.turnStarts, first.messages.length],
    };
    const second = compactHistory(grown.messages, grown.turnStarts, first.dropped, 1)!;

    expect(second.dropped).toBe(6);
    expect(second.turnStarts.map((s) => second.messages[s]))
      .toEqual([{ role: 'user', content: 'ask 6' }]);
  });
});
