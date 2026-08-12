// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Messages typed while a turn is running.
 *
 *        The host REFUSES a send mid-turn, so the composer's promise ("this will
 *        be the next message") is kept on this side or not at all. It used to be
 *        not at all: the box was cleared, the send was rejected, and what the
 *        person typed was gone — a red banner in its place. These are the
 *        regression tests for holding it instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useAgent, sendAgentMessage, stopAgentTurn, applyAgentMessage, retryAgentTurn,
} from '@/store/AgentStore';
import type { AgentStatus } from '../electron/agent/host';

const send = vi.fn(async (_text: string, _images?: unknown) => undefined);
const stop = vi.fn();
const retry = vi.fn(async (_n: number, _text: string) => undefined);

const status = (phase: AgentStatus['phase']): AgentStatus =>
  ({ ready: true, conversation: true, phase, model: 'opus-5', error: null, lastTurn: null });

/** What main pushes when a turn starts or ends. */
const pushStatus = (phase: AgentStatus['phase']) => applyAgentMessage({ kind: 'status', status: status(phase) });

beforeEach(() => {
  send.mockClear();
  stop.mockClear();
  retry.mockClear();
  (globalThis as { window?: unknown }).window = { estella: { agent: { send, stop, retry } } };
  useAgent.setState({ status: status('idle'), turns: [], queued: [], driving: false });
});

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('messages typed while a turn runs', () => {
  it('sends straight through when nothing is running', async () => {
    await sendAgentMessage('add a pause menu');
    expect(send).toHaveBeenCalledWith('add a pause menu', undefined);
    expect(useAgent.getState().queued).toEqual([]);
  });

  it('holds the message instead of losing it to a refused send', async () => {
    useAgent.setState({ status: status('running') });
    await sendAgentMessage('and make the buttons bigger');
    expect(send).not.toHaveBeenCalled();
    expect(useAgent.getState().queued.map((q) => q.text)).toEqual(['and make the buttons bigger']);
  });

  it('holds one per message, in the order they were typed', async () => {
    useAgent.setState({ status: status('running') });
    await sendAgentMessage('first');
    await sendAgentMessage('second');
    expect(useAgent.getState().queued.map((q) => q.text)).toEqual(['first', 'second']);
  });

  // Attachments are part of the message, so they wait with it — losing the
  // picture you dragged in would be worse than losing the sentence.
  it('holds what was attached along with the message', async () => {
    useAgent.setState({ status: status('running') });
    const shot = [{ id: 'a1', name: 'mock.png', mediaType: 'image/png', data: 'AAA', url: 'data:,', bytes: 3 }];
    await sendAgentMessage('like this', shot);
    expect(useAgent.getState().queued[0]?.images).toEqual(shot);

    pushStatus('idle');
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith('like this', [{ mediaType: 'image/png', data: 'AAA' }]);
  });

  // A confirmation is not the turn ending — the run still owns the session.
  it('keeps holding while the turn waits on a confirmation', async () => {
    useAgent.setState({ status: status('awaiting_confirm') });
    await sendAgentMessage('meanwhile, rename it');
    expect(send).not.toHaveBeenCalled();
    expect(useAgent.getState().queued.map((q) => q.text)).toEqual(['meanwhile, rename it']);
  });

  it('releases the oldest one when the turn ends', async () => {
    useAgent.setState({ status: status('running') });
    await sendAgentMessage('first');
    await sendAgentMessage('second');

    pushStatus('idle');
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('first', undefined);
    expect(useAgent.getState().queued.map((q) => q.text)).toEqual(['second']);
  });

  // Stopping means stop: a queue that drained itself afterwards would start a
  // turn the person had just asked to end.
  it('drops what was held when the turn is stopped', async () => {
    useAgent.setState({ status: status('running') });
    await sendAgentMessage('never mind this one');
    stopAgentTurn();
    expect(useAgent.getState().queued).toEqual([]);
    expect(stop).toHaveBeenCalled();

    pushStatus('idle');
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * Re-asking a run.
 *
 * The host has always taken the text rather than looking it up, because the
 * usual reason to run a turn again is that the question could have been put
 * better. Same words is just the case where it could not.
 */
describe('asking a run again', () => {
  const turn = (id: number, prompt: string) => ({
    id, prompt, model: 'm', entries: [], inputTokens: 0, outputTokens: 0, context: null,
    steps: 0, mark: null, endMark: null, tx: null, files: [], reason: 'end_turn' as const, startedAt: 0, endedAt: 1,
  });

  beforeEach(() => {
    useAgent.setState({ turns: [turn(0, 'first'), turn(1, 'second')] });
  });

  it('sends the words it was given, not the ones that were asked', async () => {
    await retryAgentTurn(0, 'put it better');
    expect(retry).toHaveBeenCalledWith(0, 'put it better');
  });

  it('falls back to the original when nothing was changed', async () => {
    await retryAgentTurn(0);
    expect(retry).toHaveBeenCalledWith(0, 'first');
  });

  // The run being re-asked and everything after it goes, on this side too —
  // the transcript must not show runs the session has already forgotten.
  it('drops that run and the ones after it', async () => {
    await retryAgentTurn(0, 'again');
    expect(useAgent.getState().turns).toEqual([]);
  });

  it('keeps the runs before it', async () => {
    await retryAgentTurn(1, 'again');
    expect(useAgent.getState().turns.map((t) => t.id)).toEqual([0]);
  });

  // Clearing the box and pressing Enter is not a request to ask nothing.
  it('refuses an emptied question, leaving the run alone', async () => {
    await retryAgentTurn(0, '   ');
    expect(retry).not.toHaveBeenCalled();
    expect(useAgent.getState().turns).toHaveLength(2);
  });
});
