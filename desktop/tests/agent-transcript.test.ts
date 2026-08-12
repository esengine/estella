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
import {
  applyAgentEvent, entitiesInInput, touchedEntities, briefResult, latestContext,
  type AgentTurn, type AgentToolEntry, type AgentProseEntry,
} from '../src/store/AgentStore';
import type { AgentEvent, ToolCall } from '../electron/agent/types';

const fold = (...events: AgentEvent[]): AgentTurn[] =>
  events.reduce<AgentTurn[]>((turns, e) => applyAgentEvent(turns, e), []);

const started = (prompt = 'add a pause menu', index = 0, model = 'opus-5'): AgentEvent =>
  ({ type: 'turn_start', prompt, model, index });
const ended = (over: Partial<{ steps: number; mark: unknown; reason: 'end_turn' | 'aborted' | 'error' | 'refusal' }> = {}): AgentEvent =>
  ({ type: 'turn_end', steps: 0, mark: null, endMark: null, tx: null, files: [], reason: 'end_turn', ...over });
const call = (name: string): ToolCall => ({ id: `c-${name}`, name, input: { a: 1 } });
const tools = (t: AgentTurn): AgentToolEntry[] => t.entries.filter((e): e is AgentToolEntry => e.kind === 'tool');

describe('the transcript projection', () => {
  it('opens a run per turn, carrying what was asked', () => {
    const turns = fold(started('one'), ended(), started('two', 1));
    expect(turns.map((t) => t.prompt)).toEqual(['one', 'two']);
    expect(turns.map((t) => t.reason)).toEqual(['end_turn', null]);
  });

  // The header of a past run has to say which model answered IT — the picker in
  // the composer only ever says what the NEXT message will use.
  it('records the model that answered each run, not just the current one', () => {
    const turns = fold(started('one', 0, 'opus-5'), ended(), started('two', 1, 'haiku-4-5'));
    expect(turns.map((t) => t.model)).toEqual(['opus-5', 'haiku-4-5']);
  });

  // A run's identity is the SESSION's coordinate. A window that only saw the
  // tail of a conversation still has to name run 7 the way the session does, or
  // "re-ask this one" rewinds to somewhere nobody asked for.
  it('takes a run\'s identity from the session, not from its own position', () => {
    const turns = fold(started('seventh', 7), ended(), started('eighth', 8));
    expect(turns.map((t) => t.id)).toEqual([7, 8]);
  });

  // Replaying the stream over a transcript that already holds part of it is how
  // a reloaded window catches up — it must not double the runs it already had.
  it('replays without doubling a run it already has', () => {
    const stream = [started('one'), ended(), started('two', 1)];
    const once = fold(...stream);
    const twice = stream.reduce<AgentTurn[]>(applyAgentEvent, once);
    expect(twice.map((t) => t.id)).toEqual([0, 1]);
  });

  it('gathers a streamed answer into one paragraph', () => {
    const [turn] = fold(
      started(),
      { type: 'text', delta: 'The scene ' },
      { type: 'text', delta: 'has 58 entities.' },
    );
    expect(turn.entries).toMatchObject([{ kind: 'text', text: 'The scene has 58 entities.' }]);
  });

  // Reasoning is timed: the reader is already measuring that silence, and a
  // block that never closes would keep counting after the run moved on.
  it('stamps a prose block\'s start, and closes it when something else begins', () => {
    const [turn] = fold(
      started(),
      { type: 'thinking', delta: 'look at the UI layer' },
      { type: 'text', delta: 'Building it now.' },
    );
    const [thinking, answer] = turn.entries as [AgentProseEntry, AgentProseEntry];
    expect(thinking.startedAt).toBeGreaterThan(0);
    expect(thinking.endedAt).toBeGreaterThanOrEqual(thinking.startedAt);
    // The one still being written has not ended.
    expect(answer.endedAt).toBeNull();
  });

  it('closes an open prose block when the run ends', () => {
    const [turn] = fold(started(), { type: 'text', delta: 'Done.' }, ended());
    expect((turn.entries[0] as AgentProseEntry).endedAt).not.toBeNull();
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

  // A screenshot is the point of the tool that produced it, so it rides the row
  // rather than being something the reader has to expand to find.
  it('keeps a rendered frame on the row that produced it', () => {
    const [turn] = fold(
      started(),
      { type: 'tool_call', call: call('capture_viewport') },
      { type: 'tool_end', id: 'c-capture_viewport', ok: true, summary: 'ok', image: 'data:image/png;base64,AAA' },
    );
    expect(tools(turn)[0].image).toBe('data:image/png;base64,AAA');
  });

  // The provider announces the call when the model commits to it, then again
  // with the parsed arguments. Two rows for one call would double every tool.
  it('treats the second announcement of a call as an update, not a new row', () => {
    const turns = fold(
      started(),
      { type: 'tool_call', call: { id: 'c1', name: 'set_field', input: {} } },
      { type: 'tool_args', id: 'c1', delta: '{"entity"' },
      { type: 'tool_args', id: 'c1', delta: ':7}' },
      { type: 'tool_call', call: { id: 'c1', name: 'set_field', input: { entity: 7 } } },
    );
    expect(tools(turns[0])).toHaveLength(1);
    expect(tools(turns[0])[0].argText).toBe('{"entity":7}');
    expect(tools(turns[0])[0].input).toEqual({ entity: 7 });
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
        request: { callId: 'c-save_scene', tool: 'save_scene', reason: 'irreversible', input: {} },
      },
    );
    expect(tools(turn)[0]).toMatchObject({ state: 'awaiting', reason: 'irreversible' });
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

  // A level, where usage is a cost. The newest reading replaces the last one —
  // added up, the gauge would pass the window in three turns and claim a
  // conversation was full while the model was still answering it.
  it('replaces the context reading rather than accumulating it', () => {
    const [turn] = fold(
      started(),
      { type: 'context', used: 12_000, window: 200_000 },
      { type: 'context', used: 31_000, window: 200_000 },
    );
    expect(turn.context).toEqual({ used: 31_000, window: 200_000 });
  });

  // The runs it folded away are still on screen above this line, which is why
  // the line has to be in the run where it happened rather than a badge on it.
  it('marks where the model stopped remembering its earliest runs', () => {
    const [turn] = fold(
      started(),
      { type: 'thinking', delta: 'this is a long one' },
      { type: 'compacted', runs: 4 },
      { type: 'text', delta: 'Carrying on.' },
    );
    expect(turn.entries.map((e) => e.kind)).toEqual(['thinking', 'compacted', 'text']);
    expect(turn.entries[1]).toEqual({ kind: 'compacted', runs: 4 });
    // The block above it is over: a fold is something else beginning.
    expect((turn.entries[0] as AgentProseEntry).endedAt).not.toBeNull();
  });

  // A run that has only just started carries no reading, and a gauge that
  // blanked at the top of every turn would go missing exactly while the thing
  // it measures grows fastest.
  it('reads the latest context back through runs that have none', () => {
    expect(latestContext([])).toBeNull();
    const turns = fold(
      started('one'),
      { type: 'context', used: 90_000, window: 200_000 },
      ended(),
      started('two', 1),
    );
    expect(turns[1].context).toBeNull();
    expect(latestContext(turns)).toEqual({ used: 90_000, window: 200_000 });
  });

  // Stamped on this side of the IPC because it is what the PERSON waited.
  it('stamps when the run started and when it stopped', () => {
    const [running] = fold(started());
    expect(running.startedAt).toBeGreaterThan(0);
    expect(running.endedAt).toBeNull();
    const [done] = fold(started(), ended());
    expect(done.endedAt).toBeGreaterThanOrEqual(done.startedAt);
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

  // main's log trims by whole runs at its own ceiling; a mirror that grew
  // without one would be the side of this that leaks. Dropping from the front
  // is only safe because identity is the session's index, not the position.
  it('keeps a bounded number of runs, oldest out first', () => {
    let turns: AgentTurn[] = [];
    for (let i = 0; i < 130; i++) {
      turns = applyAgentEvent(turns, started(`run ${i}`, i));
      turns = applyAgentEvent(turns, ended());
    }
    expect(turns).toHaveLength(100);
    // What is left still names itself the way the session does.
    expect(turns[0].id).toBe(30);
    expect(turns.at(-1)!.id).toBe(129);
  });
});

// The Outliner echo. Read off the catalog's own argument names rather than a
// per-tool table, which would be a second definition of the catalog.
describe('which entities a turn touched', () => {
  const toolEntry = (over: Partial<AgentToolEntry>): AgentToolEntry => ({
    kind: 'tool', id: 'c1', name: 'set_field', input: {}, effect: 'undoable',
    state: 'ok', summary: 'ok', brief: 'ok', image: null, argText: '', reason: null, ...over,
  });
  const turn = (entries: AgentToolEntry[], id = 0): AgentTurn => ({
    id, prompt: 'p', model: 'opus-5', entries, inputTokens: 0, outputTokens: 0, context: null,
    steps: 1, mark: { seq: 1 }, endMark: null, tx: null, files: [], reason: 'end_turn', startedAt: 0, endedAt: 1,
  });

  it('reads the ids out of the argument names the catalog uses', () => {
    expect(entitiesInInput({ entity: 7, component: 'Transform' })).toEqual([7]);
    expect(entitiesInInput({ id: 3 })).toEqual([3]);
    expect(entitiesInInput({ ids: [4, 5], path: 'x' })).toEqual([4, 5]);
    expect(entitiesInInput({ name: 'PauseRoot' })).toEqual([]);
  });

  it('counts only calls that ran and changed something', () => {
    expect([...touchedEntities([turn([
      toolEntry({ id: 'a', input: { entity: 1 } }),
      toolEntry({ id: 'b', input: { entity: 2 }, state: 'error' }),
      toolEntry({ id: 'c', input: { entity: 3 }, effect: 'read' }),
      toolEntry({ id: 'd', input: { entity: 4 }, state: 'queued' }),
    ])], null)]).toEqual([1]);
  });

  // The transcript still says what happened; the badge is about what still wants
  // your eye, and after Undo it did not happen at all.
  it('forgets a turn once its checkpoint has been answered', () => {
    const turns = [
      turn([toolEntry({ id: 'a', input: { entity: 1 } })], 0),
      turn([toolEntry({ id: 'b', input: { entity: 2 } })], 1),
    ];
    expect([...touchedEntities(turns, null)]).toEqual([1, 2]);
    expect([...touchedEntities(turns, 0)]).toEqual([2]);
    expect([...touchedEntities(turns, 1)]).toEqual([]);
  });

  // Two sessions both have a run 0. A mirror that kept the old runs would treat
  // the new one as a repeat of what it already had and drop it — which is
  // exactly what happened the first time this was driven against a real gateway.
  it('starts over when the conversation is dropped', () => {
    const after = fold(
      started('old one'), ended(),
      { type: 'conversation_reset' },
      started('new one'),
    );
    expect(after.map((t) => t.prompt)).toEqual(['new one']);
    expect(after.map((t) => t.id)).toEqual([0]);
  });
});


// The row's result column is one cell wide. It used to hold the first 20
// characters of whatever the tool returned — for a JSON answer that is `[{"id`,
// which tells you nothing and hides the count that would have.
describe('a result as one cell', () => {
  it('counts a list', () => {
    expect(briefResult('[{"id":0,"name":"Camera"},{"id":1,"name":"Sprite0"}]')).toBe('2');
  });

  it('leads an object with its first named string', () => {
    expect(briefResult('{"kind":"scene","dirty":false,"path":"main.esscene"}')).toBe('scene');
  });

  it('falls back to the first line of prose', () => {
    expect(briefResult('ok\nnothing else to report')).toBe('ok');
  });

  it('clips a long line rather than letting it push the row', () => {
    expect(briefResult('x'.repeat(80))).toHaveLength(26);
  });

  it('says nothing for an empty result', () => {
    expect(briefResult('   ')).toBe('');
  });
});