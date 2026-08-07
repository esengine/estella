// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Chat Completions provider — the half of it that is not the network.
 *
 *        Three of these are about differences from the OTHER protocol, and each
 *        of the three costs a turn when it is missed: a history the endpoint
 *        refuses outright after a Stop, reasoning that must be shown but never
 *        sent back, and usage that is not streamed unless asked for.
 */
import { describe, it, expect } from 'vitest';
import {
  buildChatRequest, answerOrphanedCalls, createOpenAIProvider, OPENAI_FORMAT,
} from '../electron/agent/openai';
import { ANTHROPIC_FORMAT } from '../electron/agent/anthropic';
import type { CatalogTool } from '../electron/agent/types';

const TOOLS: CatalogTool[] = [
  { name: 'get_scene_tree', description: 'read it', schema: { type: 'object', properties: {} } },
];

type Msg = Parameters<typeof answerOrphanedCalls>[0][number];

const request = (over: Partial<Parameters<typeof buildChatRequest>[0]> = {}) =>
  buildChatRequest({
    model: 'a-model',
    effort: 'xhigh',
    reasoningEffort: true,
    system: 'be useful',
    tools: TOOLS,
    messages: [{ role: 'user', content: 'hi' }],
    ...over,
  });

describe('the Chat Completions request', () => {
  // The prompt is a MESSAGE here, not a parameter — but it is prepended per
  // request rather than kept in the history, so the history's indices still mean
  // what the shared fold counts them to mean.
  it('puts the system prompt first without keeping it in the history', () => {
    const body = request();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be useful' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('declares tools as functions, in catalog order', () => {
    const body = request();
    expect(body.tools?.[0]).toEqual({
      type: 'function',
      function: { name: 'get_scene_tree', description: 'read it', parameters: TOOLS[0].schema },
    });
  });

  // Without this the context meter runs entirely on the character estimate,
  // which under-counts CJK badly — and CJK is most of what these users type.
  it('asks for usage, which is not streamed otherwise', () => {
    expect(request().stream_options).toEqual({ include_usage: true });
  });

  it('leaves reasoning_effort off for an endpoint that would refuse it', () => {
    expect((request() as { reasoning_effort?: string }).reasoning_effort).toBe('high');
    expect((request({ reasoningEffort: false }) as { reasoning_effort?: string }).reasoning_effort)
      .toBeUndefined();
  });
});

/**
 * An assistant message carrying tool_calls MUST be followed by a tool message
 * for every one of them. The kernel abandons a round mid-dispatch when the run
 * is aborted, so a Stop leaves exactly the history this protocol refuses — and
 * refuses again on every message after it, with nothing on screen tying the
 * failure to the Stop that caused it.
 */
describe('a history left half-answered by a Stop', () => {
  const asked = (...ids: string[]): Msg => ({
    role: 'assistant',
    content: null,
    tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 't', arguments: '{}' } })),
  } as Msg);

  it('answers every call nothing came back for', () => {
    const messages: Msg[] = [{ role: 'user', content: 'go' }, asked('a', 'b')];
    expect(answerOrphanedCalls(messages)).toBe(2);
    expect(messages.slice(2).map((m) => (m as { tool_call_id: string }).tool_call_id)).toEqual(['a', 'b']);
    expect(messages[2]).toMatchObject({ role: 'tool', content: expect.stringContaining('interrupted') });
  });

  it('answers only the ones that are missing', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'go' },
      asked('a', 'b'),
      { role: 'tool', tool_call_id: 'a', content: 'done' },
    ];
    expect(answerOrphanedCalls(messages)).toBe(1);
    expect(messages).toHaveLength(4);
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'b' });
  });

  it('leaves a complete history alone', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'go' },
      asked('a'),
      { role: 'tool', tool_call_id: 'a', content: 'done' },
      { role: 'assistant', content: 'there' },
    ];
    expect(answerOrphanedCalls(messages)).toBe(0);
    expect(messages).toHaveLength(4);
  });

  it('does nothing to a conversation that never called a tool', () => {
    const messages: Msg[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
    expect(answerOrphanedCalls(messages)).toBe(0);
    expect(messages).toHaveLength(2);
  });
});

describe('the provider', () => {
  const provider = (over = {}) => createOpenAIProvider({ apiKey: 'k', model: 'm', ...over });

  it('names the endpoint it is pointed at, so a transcript can say which', () => {
    expect(provider().id).toBe('openai');
    expect(provider({ baseURL: 'http://localhost:11434/v1' }).id).toBe('openai:http://localhost:11434/v1');
  });

  // Declared by whoever picked the provider (src/agent/providers.ts); the
  // address is only the fallback for a caller that says nothing.
  it('takes the caller at its word, and falls back to the address', () => {
    expect(provider({ baseURL: 'http://x/v1', vision: true }).acceptsImages).toBe(true);
    expect(provider({ vision: false }).acceptsImages).toBe(false);
    expect(provider().acceptsImages).toBe(true);
    expect(provider({ baseURL: 'http://localhost:11434/v1' }).acceptsImages).toBe(false);
  });

  /**
   * Both formats serialize to `{ v: 1, messages: [...] }`, so nothing but the
   * format's NAME can stop a Claude conversation being resumed into this session
   * — where it fails as a 400 several seconds later, with nothing connecting it
   * to the model switch that caused it.
   */
  it('refuses a conversation another protocol wrote, and starts fresh', () => {
    const memory = {
      v: 1,
      format: ANTHROPIC_FORMAT,
      messages: [{ role: 'user', content: 'from Claude' }],
      turnStarts: [0],
      dropped: 4,
      folded: [],
      lastInputTokens: 99,
    };
    const session = provider().createSession({ system: 's', tools: TOOLS }, memory);
    expect(session.turnIndex).toBe(0);
  });

  it('takes back one of its own', () => {
    const first = provider().createSession({ system: 's', tools: TOOLS });
    first.pushUser('remember this');
    const memory = first.serialize() as { format: string };
    expect(memory.format).toBe(OPENAI_FORMAT);

    const second = provider().createSession({ system: 's', tools: TOOLS }, memory);
    expect(second.turnIndex).toBe(1);
  });
});
