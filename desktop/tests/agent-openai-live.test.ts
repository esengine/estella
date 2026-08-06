// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Chat Completions provider against a real socket.
 *
 *        The unit tests above hand the parser an array of chunk objects, which
 *        skips the two layers most likely to be wrong about a protocol: what the
 *        SDK actually puts on the wire, and how server-sent events are framed.
 *        A stand-in endpoint is cheap and covers both — it records the request
 *        body, so what this provider CLAIMS to send is checked against what
 *        arrives rather than against itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createOpenAIProvider } from '../electron/agent/openai';
import type { StepEvent, CatalogTool } from '../electron/agent/types';

const TOOLS: CatalogTool[] = [
  { name: 'select_entity', description: 'select one', schema: { type: 'object', properties: { id: { type: 'number' } } } },
];

let server: Server;
let baseURL = '';
/** What the endpoint was last sent — the half a self-consistent test misses. */
let received: Record<string, unknown> | null = null;
/** The chunks the next request answers with. */
let script: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = JSON.parse(body || '{}') as Record<string, unknown>;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const chunk of script) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseURL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`;
});

afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

const delta = (d: Record<string, unknown>, finish: string | null = null) =>
  ({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: d, finish_reason: finish }] });

function session() {
  return createOpenAIProvider({ apiKey: 'k', model: 'stand-in', baseURL, vision: true })
    .createSession({ system: 'be useful', tools: TOOLS });
}

async function drain(s: ReturnType<typeof session>): Promise<StepEvent[]> {
  const events: StepEvent[] = [];
  for await (const e of s.step(new AbortController().signal)) events.push(e);
  return events;
}

describe('against a stand-in Chat Completions endpoint', () => {
  it('sends the system prompt, the tools and the history, and reads the answer back', async () => {
    script = [delta({ role: 'assistant', content: 'hello' }, 'stop')];
    const s = session();
    s.pushUser('say hello');
    const events = await drain(s);

    const messages = received?.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: 'system', content: 'be useful' });
    expect(messages[1]).toEqual({ role: 'user', content: 'say hello' });
    expect((received?.tools as { function: { name: string } }[])[0].function.name).toBe('select_entity');
    expect(received?.stream_options).toEqual({ include_usage: true });
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)).toEqual(['hello']);
  });

  // The round trip the kernel actually makes: ask for a tool, hand back its
  // result, ask again. Each result is its OWN message in this protocol, and the
  // second request is the first place a mistake about that shows.
  it('carries a tool round trip in the shape the endpoint expects', async () => {
    script = [
      delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'select_entity', arguments: '{"id":7}' } }] }, 'tool_calls'),
    ];
    const s = session();
    s.pushUser('select entity 7');
    const first = await drain(s);
    const call = first.find((e) => e.type === 'tool_call') as { call: { id: string; input: unknown } };
    expect(call.call.input).toEqual({ id: 7 });

    s.pushToolResults([{ id: call.call.id, content: 'selected', isError: false }]);
    script = [delta({ content: 'done' }, 'stop')];
    await drain(s);

    const messages = received?.messages as { role: string; tool_call_id?: string; content?: unknown; tool_calls?: unknown[] }[];
    expect(messages[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'c1' }] });
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'selected' });
  });

  /**
   * The Stop case, end to end. The kernel abandons a round mid-dispatch when a
   * run is aborted, leaving an assistant turn whose calls nothing answered —
   * and this protocol refuses that history outright, on this message and every
   * one after it. The repair has to happen before the request leaves.
   */
  it('repairs a history a Stop left half-answered, instead of being refused', async () => {
    script = [
      delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'select_entity', arguments: '{}' } }] }, 'tool_calls'),
    ];
    const s = session();
    s.pushUser('do a thing');
    await drain(s);
    // …and nothing pushes the results: this is what an abort leaves behind.

    s.pushUser('never mind, do something else');
    script = [delta({ content: 'ok' }, 'stop')];
    await drain(s);

    const messages = received?.messages as { role: string; tool_call_id?: string }[];
    const answered = messages.filter((m) => m.role === 'tool');
    expect(answered).toHaveLength(1);
    expect(answered[0].tool_call_id).toBe('c1');
    // And it sits between the call and the next question, not after it.
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
  });

  it('sends an attached image as a data URL where the endpoint can see', async () => {
    script = [delta({ content: 'a red square' }, 'stop')];
    const s = session();
    s.pushUser('what is this?', [{ mediaType: 'image/png', data: 'AAAA' }]);
    await drain(s);

    const messages = received?.messages as { role: string; content: { type: string; image_url?: { url: string } }[] }[];
    expect(messages[1].content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });

  it('reports usage the endpoint only sends at the end', async () => {
    script = [
      delta({ content: 'hi' }, 'stop'),
      { id: 'x', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 2048, completion_tokens: 4 } },
    ];
    const s = session();
    s.pushUser('hi');
    const events = await drain(s);
    expect(events.find((e) => e.type === 'usage')).toEqual({ type: 'usage', inputTokens: 2048, outputTokens: 4 });
  });
});
