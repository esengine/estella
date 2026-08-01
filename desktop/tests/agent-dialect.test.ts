// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The provider speaks two dialects of one wire format. The Messages API
 *        shape is implemented by other vendors; the extensions this provider
 *        leans on are Anthropic's, not the format's.
 *
 *        This is worth a test because both failure modes are quiet. A gateway
 *        handed `cache_control` ignores it, so the code claims caching that is
 *        not happening and the bill disagrees. One handed `thinking` may 400 —
 *        loud, but only at the first real turn, which is the worst place to find
 *        out. And a `role: "system"` message sent to a two-role API is either
 *        rejected or silently dropped, taking the editor's context with it.
 */
import { describe, it, expect } from 'vitest';
import { buildStepRequest, createAnthropicProvider } from '../electron/agent/anthropic';
import { DEFAULT_MODEL } from '../src/settings/agentIds';
import type { CatalogTool } from '../electron/agent/types';

const TOOLS: CatalogTool[] = [
  { name: 'get_scene_tree', description: 'Read the scene.', schema: { type: 'object' }, effect: 'read' },
];

const request = (dialect: 'anthropic' | 'compatible') => buildStepRequest({
  dialect,
  model: 'a-model',
  effort: 'xhigh',
  system: 'be useful',
  tools: TOOLS,
  messages: [{ role: 'user', content: 'hi' }],
});

/** Everything that exists because Anthropic added it, not because the Messages
 *  format has it. Adding one to the request means adding it here. */
const EXTENSIONS = ['thinking', 'cache_control', 'betas', 'fallbacks'];

describe('the request each dialect sends', () => {
  it('carries the same core in both', () => {
    for (const dialect of ['anthropic', 'compatible'] as const) {
      expect(request(dialect)).toMatchObject({
        model: 'a-model',
        system: 'be useful',
        max_tokens: expect.any(Number),
        output_config: { effort: 'xhigh' },
        tools: [{ name: 'get_scene_tree', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: 'hi' }],
      });
    }
  });

  it('uses the extensions when talking to Anthropic', () => {
    const req = request('anthropic');
    for (const key of EXTENSIONS) expect(req).toHaveProperty(key);
    expect(req.thinking).toMatchObject({ display: 'summarized' });
  });

  it('sends none of them to a gateway', () => {
    const req = request('compatible');
    for (const key of EXTENSIONS) expect(req).not.toHaveProperty(key);
  });

  // The catalog is what a gateway is told the agent can do; dropping tools on
  // the compatible path would leave a model that can only talk.
  it('sends the tool catalog either way', () => {
    expect(request('compatible').tools).toHaveLength(TOOLS.length);
  });
});

describe('choosing the dialect', () => {
  it('talks to Anthropic when no endpoint is set', () => {
    const provider = createAnthropicProvider({ apiKey: 'k' });
    expect(provider.id).toBe('anthropic');
    expect(provider.model).toBe(DEFAULT_MODEL);
  });

  // An empty string is what a cleared settings field produces, and reading it as
  // "a gateway at nowhere" would silently strip the extensions on the API.
  it('reads a blank endpoint as no endpoint', () => {
    expect(createAnthropicProvider({ apiKey: 'k', baseURL: '', model: '' }).id).toBe('anthropic');
    expect(createAnthropicProvider({ apiKey: 'k', model: '' }).model).toBe(DEFAULT_MODEL);
  });

  it('drops to the core format for a gateway, and takes its model verbatim', () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      baseURL: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-v4-pro',
    });
    expect(provider.id).toContain('compatible');
    expect(provider.model).toBe('deepseek-v4-pro');
  });
});

describe('where per-turn editor context lands', () => {
  const contextAfter = (dialect: 'anthropic' | 'compatible') => {
    const session = createAnthropicProvider(
      dialect === 'anthropic' ? { apiKey: 'k' } : { apiKey: 'k', baseURL: 'https://gateway.test' },
    ).createSession({ system: 's', tools: TOOLS });
    session.pushUser('build me a menu');
    session.pushContext('The editor is editing the scene /scenes/main.esscene.');
    // step() would call the network; the placement is decided before that, so
    // reach for what it would send instead of standing up an HTTP fake.
    (session as unknown as { flushContext(): void }).flushContext();
    return (session as unknown as { messages: { role: string; content: unknown }[] }).messages;
  };

  it('uses the operator channel on Anthropic', () => {
    const messages = contextAfter('anthropic');
    expect(messages.at(-1)).toMatchObject({ role: 'system' });
  });

  // A gateway implements two roles. The same text rides the user turn as an
  // extra block — legal in the core format, still after the cached prefix.
  it('folds it into the user turn on a gateway', () => {
    const messages = contextAfter('compatible');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user' });
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'build me a menu' },
      { type: 'text', text: 'The editor is editing the scene /scenes/main.esscene.' },
    ]);
  });

  it('holds the text rather than emitting a message with nothing to attach to', () => {
    const session = createAnthropicProvider({ apiKey: 'k' }).createSession({ system: 's', tools: TOOLS });
    session.pushContext('orphan');
    (session as unknown as { flushContext(): void }).flushContext();
    expect((session as unknown as { messages: unknown[] }).messages).toHaveLength(0);
  });
});
