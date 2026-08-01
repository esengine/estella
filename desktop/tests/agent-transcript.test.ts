// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Folding main's event stream into the runs the drawer draws. Pure, so it
 *        is tested here rather than by looking at an editor: the projection is
 *        where a streamed delta becomes a paragraph, a requested call becomes a
 *        queued row, and a turn that ended underneath its own tools stops
 *        claiming they are still running.
 */
import { describe, it, expect } from 'vitest';
import { applyAgentEvent, type AgentTurn, type AgentToolEntry } from '../src/store/AgentStore';
import type { AgentEvent, ToolCall } from '../electron/agent/types';

const fold = (...events: AgentEvent[]): AgentTurn[] =>
  events.reduce<AgentTurn[]>((turns, e) => applyAgentEvent(turns, e), []);

const started = (prompt = 'add a pause menu'): AgentEvent => ({ type: 'turn_start', prompt });
const ended = (over: Partial<{ steps: number; mark: unknown; reason: 'end_turn' | 'aborted' | 'error' | 'refusal' }> = {}): AgentEvent =>
  ({ type: 'turn_end', steps: 0, mark: null, reason: 'end_turn', ...over });
const call = (name: string): ToolCall => ({ id: `c-${name}`, name, input: { a: 1 } });
const tools = (t: AgentTurn): AgentToolEntry[] => t.entries.filter((e): e is AgentToolEntry => e.kind === 'tool');

describe('the transcript projection', () => {
  it('opens a run per turn, carrying what was asked', () => {
    const turns = fold(started('one'), ended(), started('two'));
    expect(turns.map((t) => t.prompt)).toEqual(['one', 'two']);
    expect(turns.map((t) => t.reason)).toEqual(['end_turn', null]);
  });

  it('gathers a streamed answer into one paragraph', () => {
    const [turn] = fold(
      started(),
      { type: 'text', delta: 'The scene ' },
      { type: 'text', delta: 'has 58 entities.' },
    );
    expect(turn.entries).toEqual([{ kind: 'text', text: 'The scene has 58 entities.' }]);
  });

  // Reasoning and answer are different rows; concatenating them would put the
  // thinking inside the sentence the user is meant to read.
  it('keeps thinking and answer apart, and reopens a paragraph per switch', () => {
    const [turn] = fold(
      started(),
      { type: 'thinking', delta: 'look at the UI layer' },
      { type: 'text', delta: 'Building it now.' },
      { type: 'thinking', delta: 'now the panel' },
    );
    expect(turn.entries.map((e) => e.kind)).toEqual(['thinking', 'text', 'thinking']);
  });

  // The doc's "parallel, greyed, not three spinners": asked-for is not running.
  it('shows a requested call as queued until it actually starts', () => {
    const asked = fold(started(), { type: 'tool_call', call: call('set_field') });
    expect(tools(asked[0])[0]).toMatchObject({ state: 'queued', effect: null, name: 'set_field' });

    const running = applyAgentEvent(asked, { type: 'tool_start', call: call('set_field'), effect: 'undoable' });
    expect(tools(running[0])[0]).toMatchObject({ state: 'running', effect: 'undoable' });
  });

  it('carries a call through to its result', () => {
    const [turn] = fold(
      started(),
      { type: 'tool_call', call: call('add_entity') },
      { type: 'tool_start', call: call('add_entity'), effect: 'undoable' },
      { type: 'tool_end', id: 'c-add_entity', ok: true, summary: '7 created' },
    );
    expect(tools(turn)[0]).toMatchObject({ state: 'ok', summary: '7 created' });
  });

  it('marks a failed call as failed', () => {
    const [turn] = fold(
      started(),
      { type: 'tool_call', call: call('set_field') },
      { type: 'tool_end', id: 'c-set_field', ok: false, summary: 'no such component' },
    );
    expect(tools(turn)[0].state).toBe('error');
  });

  it('waits on the person, and says why', () => {
    const [turn] = fold(
      started(),
      { type: 'tool_call', call: call('save_scene') },
      { type: 'tool_start', call: call('save_scene'), effect: 'irreversible' },
      {
        type: 'awaiting_confirm',
        request: { callId: 'c-save_scene', tool: 'save_scene', reason: 'writes outside the scene', input: {} },
      },
    );
    expect(tools(turn)[0]).toMatchObject({ state: 'awaiting', reason: 'writes outside the scene' });
  });

  // The kernel reports a decline as an ordinary failed call, because that is what
  // the MODEL is told. Painting it red would blame the tool for the user's answer.
  it('leaves a declined call declined rather than calling it an error', () => {
    const declined = fold(
      started(),
      { type: 'tool_call', call: call('save_scene') },
    ).map((t) => ({
      ...t,
      entries: t.entries.map((e) => (e.kind === 'tool' ? { ...e, state: 'declined' as const } : e)),
    }));
    const after = applyAgentEvent(declined, { type: 'tool_end', id: 'c-save_scene', ok: false, summary: 'declined' });
    expect(tools(after[0])[0].state).toBe('declined');
  });

  it('adds up usage across the turn\'s several model calls', () => {
    const [turn] = fold(
      started(),
      { type: 'usage', inputTokens: 1200, outputTokens: 80 },
      { type: 'usage', inputTokens: 1400, outputTokens: 30 },
    );
    expect(turn).toMatchObject({ inputTokens: 2600, outputTokens: 110 });
  });

  it('records what one Undo would take back, and where to', () => {
    const [turn] = fold(started(), ended({ steps: 7, mark: { seq: 12 } }));
    expect(turn).toMatchObject({ steps: 7, mark: { seq: 12 }, reason: 'end_turn' });
  });

  // Stop lands while calls are in flight. Leaving them "running" is a transcript
  // that says work is still happening after the turn is over.
  it('stops claiming a call is running once the turn ends under it', () => {
    const [turn] = fold(
      started(),
      { type: 'tool_call', call: call('set_field') },
      { type: 'tool_start', call: call('set_field'), effect: 'undoable' },
      { type: 'tool_call', call: call('add_entity') },
      { type: 'tool_end', id: 'c-set_field', ok: true, summary: 'ok' },
      ended({ reason: 'aborted' }),
    );
    expect(tools(turn).map((t) => t.state)).toEqual(['ok', 'stopped']);
  });

  it('puts an error into the run it happened in', () => {
    const [turn] = fold(started(), { type: 'error', message: 'rate limited' }, ended({ reason: 'error' }));
    expect(turn.entries).toEqual([{ kind: 'error', message: 'rate limited' }]);
  });

  // The host ends a turn that never started (runTurn takes its checkpoint before
  // its own try block). Inventing a run to hold that would put a promptless row
  // in the transcript for something the user never asked for.
  it('drops events that belong to no open run', () => {
    expect(fold(ended())).toEqual([]);
    expect(fold({ type: 'text', delta: 'stray' })).toEqual([]);
    expect(fold(started(), ended(), { type: 'text', delta: 'late' })[0].entries).toEqual([]);
  });

  it('leaves the runs alone for a raw stop — the outcome arrives with turn_end', () => {
    const before = fold(started());
    expect(applyAgentEvent(before, { type: 'stop', reason: 'tool_use' })).toEqual(before);
  });
});
