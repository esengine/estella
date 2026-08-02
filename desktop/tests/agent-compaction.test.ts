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
import { compactHistory, createAnthropicProvider } from '../electron/agent/anthropic';
import { KEEP_WHOLE_RUNS, COMPACT_AT } from '../src/settings/agentIds';

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

  // The note a fold writes is NOT one of the turn starts, so the next fold
  // splices straight over it. Carrying the asks forward is what stops the
  // earliest request vanishing one compaction at a time — which is exactly what
  // a real gateway showed happening: fold one kept the passphrase, fold two ate it.
  it('keeps what was asked in EVERY fold, not just the last one', () => {
    const first = compactHistory(...Object.values(history(6)) as [Message[], number[]], 0, 2)!;
    expect(String(first.messages[0].content)).toContain('ask 0');

    const grown = {
      messages: [...first.messages, { role: 'user' as const, content: 'ask 6' }],
      turnStarts: [...first.turnStarts, first.messages.length],
    };
    const second = compactHistory(grown.messages, grown.turnStarts, first.dropped, 1, first.folded)!;

    const note = String(second.messages[0].content);
    expect(note).toContain('ask 0');   // from the first fold
    expect(note).toContain('ask 4');   // folded by the second
  });

  it('elides the oldest once the note would grow unbounded', () => {
    const many = Array.from({ length: 40 }, (_, i) => `${i}. old ask ${i}`);
    const out = compactHistory(...Object.values(history(5)) as [Message[], number[]], 0, 2, many)!;
    const note = String(out.messages[0].content);
    expect(note).toContain('earlier requests omitted');
    expect(note).not.toContain('old ask 0');
    expect(note).toContain('old ask 39');
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

/**
 * When the session decides to fold, and what it can then SAY about it — the
 * half a person sees. A conversation that quietly stopped remembering its
 * earliest runs, while the transcript on screen still showed them in full, is
 * the state this reporting exists to end.
 */
describe('a session deciding to compact', () => {
  /** A session of `runs` bulky runs against a deliberately small window. Reached
   *  through the private surface because step() past this point is the network,
   *  and the decision is made before that — the same trick the dialect suite
   *  uses for flushContext(). */
  const conversation = (runs: number, contextWindow = 4000) => {
    const session = createAnthropicProvider({ apiKey: 'k', contextWindow })
      .createSession({ system: 'be useful', tools: [] });
    for (let i = 0; i < runs; i++) {
      session.pushUser(`ask ${i}`);
      session.pushToolResults([{ id: `c${i}`, content: 'x'.repeat(4000), isError: false }]);
    }
    return session as unknown as {
      compactIfNeeded(): number;
      contextUsed(): number;
      lastInputTokens: number;
      turnIndex: number;
    };
  };

  it('says how many runs went, because nothing else can', () => {
    const session = conversation(6);
    expect(session.compactIfNeeded()).toBe(6 - KEEP_WHOLE_RUNS);
  });

  it('leaves a conversation inside its window alone, and reports nothing', () => {
    expect(conversation(6, 1_000_000).compactIfNeeded()).toBe(0);
  });

  // The coordinate the editor names runs by. Folding messages away must not
  // renumber the runs that are left — see the suite above.
  it('does not renumber what survives', () => {
    const session = conversation(6);
    expect(session.turnIndex).toBe(6);
    session.compactIfNeeded();
    expect(session.turnIndex).toBe(6);
  });

  // What the endpoint billed is the LARGER half of the reading on an honest
  // endpoint, and it describes the history that was just rewritten. Left in
  // place, the gauge would not move after a fold that emptied most of the
  // conversation, and the next step would fold again over a stale full reading.
  it('stops reporting the request it just threw away', () => {
    const session = conversation(12, 8000);
    session.lastInputTokens = 20_000;              // what the endpoint billed
    expect(session.contextUsed()).toBe(20_000);    // the larger half wins

    expect(session.compactIfNeeded()).toBe(12 - KEEP_WHOLE_RUNS);
    // It now reads what is actually there — back under the threshold that fired.
    expect(session.contextUsed()).toBeLessThan(8000 * COMPACT_AT);
  });
});
