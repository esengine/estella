// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The main-side owner of the agent conversation: what it refuses, what it
 *        pushes to the window, and the two invariants the editor's mirror is
 *        built on — every accepted send ends in exactly one turn_end, and every
 *        confirmation is eventually answered.
 *
 *        Pure TS: a fake provider, a fake driver, no Electron and no network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAgentHost,
  type AgentHost, type AgentMessage, type AgentStatus, type PersistedConversation,
} from '../electron/agent/host';
import type { AgentProvider, AgentSession, StepEvent, ToolCall } from '../electron/agent/types';

const call = (name: string): ToolCall => ({ id: `c-${name}`, name, input: {} });
const asks = (...calls: ToolCall[]): StepEvent[] =>
  [...calls.map((c) => ({ type: 'tool_call' as const, call: c })), { type: 'stop' as const, reason: 'tool_use' as const }];
const ends = (): StepEvent[] => [{ type: 'stop', reason: 'end_turn' }];

/** A provider that replays scripted steps and counts how often it was built. */
function fakeProvider(steps: StepEvent[][]): AgentProvider & { session: AgentSession & { asked: string[]; rewinds: number[] } } {
  let at = 0;
  const session: AgentSession & { asked: string[]; rewinds: number[] } = {
    asked: [] as string[],
    rewinds: [],
    // The real one counts person's turns; asking is what opens them.
    get turnIndex() { return session.asked.length; },
    pushUser: (t) => { session.asked.push(t); },
    pushContext: () => {},
    pushToolResults: () => {},
    // Faithful about the coordinate too: rewinding drops those turns, so the
    // next one reopens at n — which is what the host stamps onto turn_start.
    rewindTo: (n) => { session.rewinds.push(n); session.asked.length = n; },
    serialize: () => ({ asked: [...session.asked] }),
    step: async function* () {
      for (const ev of steps[at] ?? [{ type: 'stop', reason: 'end_turn' }]) yield ev;
      at++;
    },
  };
  return {
    id: 'fake', model: 'fake-model', acceptsImages: true, session,
    createSession: (_opts, memory) => {
      // Faithful to the real one: a resumed memory replaces what the session
      // remembers, so the turns it has already had are its own again.
      const m = memory as { asked?: string[] } | undefined;
      if (m?.asked) session.asked = [...m.asked];
      return session;
    },
  };
}

