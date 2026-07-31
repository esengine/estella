// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    anthropic.ts
 * @brief   The reference AgentProvider. Owns the wire format and the message
 *          history; knows nothing about tool tiers, checkpoints or the editor.
 *
 * It keeps the raw `content` blocks the API returned and replays them verbatim,
 * because two things depend on it: thinking blocks have to come back unchanged
 * on the same model, and the cached prefix is a BYTE match — a history
 * normalised into a neutral shape and rebuilt would break both, which is why
 * this class exists instead of a translation layer in the kernel.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AgentProvider, AgentSession, CatalogTool, StepEvent, ToolOutcome } from './types';

/** The default. Opus-tier because this drives a real project: a wrong edit costs
 *  the user their scene, and the checkpoint only helps if the plan was sane. */
export const DEFAULT_MODEL = 'claude-opus-5';

/** Agentic work is what `xhigh` is for; it is also the depth Claude Code runs at. */
export const DEFAULT_EFFORT = 'xhigh';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Point at an Anthropic-compatible gateway; omit for the API. */
  baseURL?: string;
}

type Message = Anthropic.Beta.BetaMessageParam;

class AnthropicSession implements AgentSession {
  private readonly messages: Message[] = [];
  /** Context waiting for a legal spot — see {@link flushContext}. */
  private readonly pending: string[] = [];

  constructor(
    private readonly client: Anthropic,
    private readonly opts: Required<Omit<AnthropicOptions, 'baseURL'>>,
    private readonly system: string,
    private readonly tools: readonly CatalogTool[],
  ) {}

  pushUser(text: string): void {
    this.messages.push({ role: 'user', content: text });
  }

  pushContext(text: string): void {
    this.pending.push(text);
  }

  pushToolResults(outcomes: readonly ToolOutcome[]): void {
    // Every result of a round in ONE user message. Splitting them across
    // messages teaches the model to stop asking for tools in parallel.
    this.messages.push({
      role: 'user',
      content: outcomes.map((o) => ({
        type: 'tool_result' as const,
        tool_use_id: o.id,
        content: o.content,
        is_error: o.isError,
      })),
    });
  }

  /**
   * Land buffered context as a `role: "system"` message rather than by rewriting
   * the system prompt. The prompt sits at the FRONT of the cached prefix, so
   * editing it per turn re-bills the whole conversation; a system message sits
   * after the history and leaves the cache intact.
   *
   * Placement is constrained: it may not be the first message, and it must
   * follow a user turn. Both hold here — the kernel always appends the user turn
   * or a tool-result turn before stepping — but hold the text rather than
   * emitting an invalid message if that ever stops being true.
   */
  private flushContext(): void {
    if (this.pending.length === 0) return;
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'user') return;
    this.messages.push({ role: 'system', content: this.pending.join('\n\n') });
    this.pending.length = 0;
  }

  async *step(signal: AbortSignal): AsyncIterable<StepEvent> {
    this.flushContext();

    const stream = this.client.beta.messages.stream({
      model: this.opts.model,
      // Streaming, so the ceiling can be generous: a turn that plans and edits a
      // whole panel needs room, and a truncated turn wastes the work before it.
      max_tokens: 64000,
      // Adaptive is on by default on this model; say it anyway so the summary
      // opt-in has something to attach to. `display` matters because the editor
      // renders reasoning — the default returns empty thinking blocks, which
      // reads to a user as a long silence before anything happens.
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: this.opts.effort },
      // The whole point of the catalog being stable and ordered: tools render
      // first in the prefix, so an unchanging list is what makes the cache work
      // at all. Top-level auto-caching then keeps the growing conversation warm.
      cache_control: { type: 'ephemeral' },
      system: this.system,
      tools: this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema as Anthropic.Beta.BetaTool['input_schema'],
      })),
      messages: this.messages,
      // A safety classifier can decline a request that is perfectly ordinary for
      // a game editor (a "spawn an enemy attack" prompt reads differently out of
      // context). Let the API re-run it on the recommended fallback instead of
      // handing the user a dead turn.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }, { signal });

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
      else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: event.delta.thinking };
    }

    const message = await stream.finalMessage();
    // Verbatim — thinking blocks and all. See the file header.
    this.messages.push({ role: 'assistant', content: message.content });

    if (message.usage) {
      yield {
        type: 'usage',
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
      };
    }

    for (const block of message.content) {
      if (block.type !== 'tool_use') continue;
      yield {
        type: 'tool_call',
        call: {
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        },
      };
    }

    // Checked AFTER the blocks are replayed: a refusal can arrive mid-output,
    // and what was already produced still belongs in the history.
    yield { type: 'stop', reason: stopReason(message.stop_reason) };
  }
}

function stopReason(raw: string | null): Extract<StepEvent, { type: 'stop' }>['reason'] {
  switch (raw) {
    case 'tool_use': return 'tool_use';
    case 'refusal': return 'refusal';
    case 'max_tokens': return 'max_tokens';
    default: return 'end_turn';
  }
}

export function createAnthropicProvider(options: AnthropicOptions): AgentProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL });
  return {
    id: 'anthropic',
    model,
    createSession: ({ system, tools }) =>
      new AnthropicSession(client, { apiKey: options.apiKey, model, effort }, system, tools),
  };
}
