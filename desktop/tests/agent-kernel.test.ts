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
    rewindTo: (n) => { user.length = n; },
    serialize: () => ({ user: [...user] }),
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
    driver: driver as never, session, model: 'fake-model', acceptsImages: true, confirm: confirm as never,
    emit: (e: AgentEvent) => { events.push(e); },
  });
  const kinds = () => events.map((e) => e.type);
  const ran = (name: string) => events.some((e) => e.type === 'tool_start' && e.call.name === name);

  beforeEach(() => {
    events = [];
    stepsSince = 0;
    diagnostics = [];
    confirm = vi.fn(async () => ({ answer: 'once' }));
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
    confirm.mockResolvedValue({ answer: 'no' });
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
    // A clean sweep adds no diagnostics line. (The turn is still asked to LOOK
    // once, which is a different reflex with its own cases below — this one is
    // about what the DIAGNOSTICS say, so it looks first and leaves that quiet.)
    const s = fakeSession([asks(call('add_entity')), asks(call('capture_viewport')), ends()]);
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
    confirm.mockImplementation(async () => ({ answer: 'once' }));
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

  // A model that keeps asking for tools is cut off, and the run has to say so:
  // an end_turn here looks exactly like a run that finished, and the sentence
  // that would have told you otherwise is the one it never got to write.
  it('says the step budget ran out rather than reporting a finished run', async () => {
    // Enough steps to outlast any cap: writing the cap's number here is how a
    // test starts failing for the raise it was meant to be indifferent to.
    const s = fakeSession(Array.from({ length: 400 }, () => asks(call('get_scene_tree'))));
    await runTurn(deps(s), 'build the whole game', null, new AbortController().signal);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'max_rounds' });
  });

  it('does not blame the budget for a run that stopped asking in time', async () => {
    const s = fakeSession([asks(call('get_scene_tree')), ends()]);
    await runTurn(deps(s), 'look', null, new AbortController().signal);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'end_turn' });
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

  // A task that saves eleven files should be one decision, not eleven identical
  // ones — a gate that interrupts that often is one people click through.
  describe('the confirmation gate\'s scope', () => {
    it('asks once per call by default', async () => {
      const s = fakeSession([asks(call('save_scene'), call('save_scene')), ends()]);
      await runTurn(deps(s), 'save twice', null, new AbortController().signal);
      expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('stops asking for that tool once it is allowed for the run', async () => {
      confirm.mockResolvedValue({ answer: 'turn' });
      const s = fakeSession([asks(call('save_scene'), call('save_scene'), call('save_scene')), ends()]);
      await runTurn(deps(s), 'save thrice', null, new AbortController().signal);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(events.filter((e) => e.type === 'tool_end' && e.ok)).toHaveLength(3);
    });

    // Scoped to the TOOL, not to everything: saying yes to saving is not saying
    // yes to running arbitrary code.
    it('does not carry the allowance to a different tool', async () => {
      confirm.mockResolvedValue({ answer: 'turn' });
      const s = fakeSession([asks(call('save_scene'), call('run_editor_command')), ends()]);
      await runTurn(deps(s), 'save then run', null, new AbortController().signal);
      expect(confirm).toHaveBeenCalledTimes(2);
    });

    // The allowance is the run's. A new run starts from a clean gate, which is
    // the whole reason it is not persisted.
    it('expires with the run', async () => {
      confirm.mockResolvedValue({ answer: 'turn' });
      // capture_viewport in each turn: a turn that wrote and never looked spends
      // an extra round being asked to, which would shift the scripted steps.
      const s = fakeSession([
        asks(call('save_scene')), asks(call('capture_viewport')), ends(),
        asks(call('save_scene')), asks(call('capture_viewport')), ends(),
      ]);
      await runTurn(deps(s), 'save', null, new AbortController().signal);
      await runTurn(deps(s), 'save again', null, new AbortController().signal);
      expect(confirm).toHaveBeenCalledTimes(2);
    });
  });

  // Reads cannot affect each other, so a batch of them is one wait rather than
  // N. Anything that writes stays ordered, including against the reads around it.
  describe('running a batch of calls', () => {
    /** Records overlap: how many calls were in flight at the busiest moment. */
    const withConcurrency = () => {
      let live = 0;
      let peak = 0;
      driver = vi.fn(async (method: string) => {
        if (method === 'mark') return { seq: 7 };
        if (method === 'stepsSince') return stepsSince;
        if (method === 'getDiagnostics') return diagnostics;
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return method === 'getSceneTree' ? [] : null;
      }) as never;
      (driver as { js: unknown }).js = vi.fn(async () => null);
      (driver as { op: unknown }).op = vi.fn(async () => null);
      return () => peak;
    };

    it('sends a run of reads together', async () => {
      const peak = withConcurrency();
      const s = fakeSession([asks(call('get_scene_tree'), call('get_stats'), call('get_document')), ends()]);
      await runTurn(deps(s), 'look around', null, new AbortController().signal);
      expect(peak()).toBeGreaterThan(1);
    });

    it('keeps a write to itself, and in order with the reads around it', async () => {
      const peak = withConcurrency();
      const s = fakeSession([asks(call('get_scene_tree'), call('add_entity'), call('get_stats')), ends()]);
      await runTurn(deps(s), 'read, write, read', null, new AbortController().signal);
      expect(peak()).toBe(1);
      // Results still line up with the calls that produced them.
      expect(s.results[0].map((o) => o.id))
        .toEqual(['cget_scene_tree', 'cadd_entity', 'cget_stats']);
    });
  });

  // Authoring a subtree is one undo step, so this gate is not about safety — it
  // is about seeing a hundred-node edit before it lands, while declining part of
  // it still costs nothing.
  describe('previewing a batch before it lands', () => {
    const ops = [
      { op: 'create', ref: 'root', name: 'Root' },
      { op: 'create', ref: 'child', name: 'Child', parent: '$root' },
      { op: 'rename', entity: 1, name: 'Renamed' },
    ];
    const batch = (): ToolCall => ({ id: 'cbatch', name: 'apply_scene_ops', input: { ops } });

    it('asks, and says which kind of question it is', async () => {
      const s = fakeSession([asks(batch()), ends()]);
      await runTurn(deps(s), 'build it', null, new AbortController().signal);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0]).toMatchObject({ tool: 'apply_scene_ops', reason: 'bulk_edit' });
    });

    it('runs only what survived, in order', async () => {
      confirm.mockResolvedValue({ answer: 'once', declined: [1] });
      const s = fakeSession([asks(batch()), ends()]);
      await runTurn(deps(s), 'build it', null, new AbortController().signal);

      const call = (driver as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .find((c) => c[0] === 'applyOps');
      expect((call?.[1] as unknown[])[0]).toEqual([ops[0], ops[2]]);
    });

    // Applying nothing and reporting success would tell the model its work
    // landed. It has to hear that the person said no to all of it.
    it('treats an entirely struck-out batch as declined', async () => {
      confirm.mockResolvedValue({ answer: 'once', declined: [0, 1, 2] });
      const s = fakeSession([asks(batch()), ends()]);
      await runTurn(deps(s), 'build it', null, new AbortController().signal);

      expect(ran('apply_scene_ops')).toBe(true);           // it was announced
      expect(events.some((e) => e.type === 'tool_end' && !e.ok)).toBe(true);
      expect(String(s.results[0][0].content)).toMatch(/struck out/i);
    });

    it('stops asking once the run is trusted', async () => {
      confirm.mockResolvedValue({ answer: 'turn' });
      const s = fakeSession([asks(batch(), batch()), ends()]);
      await runTurn(deps(s), 'build it twice', null, new AbortController().signal);
      expect(confirm).toHaveBeenCalledTimes(1);
    });
  });

  // The editor is not frozen while a turn runs. An edit the agent makes from a
  // reading taken before the person dragged something silently overwrites them,
  // and nothing else in the loop would notice.
  describe('the person editing mid-turn', () => {
    it('says so, once, between rounds', async () => {
      const s = fakeSession([asks(call('add_entity')), asks(call('get_stats')), ends()]);
      // The stack grows between the agent's own work and the next round.
      let reported = 0;
      driver = vi.fn(async (method: string) => {
        if (method === 'mark') return { seq: 7 };
        if (method === 'stepsSince') { reported += 1; return reported; }
        if (method === 'getDiagnostics') return diagnostics;
        return null;
      }) as never;
      (driver as { js: unknown }).js = vi.fn(async () => null);
      (driver as { op: unknown }).op = vi.fn(async () => null);

      await runTurn(deps(s), 'add one', null, new AbortController().signal);
      expect(s.context.some((c) => /edited the scene themselves/i.test(c))).toBe(true);
      expect(s.context.some((c) => /re-read/i.test(c))).toBe(true);
    });

    it('stays quiet when every step is the agent\'s own', async () => {
      stepsSince = 3;
      const s = fakeSession([asks(call('add_entity')), asks(call('get_stats')), ends()]);
      await runTurn(deps(s), 'add one', null, new AbortController().signal);
      expect(s.context.some((c) => /edited the scene themselves/i.test(c))).toBe(false);
    });
  });

  // A gateway that speaks the core format may still refuse image blocks. The
  // agent has no way to find that out except by spending a call on a screenshot
  // it will then be told it cannot see.
  it('tells a blind endpoint\'s agent not to rely on looking', async () => {
    const s = fakeSession([ends()]);
    await runTurn({ ...deps(s), acceptsImages: false }, 'how does it look', null, new AbortController().signal);
    expect(s.context.some((c) => /cannot carry images/i.test(c))).toBe(true);
    expect(s.context.some((c) => /get_diagnostics/.test(c))).toBe(true);
  });

  it('says nothing about it where images do cross', async () => {
    const s = fakeSession([ends()]);
    await runTurn(deps(s), 'how does it look', null, new AbortController().signal);
    expect(s.context.some((c) => /cannot carry images/i.test(c))).toBe(false);
  });

  /**
   * Stop, pressed while a tool is running.
   *
   * It used to be honoured only BETWEEN calls, so a slow one held the turn open
   * after the click and the button read as dead. The dispatch cannot be
   * cancelled — it is executing inside the editor window — so what has to end
   * promptly is the turn.
   */
  describe('stopping while a tool is in flight', () => {
    /** Park the tool dispatch; the checkpoint reads still answer. */
    function hangingDriver(): { release: () => void } {
      let release = (): void => {};
      driver = vi.fn(async (method: string) => {
        if (method === 'mark') return { seq: 7 };
        if (method === 'stepsSince') return stepsSince;
        if (method === 'getDiagnostics') return diagnostics;
        await new Promise<void>((r) => { release = r; });
        return null;
      }) as never;
      (driver as { js: unknown }).js = vi.fn(async () => null);
      (driver as { op: unknown }).op = vi.fn(async () => null);
      return { release: () => { release(); } };
    }

    /** Let the loop run until `done`, without waiting on wall time. */
    async function until(done: () => boolean): Promise<void> {
      for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => { setTimeout(r, 0); });
      if (!done()) throw new Error('condition never became true');
    }

    it('ends the turn without waiting for the call to come back', async () => {
      const stuck = hangingDriver();
      const ac = new AbortController();
      const s = fakeSession([asks(call('get_scene_tree')), ends()]);
      const turn = runTurn(deps(s), 'look', null, ac.signal);

      await until(() => events.some((e) => e.type === 'tool_start'));
      ac.abort();
      // Resolves on the abort alone — the dispatch is never released.
      await expect(turn).resolves.toBeTruthy();
      expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'aborted' });
      stuck.release();
    });

    it('says the call may still land rather than implying it was undone', async () => {
      const stuck = hangingDriver();
      const ac = new AbortController();
      const s = fakeSession([asks(call('save_scene')), ends()]);
      const turn = runTurn(deps(s), 'save it', null, ac.signal);

      await until(() => events.some((e) => e.type === 'tool_start'));
      ac.abort();
      await turn;
      const end = events.find((e) => e.type === 'tool_end');
      expect(end).toMatchObject({ ok: false });
      expect((end as { summary: string }).summary).toMatch(/still complete/i);
      stuck.release();
    });

    it('does not feed the model results from a turn nobody waited for', async () => {
      const stuck = hangingDriver();
      const ac = new AbortController();
      const s = fakeSession([asks(call('get_scene_tree')), ends()]);
      const turn = runTurn(deps(s), 'look', null, ac.signal);

      await until(() => events.some((e) => e.type === 'tool_start'));
      ac.abort();
      await turn;
      expect(s.results).toEqual([]);
      stuck.release();
    });

    it('never dispatches when the signal was already aborted', async () => {
      const stuck = hangingDriver();
      const ac = new AbortController();
      ac.abort();
      const s = fakeSession([asks(call('get_scene_tree')), ends()]);
      await runTurn(deps(s), 'look', null, ac.signal);
      // The turn is over before the loop; the parked dispatch was never entered.
      expect(events.some((e) => e.type === 'tool_start')).toBe(false);
      stuck.release();
    });
  });
});

