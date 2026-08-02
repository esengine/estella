// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A window attaching to a conversation that started without it.
 *
 *        main owns the session, so it outlives a reload. The drawer used to come
 *        back empty from one — the model remembered what the screen had
 *        forgotten — and worse, a transcript that started numbering runs again
 *        made "re-ask this one" name a different turn on each side. Runs carry
 *        the session's own coordinate now, and the stream is replayed on attach.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAgent, attachAgentBridge } from '@/store/AgentStore';
import type { AgentEvent } from '../electron/agent/types';
import type { AgentStatus } from '../electron/agent/host';

const status: AgentStatus =
  { ready: true, conversation: true, phase: 'idle', model: 'opus-5', error: null };

/** A conversation of two finished runs, as main would have logged it. */
const conversation = (from = 0): AgentEvent[] => [
  { type: 'turn_start', prompt: 'add a pause menu', model: 'opus-5', index: from },
  { type: 'text', delta: 'Building it.' },
  { type: 'turn_end', steps: 7, mark: { seq: 1 }, reason: 'end_turn' },
  { type: 'turn_start', prompt: 'bigger buttons', model: 'opus-5', index: from + 1 },
  { type: 'text', delta: 'Done.' },
  { type: 'turn_end', steps: 3, mark: { seq: 2 }, reason: 'end_turn' },
];

let transcript: AgentEvent[];
let listener: ((m: unknown) => void) | null;

beforeEach(() => {
  transcript = [];
  listener = null;
  (globalThis as { window?: unknown }).window = {
    estella: {
      agent: {
        onMessage: (cb: (m: unknown) => void) => { listener = cb; return () => { listener = null; }; },
        status: async () => status,
        transcript: async () => transcript,
        setEndpoint: async () => {},
      },
      secrets: { status: async () => ({ id: 'x', configured: false, storage: 'keychain', error: null }) },
    },
  };
  useAgent.setState({ turns: [], queued: [], checkpointDone: null });
});

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('attaching to a conversation already in progress', () => {
  it('rebuilds the transcript from the stream', async () => {
    transcript = conversation();
    attachAgentBridge();
    await settle();

    const { turns } = useAgent.getState();
    expect(turns.map((t) => t.prompt)).toEqual(['add a pause menu', 'bigger buttons']);
    expect(turns.map((t) => t.reason)).toEqual(['end_turn', 'end_turn']);
  });

  // The point of the whole exercise: what this window calls run 7 has to be what
  // the session calls run 7, or rewinding to it discards the wrong thing.
  it('keeps the session\'s numbering, not its own', async () => {
    transcript = conversation(7);
    attachAgentBridge();
    await settle();
    expect(useAgent.getState().turns.map((t) => t.id)).toEqual([7, 8]);
  });

  // Subscribed before the transcript is asked for, so nothing arriving in
  // between is dropped — which means the two can overlap, and must not double.
  it('does not double a run that arrived live while it was catching up', async () => {
    transcript = conversation();
    attachAgentBridge();
    // Main pushes the tail of the same conversation before the replay lands.
    for (const event of conversation()) listener?.({ kind: 'event', event });
    await settle();

    const { turns } = useAgent.getState();
    expect(turns.map((t) => t.id)).toEqual([0, 1]);
  });

  it('leaves an empty conversation empty', async () => {
    attachAgentBridge();
    await settle();
    expect(useAgent.getState().turns).toEqual([]);
  });
});
