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
import { useAgent, sendAgentMessage, stopAgentTurn, applyAgentMessage } from '@/store/AgentStore';
import type { AgentStatus } from '../electron/agent/host';

const send = vi.fn(async (_text: string) => undefined);
const stop = vi.fn();

const status = (phase: AgentStatus['phase']): AgentStatus =>
  ({ ready: true, conversation: true, phase, model: 'opus-5', error: null });

/** What main pushes when a turn starts or ends. */
const pushStatus = (phase: AgentStatus['phase']) => applyAgentMessage({ kind: 'status', status: status(phase) });

beforeEach(() => {
  send.mockClear();
  stop.mockClear();
  (globalThis as { window?: unknown }).window = { estella: { agent: { send, stop } } };
  useAgent.setState({ status: status('idle'), turns: [], queued: [], driving: false });
});

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('messages typed while a turn runs', () => {
  it('sends straight through when nothing is running', async () => {
    await sendAgentMessage('add a pause menu');
    expect(send).toHaveBeenCalledWith('add a pause menu');
    expect(useAgent.getState().queued).toEqual([]);
  });

  it('holds the message instead of losing it to a refused send', async () => {
    useAgent.setState({ status: status('running') });
    await sendAgentMessage('and make the buttons bigger');
    expect(send).not.toHaveBeenCalled();
    expect(useAgent.getState().queued).toEqual(['and make the buttons bigger']);
  });

  it('holds one per message, in the order they were typed', async () => {
    useAgent.setState({ status: status('running') });
    await sendAgentMessage('first');
    await sendAgentMessage('second');
    expect(useAgent.getState().queued).toEqual(['first', 'second']);
  });

  // A confirmation is not the turn ending — the run still owns the session.
  it('keeps holding while the turn waits on a confirmation', async () => {
    useAgent.setState({ status: status('awaiting_confirm') });
    await sendAgentMessage('meanwhile, rename it');
    expect(send).not.toHaveBeenCalled();
    expect(useAgent.getState().queued).toEqual(['meanwhile, rename it']);
  });

  it('releases the oldest one when the turn ends', async () => {
    useAgent.setState({ status: status('running') });
    await sendAgentMessage('first');
    await sendAgentMessage('second');

    pushStatus('idle');
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('first');
    expect(useAgent.getState().queued).toEqual(['second']);
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
