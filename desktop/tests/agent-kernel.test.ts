// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The agent turn loop: what runs unasked, what has to be confirmed, what
 *        the model is told afterwards, and what a turn leaves behind for the
 *        Undo affordance. Pure TS — a fake provider and a fake driver, no
 *        Electron and no network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runTurn } from '../electron/agent/kernel';
import type { AgentEvent, AgentSession, StepEvent, ToolCall, ToolOutcome } from '../electron/agent/types';

/** A provider that replays scripted steps and records what it was told. */
function fakeSession(steps: StepEvent[][]): AgentSession & {
  context: string[]; user: string[]; results: ToolOutcome[][];
} {
  let at = 0;
  const context: string[] = [];
  const user: string[] = [];
  const results: ToolOutcome[][] = [];
  return {
    context, user, results,
    // Faithful to the real one: the coordinate the next turn will occupy.
    get turnIndex() { return user.length; },
    pushUser: (t) => { user.push(t); },
    pushContext: (t) => { context.push(t); },
    pushToolResults: (o) => { results.push([...o]); },
    step: async function* () {
      for (const ev of steps[at] ?? [{ type: 'stop', reason: 'end_turn' }]) yield ev;
      at++;
    },
  };
}

const call = (name: string, input: Record<string, unknown> = {}): ToolCall =>
  ({ id: `c${name}`, name, input });
const asks = (...calls: ToolCall[]): StepEvent[] =>
  [...calls.map((c) => ({ type: 'tool_call' as const, call: c })), { type: 'stop' as const, reason: 'tool_use' as const }];
const ends = (): StepEvent[] => [{ type: 'stop', reason: 'end_turn' }];