describe('the agent host', () => {
  let messages: AgentMessage[];
  let built: number;
  let keyed: boolean;
  let markFails: string | null;
  let driver: ReturnType<typeof vi.fn> & { js: unknown; op: unknown };

  /** The turn is over when the host says so — turn_end is emitted a microtask
   *  earlier, from inside the kernel, before the host has settled anything. */
  const settled = (h: AgentHost): Promise<void> =>
    vi.waitFor(() => expect(h.status().phase).toBe('idle'));

  let provider: ReturnType<typeof fakeProvider> | null = null;
  const host = (steps: StepEvent[][] = [ends()]): AgentHost => createAgentHost({
    driver: driver as never,
    push: (m) => messages.push(m),
    ready: () => keyed,
    provider: () => {
      built++;
      if (!keyed) throw new Error('No API key is configured. Add one in Settings › AI Agents.');
      provider = fakeProvider(steps);
      return provider;
    },
  });

  const events = () => messages.flatMap((m) => (m.kind === 'event' ? [m.event] : []));
  const statuses = (): AgentStatus[] => messages.flatMap((m) => (m.kind === 'status' ? [m.status] : []));
  const kinds = () => events().map((e) => e.type);

  beforeEach(() => {
    messages = [];
    built = 0;
    keyed = true;
    markFails = null;
    provider = null;
    driver = vi.fn(async (method: string) => {
      if (method === 'mark') {
        if (markFails) throw new Error(markFails);
        return { seq: 1 };
      }
      if (method === 'stepsSince') return 2;
      if (method === 'getDiagnostics') return [];
      if (method === 'getSelectionIds') return [];
      return null;
    }) as never;
    (driver as { js: unknown }).js = vi.fn(async () => null);
    (driver as { op: unknown }).op = vi.fn(async () => null);
  });

  it('refuses without a credential, and names where to fix it', async () => {
    keyed = false;
    const h = host();
    const status = h.send('build me a menu');
    expect(status.error).toContain('Settings');
    expect(status.phase).toBe('idle');
    expect(kinds()).not.toContain('turn_start');
  });

  it('runs a turn and comes back to idle', async () => {
    const h = host();
    expect(h.send('hi').phase).toBe('running');
    await settled(h);
    expect(kinds()).toEqual(['turn_start', 'stop', 'turn_end']);
    expect(h.status().model).toBe('fake-model');
  });

  // The conversation is the point of a session: a follow-up that built a second
  // one would drop everything said so far and re-bill the whole prefix.
  it('keeps one session across follow-ups, and drops it on reset', async () => {
    const h = host([ends(), ends()]);
    h.send('first');
    await settled(h);
    h.send('second');
    await settled(h);
    expect(built).toBe(1);
    expect(h.status().conversation).toBe(true);

    expect(h.reset().conversation).toBe(false);
    h.send('third');
    await settled(h);
    expect(built).toBe(2); // re-reads the key, so a changed one takes effect
  });

  it('takes one message at a time', async () => {
    const h = host();
    h.send('first');
    const second = h.send('second');
    expect(second.error).toContain('still working');
    await settled(h);
    expect(kinds().filter((k) => k === 'turn_start')).toHaveLength(1);
  });

  // runTurn takes its checkpoint BEFORE its own try block, so it can reject
  // without ever starting. A window left on "running" by that has no way back.
  it('ends the turn even when it never started', async () => {
    markFails = 'no editor window';
    const h = host();
    h.send('hi');
    await settled(h);
    expect(events().filter((e) => e.type === 'turn_end')).toHaveLength(1);
    expect(events().at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
    expect(h.status()).toMatchObject({ phase: 'idle', error: 'no editor window' });
  });

  describe('a tool that has to be confirmed', () => {
    it('parks the conversation until the person answers', async () => {
      const h = host([asks(call('save_scene')), ends()]);
      h.send('save it');
      await vi.waitFor(() => expect(h.status().phase).toBe('awaiting_confirm'));
      expect(statuses().at(-1)?.phase).toBe('awaiting_confirm');

      h.confirm('c-save_scene', 'once');
      await settled(h);
      expect(events().some((e) => e.type === 'tool_end' && e.ok)).toBe(true);
    });

    it('tells the model a decline is an answer, not a failure to retry', async () => {
      const h = host([asks(call('save_scene')), ends()]);
      h.send('save it');
      await vi.waitFor(() => expect(h.status().phase).toBe('awaiting_confirm'));
      h.confirm('c-save_scene', 'no');
      await settled(h);
      expect(events().some((e) => e.type === 'tool_end' && e.summary === 'declined')).toBe(true);
    });

    // Aborting does not interrupt a promise that is waiting on the USER; the
    // kernel would sit there forever, and the turn would never end.
    it('is answered by Stop rather than left hanging', async () => {
      const h = host([asks(call('save_scene')), ends()]);
      h.send('save it');
      await vi.waitFor(() => expect(h.status().phase).toBe('awaiting_confirm'));
      h.stop();
      await settled(h);
      expect(events().at(-1)).toMatchObject({ type: 'turn_end' });
    });

    it('is answered by a reset too', async () => {
      const h = host([asks(call('save_scene')), ends()]);
      h.send('save it');
      await vi.waitFor(() => expect(h.status().phase).toBe('awaiting_confirm'));
      h.reset();
      await vi.waitFor(() => expect(events().at(-1)).toMatchObject({ type: 'turn_end' }));
      expect(h.status().phase).toBe('idle');
    });

    it('ignores an answer to a call nobody is waiting on', async () => {
      const h = host();
      expect(() => h.confirm('c-gone', 'once')).not.toThrow();
    });
  });

  // The mirror renders from these, so a state it never hears about is one the
  // window shows wrong until something else happens to push.
  it('pushes a status on every transition', async () => {
    const h = host();
    h.send('hi');
    await settled(h);
    expect(statuses().map((s) => s.phase)).toEqual(['running', 'idle']);
  });

  // A bad answer three turns in should cost you that answer, not the whole
  // conversation that led to it.
  it('rewinds the session to the turn being asked again', async () => {
    const h = host([ends(), ends(), ends()]);
    h.send('first');
    await settled(h);
    h.send('second');
    await settled(h);

    h.retry(1, 'second, but better');
    await settled(h);
    expect(provider!.session.rewinds).toEqual([1]);
    expect(provider!.session.asked.at(-1)).toBe('second, but better');
  });

  it('has nothing to rewind before the first message', async () => {
    const h = host();
    h.retry(0, 'hello');
    await settled(h);
    expect(provider!.session.rewinds).toEqual([]);
    expect(provider!.session.asked).toEqual(['hello']);
  });

  // The conversation outlives the window: main holds the session, so a reloaded
  // renderer has to be able to rebuild what it was never there for.
  describe('the replayable transcript', () => {
    const startsIn = (h: AgentHost): number[] =>
      h.transcript().filter((e) => e.type === 'turn_start').map((e) => (e as { index: number }).index);

    it('keeps the conversation as a stream a new window can fold', async () => {
      const h = host([ends(), ends()]);
      h.send('first');
      await settled(h);
      h.send('second');
      await settled(h);

      expect(startsIn(h)).toEqual([0, 1]);
      // Same events, same order as were pushed live — the replay IS the record.
      expect(h.transcript().map((e) => e.type))
        .toEqual(messages.filter((m) => m.kind === 'event').map((m) => (m as { event: { type: string } }).event.type));
    });

    it('names each run with the session\'s own coordinate', async () => {
      const h = host([ends(), ends(), ends()]);
      h.send('first');
      await settled(h);
      h.send('second');
      await settled(h);
      h.send('third');
      await settled(h);
      expect(startsIn(h)).toEqual([0, 1, 2]);
    });

    // A re-ask discards that run and everything after it. Replaying afterwards
    // must not hand a window back the runs the session has already forgotten.
    it('drops the re-asked run and everything after it', async () => {
      const h = host([ends(), ends(), ends(), ends()]);
      h.send('first');
      await settled(h);
      h.send('second');
      await settled(h);
      h.send('third');
      await settled(h);

      h.retry(1, 'second, but better');
      await settled(h);
      expect(startsIn(h)).toEqual([0, 1]);
    });

    it('forgets everything when the conversation is dropped', async () => {
      const h = host([ends()]);
      h.send('first');
      await settled(h);
      expect(h.transcript().length).toBeGreaterThan(0);
      h.reset();
      expect(h.transcript()).toEqual([]);
    });
  });
});

/**
 * Keeping a conversation, and putting it back.
 *
 * The host owns both halves — the event stream the window draws from and the
 * memory the model needs — so it is the only place that can be asked whether
 * they stay together.
 */
describe('a conversation that outlives the session', () => {
  let messages: AgentMessage[];
  let kept: PersistedConversation[];
  let driver: ReturnType<typeof vi.fn> & { js: unknown; op: unknown };

  const settled = (h: AgentHost): Promise<void> =>
    vi.waitFor(() => expect(h.status().phase).toBe('idle'));

  const host = (steps: StepEvent[][] = [ends(), ends()]): AgentHost => createAgentHost({
    driver: driver as never,
    push: (m) => messages.push(m),
    ready: () => true,
    provider: () => fakeProvider(steps),
    persist: (c) => { kept.push({ ...c, events: [...c.events] }); },
  });

  beforeEach(() => {
    messages = [];
    kept = [];
    driver = vi.fn(async (method: string) => {
      if (method === 'mark') return { seq: 1 };
      if (method === 'stepsSince') return 2;
      if (method === 'getDiagnostics') return [];
      if (method === 'getSelectionIds') return [];
      return null;
    }) as never;
    (driver as { js: unknown }).js = vi.fn(async () => null);
    (driver as { op: unknown }).op = vi.fn(async () => null);
  });

  it('hands over the turn once it ends, with the memory beside it', async () => {
    const h = host();
    h.send('add a pause menu');
    await settled(h);
    expect(kept).toHaveLength(1);
    expect(kept[0].events.some((e) => e.type === 'turn_start')).toBe(true);
    expect(kept[0].memory).toEqual({ asked: ['add a pause menu'] });
  });

  it('keeps handing over the same conversation as it grows', async () => {
    const h = host();
    h.send('first');
    await settled(h);
    h.send('second');
    await settled(h);
    expect(kept).toHaveLength(2);
    expect(kept[0].id).toBe(kept[1].id);
    expect(kept[1].memory).toEqual({ asked: ['first', 'second'] });
  });

  // Otherwise New Conversation would overwrite the one the user may want back.
  it('a new conversation is a new file, not the old one rewritten', async () => {
    const h = host([ends(), ends()]);
    h.send('first');
    await settled(h);
    h.reset();
    h.send('second');
    await settled(h);
    expect(kept[0].id).not.toBe(kept[1].id);
  });

  // A turn that failed is still one you may want back.
  it('keeps a run that ended badly', async () => {
    const h = createAgentHost({
      driver: (vi.fn(async (m: string) => { if (m === 'mark') throw new Error('no window'); return null; }) as never),
      push: (m) => messages.push(m),
      ready: () => true,
      provider: () => fakeProvider([ends()]),
      persist: (c) => { kept.push({ ...c, events: [...c.events] }); },
    });
    h.send('hi');
    await settled(h);
    expect(kept).toHaveLength(1);
  });

  it('resuming replays the transcript and carries the memory into the next turn', async () => {
    const saved: PersistedConversation = {
      id: 'kept-1',
      startedAt: 10,
      model: 'fake-model',
      endpoint: 'fake',
      events: [
        { type: 'turn_start', prompt: 'yesterday', model: 'fake-model', index: 0 },
        { type: 'turn_end', steps: 0, mark: null, reason: 'end_turn' },
      ],
      memory: { asked: ['yesterday'] },
    };
    const h = host();
    messages = [];
    h.resume(saved);

    // The window is told to drop what it had, then given the run back.
    const replayed = messages.flatMap((m) => (m.kind === 'event' ? [m.event] : []));
    expect(replayed[0]).toEqual({ type: 'conversation_reset' });
    expect(replayed.some((e) => e.type === 'turn_start' && e.prompt === 'yesterday')).toBe(true);
    expect(h.transcript()).toHaveLength(2);

    // And the model picks up where it left off: the next turn opens at 1.
    h.send('and now the fonts');
    await settled(h);
    const opened = messages.flatMap((m) => (m.kind === 'event' ? [m.event] : []))
      .filter((e) => e.type === 'turn_start');
    expect(opened.at(-1)).toMatchObject({ prompt: 'and now the fonts', index: 1 });
  });

  it('writes a resumed conversation back under the id it came from', async () => {
    const h = host();
    h.resume({
      id: 'kept-1', startedAt: 10, model: 'fake-model', endpoint: 'fake',
      events: [], memory: { asked: ['yesterday'] },
    });
    h.send('more');
    await settled(h);
    expect(kept.at(-1)?.id).toBe('kept-1');
    expect(kept.at(-1)?.startedAt).toBe(10);
  });

  // Nothing to write to is a state, not a failure.
  it('runs fine with nowhere to keep anything', async () => {
    const h = createAgentHost({
      driver: driver as never,
      push: (m) => messages.push(m),
      ready: () => true,
      provider: () => fakeProvider([ends()]),
    });
    h.send('hi');
    await settled(h);
    expect(h.status().phase).toBe('idle');
  });
});

/**
 * Streaming deltas, merged before they leave main.
 *
 * A model writes a tool's arguments one JSON fragment at a time, and one scene
 * edit's arguments are hundreds of them. One IPC message, one store update and
 * one drawer re-render each is what froze the window while a call was being
 * written — and a blocked renderer cannot deliver the Stop click either.
 */
describe('streaming deltas leave merged', () => {
  let messages: AgentMessage[];
  let driver: ReturnType<typeof vi.fn> & { js: unknown; op: unknown };

  const settled = (h: AgentHost): Promise<void> =>
    vi.waitFor(() => expect(h.status().phase).toBe('idle'));
  const host = (steps: StepEvent[][]): AgentHost => createAgentHost({
    driver: driver as never,
    push: (m) => messages.push(m),
    ready: () => true,
    provider: () => fakeProvider(steps),
  });
  const events = () => messages.flatMap((m) => (m.kind === 'event' ? [m.event] : []));
  const kinds = () => events().map((e) => e.type);

  beforeEach(() => {
    messages = [];
    driver = vi.fn(async (method: string) => {
      if (method === 'mark') return { seq: 1 };
      if (method === 'stepsSince') return 0;
      if (method === 'getDiagnostics') return [];
      if (method === 'getSelectionIds') return [];
      return null;
    }) as never;
    (driver as { js: unknown }).js = vi.fn(async () => null);
    (driver as { op: unknown }).op = vi.fn(async () => null);
  });

  const streamed = (...evs: StepEvent[]): StepEvent[][] => [evs, ends()];
  const text = (delta: string): StepEvent => ({ type: 'text', delta });
  const args = (id: string, delta: string): StepEvent => ({ type: 'tool_args', id, delta });
  const stop = (): StepEvent => ({ type: 'stop', reason: 'end_turn' });

  it('merges a run of text into one event', async () => {
    const h = host(streamed(text('he'), text('ll'), text('o'), stop()));
    h.send('hi');
    await settled(h);
    const said = events().filter((e) => e.type === 'text') as Array<{ delta: string }>;
    expect(said).toHaveLength(1);
    expect(said[0].delta).toBe('hello');
  });

  it("keeps two tools' arguments apart", async () => {
    const h = host(streamed(
      args('a', '{"x":'), args('a', '1}'),
      args('b', '{"y":'), args('b', '2}'),
      stop(),
    ));
    h.send('two');
    await settled(h);
    expect(events().filter((e) => e.type === 'tool_args')).toEqual([
      { type: 'tool_args', id: 'a', delta: '{"x":1}' },
      { type: 'tool_args', id: 'b', delta: '{"y":2}' },
    ]);
  });

  it('does not merge across kinds', async () => {
    const h = host(streamed(
      { type: 'thinking', delta: 'hm' }, text('a'), { type: 'thinking', delta: 'ok' }, stop(),
    ));
    h.send('hi');
    await settled(h);
    expect(kinds().filter((k) => k === 'text' || k === 'thinking')).toEqual(['thinking', 'text', 'thinking']);
  });

  it('lets nothing overtake a pending delta', async () => {
    // Transcript and status share one channel BECAUSE their order is meaning;
    // a buffered delta is a transcript event that has not left yet.
    const h = host(streamed(text('looking'), { type: 'tool_call', call: call('get_scene_tree') },
      { type: 'stop', reason: 'tool_use' }));
    h.send('look');
    await settled(h);
    const order = kinds();
    expect(order.indexOf('text')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('text')).toBeLessThan(order.indexOf('tool_start'));
  });

  it('replays what it merged, not what it received', async () => {
    const h = host(streamed(text('a'), text('b'), stop()));
    h.send('hi');
    await settled(h);
    expect(h.transcript().filter((e) => e.type === 'text')).toEqual([{ type: 'text', delta: 'ab' }]);
  });
});