describe('looking before reporting', () => {
  let events: AgentEvent[];
  let driver: ReturnType<typeof vi.fn> & { js: unknown; op: unknown };

  const deps = (session: AgentSession) => ({
    driver: driver as never, session, model: 'fake-model', acceptsImages: true,
    confirm: (async () => ({ answer: 'once' })) as never,
    emit: (e: AgentEvent) => { events.push(e); },
  });

  beforeEach(() => {
    events = [];
    driver = vi.fn(async (method: string) => {
      if (method === 'mark') return { seq: 1 };
      if (method === 'stepsSince') return 0;
      if (method === 'getDiagnostics') return [];
      return null;
    }) as never;
    (driver as { js: unknown }).js = vi.fn(async () => null);
    (driver as { op: unknown }).op = vi.fn(async () => null);
  });

  it('sends a turn that built something but never looked back for a look', async () => {
    // The gomoku turn: 71 calls, every write compiling, every diagnostic clean,
    // and the board half off camera — because nothing in the loop ever put a
    // picture in front of it.
    const s = fakeSession([asks(call('add_entity', { name: 'Board' })), ends(), ends()]);
    await runTurn(deps(s), 'build me a board', null, new AbortController().signal);
    expect(s.context.some((c) => c.includes('capture_viewport'))).toBe(true);
  });

  it('says nothing to a turn that already looked', async () => {
    const s = fakeSession([
      asks(call('add_entity', { name: 'Board' })),
      asks(call('capture_viewport')),
      ends(),
    ]);
    await runTurn(deps(s), 'build me a board', null, new AbortController().signal);
    expect(s.context.some((c) => c.includes('capture_viewport now'))).toBe(false);
  });

  it('says nothing to a turn that only read', async () => {
    // Answering a question is not building something, and a question does not
    // need a screenshot to be answered honestly.
    const s = fakeSession([asks(call('get_scene_tree')), ends()]);
    await runTurn(deps(s), 'what is in the scene?', null, new AbortController().signal);
    expect(s.context.some((c) => c.includes('capture_viewport'))).toBe(false);
  });

  it('asks once, not every round', async () => {
    // A second ask is an argument. The model may have a reason not to look, and
    // a loop that insists cannot be ended by the model at all.
    const s = fakeSession([asks(call('add_entity', { name: 'B' })), ends(), ends(), ends()]);
    await runTurn(deps(s), 'build', null, new AbortController().signal);
    expect(s.context.filter((c) => c.includes('capture_viewport')).length).toBe(1);
  });
});

