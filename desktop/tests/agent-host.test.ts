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
import { createAgentHost, type AgentHost, type AgentMessage, type AgentStatus } from '../electron/agent/host';
import type { AgentProvider, AgentSession, StepEvent, ToolCall } from '../electron/agent/types';

const call = (name: string): ToolCall => ({ id: `c-${name}`, name, input: {} });
const asks = (...calls: ToolCall[]): StepEvent[] =>
  [...calls.map((c) => ({ type: 'tool_call' as const, call: c })), { type: 'stop' as const, reason: 'tool_use' as const }];
const ends = (): StepEvent[] => [{ type: 'stop', reason: 'end_turn' }];

/** A provider that replays scripted steps and counts how often it was built. */
function fakeProvider(steps: StepEvent[][]): AgentProvider {
  let at = 0;
  const session: AgentSession = {
    pushUser: () => {},
    pushContext: () => {},
    pushToolResults: () => {},
    step: async function* () {
      for (const ev of steps[at] ?? [{ type: 'stop', reason: 'end_turn' }]) yield ev;
      at++;
    },
  };
  return { id: 'fake', model: 'fake-model', createSession: () => session };
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

  const host = (steps: StepEvent[][] = [ends()]): AgentHost => createAgentHost({
    driver: driver as never,
    push: (m) => messages.push(m),
    ready: () => keyed,
    provider: () => {
      built++;
      if (!keyed) throw new Error('No API key is configured. Add one in Settings › AI Agents.');
      return fakeProvider(steps);
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

      h.confirm('c-save_scene', true);
      await settled(h);
      expect(events().some((e) => e.type === 'tool_end' && e.ok)).toBe(true);
    });

    it('tells the model a decline is an answer, not a failure to retry', async () => {
      const h = host([asks(call('save_scene')), ends()]);
      h.send('save it');
      await vi.waitFor(() => expect(h.status().phase).toBe('awaiting_confirm'));
      h.confirm('c-save_scene', false);
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
      expect(() => h.confirm('c-gone', true)).not.toThrow();
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
});