describe('the agent turn', () => {
  let events: AgentEvent[];
  let confirm: ReturnType<typeof vi.fn>;
  let driver: ReturnType<typeof vi.fn> & { js: unknown; op: unknown };
  let stepsSince: number;
  let diagnostics: unknown[];

  const deps = (session: AgentSession) => ({
    driver: driver as never, session, model: 'fake-model', confirm: confirm as never,
    emit: (e: AgentEvent) => { events.push(e); },
  });
  const kinds = () => events.map((e) => e.type);
  const ran = (name: string) => events.some((e) => e.type === 'tool_start' && e.call.name === name);

  beforeEach(() => {
    events = [];
    stepsSince = 0;
    diagnostics = [];
    confirm = vi.fn(async () => true);
    driver = vi.fn(async (method: string) => {
      if (method === 'mark') return { seq: 7 };
      if (method === 'stepsSince') return stepsSince;
      if (method === 'getDiagnostics') return diagnostics;
      return null;
    }) as never;
    (driver as { js: unknown }).js = vi.fn(async () => null);
    (driver as { op: unknown }).op = vi.fn(async () => null);
  });

  it('brackets the turn with a checkpoint and reports what Undo would take back', async () => {
    stepsSince = 3;
    const s = fakeSession([ends()]);
    const out = await runTurn(deps(s), 'hi', null, new AbortController().signal);
    expect(out.mark).toEqual({ seq: 7 });
    expect(out.steps).toBe(3);
    // Both carry what the editor's read model needs and cannot infer across IPC:
    // what was asked, and the point an Undo would go back to.
    expect(events.at(0)).toEqual({ type: 'turn_start', prompt: 'hi', model: 'fake-model', index: 0 });
    expect(events.at(-1)).toEqual({ type: 'turn_end', steps: 3, mark: { seq: 7 }, reason: 'end_turn' });
  });

  // The provider announces a call while the model writes its arguments, and
  // again when they parse. Only the second is a call — collecting both would
  // run every tool the model asks for twice.
  it('runs a call once, however many times the provider mentions it', async () => {
    const s = fakeSession([[
      { type: 'tool_pending', id: 'cadd_entity', name: 'add_entity' },
      { type: 'tool_args', id: 'cadd_entity', delta: '{}' },
      { type: 'tool_call', call: call('add_entity') },
      { type: 'stop', reason: 'tool_use' },
    ], ends()]);
    await runTurn(deps(s), 'add one', null, new AbortController().signal);
    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(1);
    expect(s.results[0]).toHaveLength(1);
  });

  it('runs an undoable edit without asking — the checkpoint is the approval', async () => {
    const s = fakeSession([asks(call('add_entity')), ends()]);
    await runTurn(deps(s), 'add one', null, new AbortController().signal);
    expect(confirm).not.toHaveBeenCalled();
    expect(ran('add_entity')).toBe(true);
    expect(kinds()).toContain('tool_end');
  });

  it('asks before anything Undo cannot take back', async () => {
    const s = fakeSession([asks(call('save_scene')), ends()]);
    await runTurn(deps(s), 'save it', null, new AbortController().signal);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ tool: 'save_scene' });
    expect(kinds()).toContain('awaiting_confirm');
  });

  it('a decline is told to the model, not raised as a failure', async () => {
    confirm.mockResolvedValue(false);
    const s = fakeSession([asks(call('export_game', { platform: 'web' })), ends()]);
    await runTurn(deps(s), 'ship it', null, new AbortController().signal);

    const [outcomes] = s.results;
    expect(outcomes[0].isError).toBe(false); // a refusal is an answer, not an error
    expect(outcomes[0].content).toContain('declined');
    expect(outcomes[0].content).toContain('Do not retry');
    // …and the tool never reached the editor.
    expect(driver).not.toHaveBeenCalledWith('exportGame', expect.anything(), expect.anything());
  });

  it('feeds every result of a round back in ONE push, so parallel calls stay together', async () => {
    const s = fakeSession([asks(call('add_entity'), call('get_scene_tree')), ends()]);
    await runTurn(deps(s), 'do both', null, new AbortController().signal);
    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toHaveLength(2);
  });

  it('tells the model what the editor flags after it writes', async () => {
    diagnostics = [{
      entityName: 'Hero', component: 'Sprite', field: 'texture',
      problem: 'required-empty', detail: 'Sprite.texture is required but empty',
    }];
    const s = fakeSession([asks(call('add_entity')), ends()]);
    await runTurn(deps(s), 'add a hero', null, new AbortController().signal);
    expect(s.context.join('\n')).toContain('Sprite.texture is required but empty');
  });

  it('says nothing when the scene is clean — silence is the done signal', async () => {
    const s = fakeSession([asks(call('add_entity')), ends()]);
    await runTurn(deps(s), 'add', null, new AbortController().signal);
    expect(s.context).toHaveLength(0);
  });

  it('does not re-verify after a read-only round', async () => {
    const s = fakeSession([asks(call('get_scene_tree')), ends()]);
    await runTurn(deps(s), 'look', null, new AbortController().signal);
    expect(driver).not.toHaveBeenCalledWith('getDiagnostics', expect.anything());
  });

  it('answers an unknown tool instead of throwing the turn away', async () => {
    const s = fakeSession([asks(call('teleport')), ends()]);
    await runTurn(deps(s), 'go', null, new AbortController().signal);
    expect(s.results[0][0]).toMatchObject({ isError: true });
    expect(s.results[0][0].content).toContain('no such tool');
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'end_turn' });
  });

  it('stops on abort and still reports the checkpoint', async () => {
    stepsSince = 2;
    const ac = new AbortController();
    const s = fakeSession([asks(call('add_entity'), call('add_entity')), ends()]);
    confirm.mockImplementation(async () => true);
    driver.mockImplementation(async (method: string) => {
      if (method === 'mark') return { seq: 7 };
      if (method === 'stepsSince') return stepsSince;
      if (method === 'getDiagnostics') return diagnostics;
      ac.abort();
      return null;
    });
    await runTurn(deps(s), 'lots', null, ac.signal);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'aborted', steps: 2 });
  });

  it('carries a provider refusal out as its own reason', async () => {
    const s = fakeSession([[{ type: 'stop', reason: 'refusal' }]]);
    await runTurn(deps(s), 'no', null, new AbortController().signal);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'refusal' });
  });

  it('puts editor context ahead of the user turn, and only when there is some', async () => {
    const s = fakeSession([ends()]);
    await runTurn(deps(s), 'hi', 'The open document is main.esscene.', new AbortController().signal);
    expect(s.context[0]).toContain('main.esscene');
    expect(s.user).toEqual(['hi']);
  });

  // The tool exists so the model can SEE. Handing it the word "[image]" is a
  // capability quietly removed — and the provider, not the kernel, is the side
  // that knows whether the endpoint can carry one.
  it('passes a rendered frame through instead of flattening it to text', async () => {
    (driver as { op: unknown }).op = vi.fn(async () => 'BASE64PNG');
    const s = fakeSession([asks(call('screenshot')), ends()]);
    await runTurn(deps(s), 'show me', null, new AbortController().signal);

    const outcome = s.results[0][0];
    expect(outcome.image).toEqual({ data: 'BASE64PNG', mediaType: 'image/png' });
    expect(outcome.content).not.toContain('[image]');
    const ended = events.find((e) => e.type === 'tool_end');
    expect(ended).toMatchObject({ image: 'data:image/png;base64,BASE64PNG' });
  });

  // A tool that answers with the whole scene can spend a conversation's context
  // in one call, and the turn after it fails for a reason nothing on screen
  // explains. The cut has to be SAID, too: a model handed a silently truncated
  // list believes it saw everything and edits from a scene that ends early.
  describe('a result too big to hand the model whole', () => {
    it('cuts it, and says it was cut', async () => {
      const huge = Array.from({ length: 4000 }, (_, i) => ({ id: i, name: `Entity${i}` }));
      driver = vi.fn(async (method: string) => {
        if (method === 'mark') return { seq: 7 };
        if (method === 'stepsSince') return stepsSince;
        if (method === 'getDiagnostics') return diagnostics;
        if (method === 'getSceneTree') return huge;
        return null;
      }) as never;
      (driver as { js: unknown }).js = vi.fn(async () => null);
      (driver as { op: unknown }).op = vi.fn(async () => null);

      const s = fakeSession([asks(call('get_scene_tree')), ends()]);
      await runTurn(deps(s), 'what is in here', null, new AbortController().signal);

      const content = String(s.results[0][0].content);
      expect(content.length).toBeLessThan(30_000);
      expect(content).toContain('Truncated');
      // Told what to do instead, not just that something is missing.
      expect(content).toMatch(/narrow/i);
    });

    it('leaves an ordinary result untouched', async () => {
      const s = fakeSession([asks(call('get_scene_tree')), ends()]);
      await runTurn(deps(s), 'what is in here', null, new AbortController().signal);
      expect(String(s.results[0][0].content)).not.toContain('Truncated');
    });
  });
});
