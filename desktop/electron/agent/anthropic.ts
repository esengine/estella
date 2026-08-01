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
 *
 * It speaks two DIALECTS of one wire format. The Messages API shape is
 * implemented by other vendors, but the things this provider leans on —
 * adaptive thinking, effort, top-level cache_control, server-side fallbacks,
 * mid-conversation system messages — are Anthropic's extensions, not the
 * format's. A gateway handed one either ignores it (so the code claims a
 * behaviour that is not happening, and the bill says otherwise) or rejects the
 * request outright. So `baseURL` selects the dialect, and the compatible one
 * sends the core format and nothing else.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AgentProvider, AgentSession, CatalogTool, StepEvent, ToolOutcome } from './types';
import { DEFAULT_MODEL } from '../../src/settings/agentIds';

/** Agentic work is what `xhigh` is for; it is also the depth Claude Code runs at. */
export const DEFAULT_EFFORT = 'xhigh';

/**
 * Which extensions a session may use.
 *
 * Named after what it is rather than after a vendor: the second one is "the
 * Messages API as published", and any gateway implementing it qualifies.
 */
export type Dialect = 'anthropic' | 'compatible';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Point at an Anthropic-compatible gateway; omit for the API. Its presence
   *  is what drops the request to the core wire format — see the file header. */
  baseURL?: string;
}

type Message = Anthropic.Beta.BetaMessageParam;

/** Streaming, so the ceiling can be generous: a turn that plans and edits a
 *  whole panel needs room, and a truncated turn wastes the work before it. */
const MAX_TOKENS = 64000;

interface StepRequest {
  model: string;
  max_tokens: number;
  system: string;
  tools: { name: string; description: string; input_schema: unknown }[];
  messages: readonly Message[];
  output_config: { effort: string };
  [extension: string]: unknown;
}

/**
 * The body for one step. Pure and exported because the dialect split is the one
 * thing in this file that is not a passthrough to the SDK, and shipping an
 * Anthropic-only field to a gateway fails in the two ways that are hardest to
 * notice: silently ignored, or billed differently than the code says.
 */
export function buildStepRequest(opts: {
  dialect: Dialect;
  model: string;
  effort: string;
  system: string;
  tools: readonly CatalogTool[];
  messages: readonly Message[];
}): StepRequest {
  const request: StepRequest = {
    model: opts.model,
    max_tokens: MAX_TOKENS,
    system: opts.system,
    // The whole point of the catalog being stable and ordered: tools render
    // first in the prefix, so an unchanging list is what makes caching work at
    // all — where there is caching.
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    })),
    messages: opts.messages,
    // Effort is the one control that survives the trip: it is a request-level
    // hint a gateway can honour or ignore without changing what comes back.
    output_config: { effort: opts.effort },
  };
  if (opts.dialect === 'compatible') return request;

  // Adaptive is on by default on this model; say it anyway so the summary
  // opt-in has something to attach to. `display` matters because the editor
  // renders reasoning — the default returns empty thinking blocks, which reads
  // to a user as a long silence before anything happens.
  request.thinking = { type: 'adaptive', display: 'summarized' };
  // Top-level auto-caching keeps the growing conversation warm.
  request.cache_control = { type: 'ephemeral' };
  // A safety classifier can decline a request that is perfectly ordinary for a
  // game editor (a "spawn an enemy attack" prompt reads differently out of
  // context). Let the API re-run it on the recommended fallback instead of
  // handing the user a dead turn.
  request.betas = ['server-side-fallback-2026-07-01'];
  request.fallbacks = 'default';
  return request;
}

class AnthropicSession implements AgentSession {
  private readonly messages: Message[] = [];
  /** Context waiting for a legal spot — see {@link flushContext}. */
  private readonly pending: string[] = [];

  constructor(
    private readonly client: Anthropic,
    private readonly opts: { model: string; effort: string; dialect: Dialect },
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
   * Land buffered context after the history rather than by rewriting the system
   * prompt. The prompt sits at the FRONT of the cached prefix, so editing it per
   * turn re-bills the whole conversation.
   *
   * Which shape depends on the dialect. Anthropic takes a `role: "system"`
   * message, which is the operator channel and cannot be spoofed by anything
   * that writes user content. A gateway implements two roles and no more, so
   * the same text rides along as an extra block on the user turn — legal in the
   * core format, still after the cached prefix, but it IS user-role text and
   * carries no more authority than the rest of that turn.
   *
   * Placement is constrained either way: it must follow a user turn. That holds
   * here — the kernel always appends the user turn or a tool-result turn before
   * stepping — but hold the text rather than emitting an invalid message if
   * that ever stops being true.
   */
  private flushContext(): void {
    if (this.pending.length === 0) return;
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'user') return;
    const text = this.pending.join('\n\n');

    if (this.opts.dialect === 'anthropic') {
      this.messages.push({ role: 'system', content: text });
    } else {
      const blocks = typeof last.content === 'string'
        ? [{ type: 'text' as const, text: last.content }]
        : [...last.content];
      last.content = [...blocks, { type: 'text' as const, text }];
    }
    this.pending.length = 0;
  }

  async *step(signal: AbortSignal): AsyncIterable<StepEvent> {
    this.flushContext();

    const request = buildStepRequest({
      dialect: this.opts.dialect,
      model: this.opts.model,
      effort: this.opts.effort,
      system: this.system,
      tools: this.tools,
      messages: this.messages,
    });

    // The beta surface only for the dialect that has beta features in the
    // request: it posts to `/v1/messages?beta=true`, and a query string a
    // gateway never advertised is not worth spending on a request that carries
    // no betas anyway. The cast is sound in this branch — a `role: "system"`
    // message is only ever appended in the Anthropic dialect.
    const stream = this.opts.dialect === 'anthropic'
      ? this.client.beta.messages.stream(request as never, { signal })
      : this.client.messages.stream(request as never, { signal });

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
      else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: event.delta.thinking };
    }

    const message = await stream.finalMessage();
    // Verbatim — thinking blocks and all. See the file header.
    this.messages.push({ role: 'assistant', content: message.content as Message['content'] });

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
  const model = options.model || DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const baseURL = options.baseURL || undefined;
  const dialect: Dialect = baseURL ? 'compatible' : 'anthropic';
  const client = new Anthropic({ apiKey: options.apiKey, baseURL });
  return {
    id: dialect === 'anthropic' ? 'anthropic' : `compatible:${baseURL ?? ''}`,
    model,
    createSession: ({ system, tools }) =>
      new AnthropicSession(client, { model, effort, dialect }, system, tools),
  };
}