describe('running out of rounds', () => {
  it('warns before the cap so the turn can be landed, not truncated', async () => {
    // The cap used to arrive without notice: the round in which it would have
    // summarised the work is the one it never got, so an unfinished turn and a
    // finished one looked identical to whoever was reading.
    const events: AgentEvent[] = [];
    const driver = vi.fn(async (method: string) => {
      if (method === 'mark') return { seq: 1 };
      if (method === 'stepsSince') return 0;
      if (method === 'getDiagnostics') return [];
      return null;
    }) as ReturnType<typeof vi.fn> & { js: unknown; op: unknown };
    (driver as { js: unknown }).js = vi.fn(async () => null);
    (driver as { op: unknown }).op = vi.fn(async () => null);

    // Never stops asking: the only way to reach the cap.
    const forever: StepEvent[][] = Array.from({ length: 200 }, () => asks(call('get_scene_tree')));
    const s = fakeSession(forever);
    const out = await runTurn({
      driver: driver as never, session: s, model: 'm', acceptsImages: true,
      confirm: (async () => ({ answer: 'once' })) as never,
      emit: (e: AgentEvent) => { events.push(e); },
    }, 'go', null, new AbortController().signal);

    expect(out).toBeTruthy();
    expect(events.some((e) => e.type === 'turn_end' && e.reason === 'max_rounds')).toBe(true);
    const warnings = s.context.filter((c) => c.includes('rounds left'));
    expect(warnings).toHaveLength(1);
  });
});

