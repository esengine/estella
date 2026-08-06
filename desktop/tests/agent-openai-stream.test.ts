// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reading one Chat Completions response.
 *
 *        The stream is untyped where the other protocol's is not: a tool call
 *        arrives in pieces addressed by INDEX, only the first of which carries
 *        the id and the name, and its arguments accumulate as a string. Every
 *        assertion here is about stitching that back together — and about the
 *        history it leaves behind, which is what the NEXT request is made of.
 */
import { describe, it, expect, vi } from 'vitest';
import type { StepEvent } from '../electron/agent/types';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { createOpenAIProvider } = await import('../electron/agent/openai');

type Chunk = Record<string, unknown>;

/** A response, as the wire delivers it. */
function stream(...chunks: Chunk[]): AsyncIterable<Chunk> {
  return { async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
}

const delta = (d: Record<string, unknown>, finish: string | null = null): Chunk =>
  ({ choices: [{ delta: d, finish_reason: finish }] });

async function run(...chunks: Chunk[]): Promise<{ events: StepEvent[]; history: unknown[] }> {
  create.mockResolvedValueOnce(stream(...chunks));
  const session = createOpenAIProvider({ apiKey: 'k', model: 'm' })
    .createSession({ system: 's', tools: [] });
  session.pushUser('go');
  const events: StepEvent[] = [];
  for await (const e of session.step(new AbortController().signal)) events.push(e);
  const memory = session.serialize() as { messages: unknown[] };
  return { events, history: memory.messages };
}

const only = <T extends StepEvent['type']>(events: StepEvent[], type: T) =>
  events.filter((e): e is Extract<StepEvent, { type: T }> => e.type === type);

describe('reading one response', () => {
  it('streams text and ends the turn', async () => {
    const { events } = await run(delta({ content: 'Hel' }), delta({ content: 'lo' }, 'stop'));
    expect(only(events, 'text').map((e) => e.delta)).toEqual(['Hel', 'lo']);
    expect(only(events, 'stop')[0].reason).toBe('end_turn');
  });

  // Shown, never sent back. There is no standard field for it — DeepSeek and
  // Qwen send `reasoning_content`, OpenRouter sends `reasoning` — and the
  // endpoints that produce it refuse it as INPUT, which is the exact opposite
  // of the other protocol's thinking blocks.
  it('shows reasoning under either name and keeps it out of the history', async () => {
    const a = await run(delta({ reasoning_content: 'weighing' }), delta({ content: 'ok' }, 'stop'));
    expect(only(a.events, 'thinking').map((e) => e.delta)).toEqual(['weighing']);
    expect(JSON.stringify(a.history)).not.toContain('weighing');

    const b = await run(delta({ reasoning: 'weighing' }), delta({ content: 'ok' }, 'stop'));
    expect(only(b.events, 'thinking').map((e) => e.delta)).toEqual(['weighing']);
  });

  it('stitches a tool call out of the pieces it arrives in', async () => {
    const { events, history } = await run(
      delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'move', arguments: '{"x"' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, 'tool_calls'),
    );
    expect(only(events, 'tool_pending')).toEqual([{ type: 'tool_pending', id: 'c1', name: 'move' }]);
    expect(only(events, 'tool_args').map((e) => e.delta)).toEqual(['{"x"', ':1}']);
    expect(only(events, 'tool_call')[0].call).toEqual({ id: 'c1', name: 'move', input: { x: 1 } });
    expect(only(events, 'stop')[0].reason).toBe('tool_use');
    // The assistant turn it leaves behind is what the next request replays.
    expect(history[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'c1', function: { name: 'move', arguments: '{"x":1}' } }],
    });
  });

  it('keeps two parallel calls apart, in the order they were indexed', async () => {
    const { events } = await run(
      delta({ tool_calls: [{ index: 1, id: 'b', function: { name: 'second', arguments: '{}' } }] }),
      delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'first', arguments: '{}' } }] }, 'tool_calls'),
    );
    expect(only(events, 'tool_call').map((e) => e.call.name)).toEqual(['first', 'second']);
  });

  // Several gateways report `stop` on a response that is nothing but tool calls.
  // Having asked for one is the fact the kernel acts on, so it wins.
  it('reads a response full of tool calls as tool_use however it was labelled', async () => {
    const { events } = await run(
      delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{}' } }] }, 'stop'),
    );
    expect(only(events, 'stop')[0].reason).toBe('tool_use');
  });

  // A truncated turn writes arguments that do not parse. The kernel dispatches
  // anyway: the tool reports what it needed and the model gets something it can
  // act on, where a throw would end the run with the reason in a stack trace.
  it('dispatches a call whose arguments were cut off', async () => {
    const { events } = await run(
      delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{"half' } }] }, 'length'),
    );
    expect(only(events, 'tool_call')[0].call.input).toEqual({});
  });

  it('reports what the call was billed, and where that leaves the context', async () => {
    const { events } = await run(
      delta({ content: 'hi' }, 'stop'),
      { usage: { prompt_tokens: 1200, completion_tokens: 8 }, choices: [] },
    );
    expect(only(events, 'usage')[0]).toEqual({ type: 'usage', inputTokens: 1200, outputTokens: 8 });
    // The window is the endpoint's, and the reading is the larger of what it
    // billed and what the history weighs.
    expect(only(events, 'context')[0].used).toBe(1200);
  });

  it('still answers for the context when the endpoint reports no usage at all', async () => {
    const { events } = await run(delta({ content: 'hi' }, 'stop'));
    expect(only(events, 'usage')).toHaveLength(0);
    expect(only(events, 'context')[0].used).toBeGreaterThan(0);
  });

  it('says what an endpoint failure means, and whether asking again could work', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 401 }));
    const session = createOpenAIProvider({ apiKey: 'k', model: 'm' })
      .createSession({ system: 's', tools: [] });
    session.pushUser('go');
    const step = async () => { for await (const _ of session.step(new AbortController().signal)) { /* drain */ } };
    await expect(step()).rejects.toThrow(/rejected the API key/i);
  });
});
