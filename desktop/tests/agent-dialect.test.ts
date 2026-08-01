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
import {
  buildStepRequest, createAnthropicProvider, toolResultContent, describeApiError,
} from '../electron/agent/anthropic';
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

// capture_viewport exists so the model can SEE. Where the endpoint cannot carry
// an image the substitution has to SAY so — a model handed a silently dropped
// screenshot concludes the editor is broken.
describe('a tool result carrying a rendered frame', () => {
  const shot = {
    id: 'c1',
    content: 'screenshot attached',
    isError: false,
    image: { data: 'BASE64PNG', mediaType: 'image/png' },
  };

  it('sends the image itself to Anthropic', () => {
    const content = toolResultContent(shot, 'anthropic');
    expect(Array.isArray(content)).toBe(true);
    expect((content as { type: string }[])[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'BASE64PNG' },
    });
  });

  it('tells a gateway why there is no image rather than dropping it in silence', () => {
    const content = toolResultContent(shot, 'compatible');
    expect(typeof content).toBe('string');
    expect(content).toContain('does not accept images');
  });

  it('leaves an ordinary result a plain string on both', () => {
    const plain = { id: 'c2', content: '7 created', isError: false };
    expect(toolResultContent(plain, 'anthropic')).toBe('7 created');
    expect(toolResultContent(plain, 'compatible')).toBe('7 created');
  });
});

// The SDK's message is written for someone reading a stack trace. In the
// transcript the only useful content is WHICH situation this is, because each
// one has a different answer.
describe('what a failed request says', () => {
  const err = (status: number | undefined, message = 'boom', headers?: Record<string, string>) =>
    Object.assign(new Error(message), { status, headers });

  it('names the wait, not "try again", when rate limited', () => {
    // By the time this surfaces the SDK has already retried with backoff, so
    // "try again" is not advice — how long is.
    expect(describeApiError(err(429, 'x', { 'retry-after': '30' }))).toContain('30s');
    expect(describeApiError(err(429))).toContain('Rate limited');
  });

  // The SDK returns a Headers on some paths and a plain object on others.
  // Reading one shape is how the useful half of a 429 goes missing.
  it('reads retry-after from either header shape', () => {
    const withHeaders = Object.assign(new Error('x'), {
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    });
    expect(describeApiError(withHeaders)).toContain('12s');
  });

  it('sends a rejected key to the place it is fixed', () => {
    expect(describeApiError(err(401))).toContain('Settings');
    expect(describeApiError(err(403))).toContain('Settings');
  });

  // The two are indistinguishable from a 404 and have the same fix, so say both
  // rather than guessing one.
  it('treats an unknown model and a wrong address as the same question', () => {
    const text = describeApiError(err(404));
    expect(text).toContain('model');
    expect(text).toContain('address');
  });

  it('says an outage is not your fault', () => {
    expect(describeApiError(err(503))).toContain('Nothing is wrong on this side');
  });

  // No status at all is not an HTTP failure: DNS, offline, a gateway that is
  // not running. "Rate limited" would be a lie and "500" would be a guess.
  it('separates never-reached from refused', () => {
    expect(describeApiError(err(undefined, 'ECONNREFUSED'))).toContain('Could not reach');
    expect(describeApiError(err(400, 'max_tokens too large'))).toContain('max_tokens too large');
  });
});