describe('what verification means for a model that cannot see', () => {
  const mkDriver = () => {
    const d = vi.fn(async (method: string) => {
      if (method === 'mark') return { seq: 1 };
      if (method === 'stepsSince') return 0;
      if (method === 'getDiagnostics') return [];
      return null;
    }) as ReturnType<typeof vi.fn> & { js: unknown; op: unknown };
    (d as { js: unknown }).js = vi.fn(async () => null);
    (d as { op: unknown }).op = vi.fn(async () => null);
    return d;
  };

  it('asks a text-only model to RUN the game, not to screenshot it', async () => {
    // Told to capture_viewport, a model that cannot receive images did the only
    // sensible thing with the request — re-read its own source — and reported a
    // game whose ball never launched. A screenshot it cannot see is not a check.
    const s = fakeSession([asks(call('add_entity')), ends(), ends()]);
    await runTurn({
      driver: mkDriver() as never, session: s, model: 'text-only', acceptsImages: false,
      confirm: (async () => ({ answer: 'once' })) as never, emit: () => {},
    }, 'build a game', null, new AbortController().signal);
    const nudge = s.context.find((c) => c.includes('never ran it'));
    expect(nudge).toBeTruthy();
    expect(nudge).toContain('toggle_play');
    expect(nudge).toContain('play_probe');
    expect(nudge).not.toContain('capture_viewport now');
  });

  it('counts running the game as having checked, for either kind of model', async () => {
    for (const acceptsImages of [true, false]) {
      const s = fakeSession([
        asks(call('add_entity')), asks(call('toggle_play')), asks(call('play_probe')), ends(),
      ]);
      await runTurn({
        driver: mkDriver() as never, session: s, model: 'm', acceptsImages,
        confirm: (async () => ({ answer: 'once' })) as never, emit: () => {},
      }, 'build', null, new AbortController().signal);
      expect([acceptsImages, s.context.some((c) => c.includes('never ran it') || c.includes('not looked at it'))])
        .toEqual([acceptsImages, false]);
    }
  });
});
