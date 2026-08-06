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
import type {
  AgentProvider, AgentSession, CatalogTool, StepEvent, ToolOutcome, UserImage,
} from './types';
import { ConversationLog, foldLine, type HistoryShape } from './conversation';
import { describeApiError, isTransientApiError } from './apiError';
import { DEFAULT_MODEL, DEFAULT_CONTEXT_WINDOW, DEFAULT_EFFORT } from '../../src/settings/agentIds';

/** Names this history's wire format on disk, so it is never resumed into
 *  another provider's session — see conversation.ts LogMemory. */
export const ANTHROPIC_FORMAT = 'anthropic';


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
  /** How far the conversation may grow before the oldest runs are folded away.
   *  The window knows which provider this is, so it is the side that says. */
  contextWindow?: number;
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

/**
 * What a tool result looks like on the wire.
 *
 * A screenshot reaches the model only where the endpoint takes images, and
 * whether it does is a property of the ENDPOINT, not of the editor — so the
 * substitution belongs to the provider rather than the kernel. It also SAYS what
 * happened: a model handed a silently dropped screenshot concludes the editor is
 * broken, while one told the endpoint cannot carry it asks a different way.
 *
 * Exported because the native branch cannot be exercised against a local
 * stand-in gateway — pointing at one is exactly what selects the other dialect.
 */
export function toolResultContent(
  outcome: ToolOutcome,
  dialect: Dialect,
): Anthropic.Beta.BetaToolResultBlockParam['content'] {
  if (!outcome.image) return outcome.content;
  if (dialect !== 'anthropic') {
    return `${outcome.content}\n[the screenshot could not be sent: this endpoint does not accept images]`;
  }
  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: outcome.image.mediaType as 'image/png',
        data: outcome.image.data,
      },
    },
    ...(outcome.content ? [{ type: 'text' as const, text: outcome.content }] : []),
  ];
}

/**
 * How the shared bookkeeping reads THIS format. Everything else about folding a
 * conversation is in conversation.ts, which is not about a wire format.
 */
export const ANTHROPIC_SHAPE: HistoryShape<Message> = {
  askedIn: (message) => {
    const content = message?.content;
    const text = typeof content === 'string'
      ? content
      : content?.find((b) => b.type === 'text')?.text ?? '';
    return foldLine(text);
  },
  foldNote: (text) => [
    { role: 'user', content: text },
    { role: 'assistant', content: 'Understood.' },
  ],
  weigh: (message) => (typeof message.content === 'string'
    ? message.content.length
    : JSON.stringify(message.content).length),
};

class AnthropicSession implements AgentSession {
  private readonly log: ConversationLog<Message>;
  /** Context waiting for a legal spot — see {@link flushContext}. */
  private readonly pending: string[] = [];

  constructor(
    private readonly client: Anthropic,
    private readonly opts: { model: string; effort: string; dialect: Dialect; contextWindow: number },
    private readonly system: string,
    private readonly tools: readonly CatalogTool[],
  ) {
    let fixedChars = system.length;
    for (const tool of tools) {
      fixedChars += tool.name.length + tool.description.length + JSON.stringify(tool.schema).length;
    }
    this.log = new ConversationLog(ANTHROPIC_SHAPE, { contextWindow: opts.contextWindow, fixedChars });
  }

  private get messages(): Message[] {
    return this.log.messages;
  }

  get turnIndex(): number {
    return this.log.turnIndex;
  }

  /**
   * Everything the model remembers, and nothing about how it got there.
   *
   * `pending` is deliberately absent: it holds context gathered for a turn that
   * has not been sent, which describes an editor state that will be re-gathered
   * anyway. Restoring it would replay a stale reading of the scene as if it were
   * current — the one thing the per-turn context exists to avoid.
   */
  serialize(): unknown {
    return this.log.serialize(ANTHROPIC_FORMAT);
  }

  /** Put a serialized memory back. Anything else leaves the session empty —
   *  see AgentProvider.createSession on why that beats refusing. */
  restore(memory: unknown): void {
    this.log.restore(memory, ANTHROPIC_FORMAT);
  }

  pushUser(text: string, images?: readonly UserImage[]): void {
    this.log.markTurnStart();
    if (!images?.length) {
      this.messages.push({ role: 'user', content: text });
      return;
    }
    // An endpoint that cannot carry images is TOLD, in the turn itself, rather
    // than quietly handed the text alone: a model that never learns a picture
    // was attached answers confidently about something it was not shown, and
    // the person watching has every reason to think it looked.
    if (this.opts.dialect !== 'anthropic') {
      const note = images.length === 1
        ? '[the user attached an image; this endpoint cannot receive images, so you have not seen it]'
        : `[the user attached ${images.length} images; this endpoint cannot receive images, so you have not seen them]`;
      this.messages.push({ role: 'user', content: `${text}\n\n${note}` });
      return;
    }
    // Images first: the question after them reads as being about them.
    this.messages.push({
      role: 'user',
      content: [
        ...images.map((im) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: im.mediaType as 'image/png',
            data: im.data,
          },
        })),
        ...(text ? [{ type: 'text' as const, text }] : []),
      ],
    });
  }

  rewindTo(n: number): void {
    // Refuses a run already folded away — its messages are gone.
    if (!this.log.rewindTo(n)) return;
    // Context buffered for a turn that is no longer going to happen.
    this.pending.length = 0;
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
        content: toolResultContent(o, this.opts.dialect),
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
    // Fold the oldest runs away BEFORE a call that would not fit, and report
    // both halves of it: what the model lost, and where that leaves the
    // conversation. The reading is stated here as well as after the answer
    // because this is the moment it moves DOWN, and a gauge that only ever
    // climbed would make the fold invisible in the one place it shows.
    const folded = this.log.compactIfNeeded();
    if (folded > 0) {
      yield { type: 'compacted', runs: folded };
      yield { type: 'context', used: this.log.contextUsed(), window: this.opts.contextWindow };
    }

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

    // Block index → tool id: argument deltas identify their block by index, and
    // only the block's start carries the id the rest of the system speaks in.
    const toolAt = new Map<number, string>();

    try {
      yield* this.consume(stream, toolAt);
    } catch (e) {
      // Rethrown, not swallowed — the kernel still has to end the turn. Only the
      // wording changes, and it changes HERE because this is the layer that
      // knows what an SDK error means.
      //
      // `retryable` is safe to act on for one reason: the history is appended
      // AFTER `finalMessage()` below, so a stream that died has left this
      // session exactly as it found it. Re-asking sends the same messages.
      const err = new Error(describeApiError(e)) as Error & { retryable?: boolean };
      err.retryable = isTransientApiError(e);
      throw err;
    }
  }

  private async *consume(
    stream: ReturnType<Anthropic['messages']['stream']> | ReturnType<Anthropic['beta']['messages']['stream']>,
    toolAt: Map<number, string>,
  ): AsyncIterable<StepEvent> {
    // What this call has already been REPORTED as costing. The editor sums the
    // usage events of a call, so reporting as we go means reporting deltas — and
    // the wire gives cumulative figures (message_start the whole input,
    // message_delta the output so far). Subtracting here keeps the arithmetic in
    // the layer that knows the wire, and leaves the store additive.
    let saidIn = 0;
    let saidOut = 0;
    const bill = (inTotal: number, outTotal: number): StepEvent | null => {
      const dIn = Math.max(0, inTotal - saidIn);
      const dOut = Math.max(0, outTotal - saidOut);
      if (dIn === 0 && dOut === 0) return null;
      saidIn += dIn;
      saidOut += dOut;
      return { type: 'usage', inputTokens: dIn, outputTokens: dOut };
    };

    for await (const event of stream) {
      // The input is known before a single token comes back, and waiting for the
      // response to finish before saying so left the run header blank for the
      // whole wait — which is exactly when someone is looking at it to find out
      // what this is going to cost.
      if (event.type === 'message_start') {
        const u = bill(event.message.usage?.input_tokens ?? 0, event.message.usage?.output_tokens ?? 0);
        if (u) yield u;
        continue;
      }
      // Output as it accrues, so the counter moves while the answer is written.
      if (event.type === 'message_delta') {
        const u = bill(saidIn, event.usage?.output_tokens ?? 0);
        if (u) yield u;
        continue;
      }
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          toolAt.set(event.index, block.id);
          // An announcement, not a call: the kernel dispatches `tool_call`, and
          // sharing the type here would run every tool twice.
          yield { type: 'tool_pending', id: block.id, name: block.name };
        }
        continue;
      }
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
      else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: event.delta.thinking };
      else if (event.delta.type === 'input_json_delta') {
        const id = toolAt.get(event.index);
        if (id) yield { type: 'tool_args', id, delta: event.delta.partial_json };
      }
    }

    const message = await stream.finalMessage();
    // Verbatim — thinking blocks and all. See the file header.
    this.messages.push({ role: 'assistant', content: message.content as Message['content'] });

    if (message.usage) {
      this.log.lastInputTokens = message.usage.input_tokens ?? this.log.lastInputTokens;
      // Whatever the stream did not already account for. Usually nothing — but
      // an endpoint that reports usage only at the end still gets it all here,
      // and one that over-reported mid-stream is not charged twice.
      const settle = bill(message.usage.input_tokens ?? 0, message.usage.output_tokens ?? 0);
      if (settle) yield settle;
    }
    // Where the conversation stands now — separate from `usage`, which is what
    // this one call cost. A level and a cost project differently (the editor
    // replaces one and sums the other), and an endpoint that reports no usage
    // at all still has a context this can answer for from the estimate.
    yield { type: 'context', used: this.log.contextUsed(), window: this.opts.contextWindow };

    // Again, now with the PARSED arguments — the streamed deltas are display
    // text, and the kernel needs a real object to dispatch. The editor treats a
    // second call for a known id as an update, not a second row.
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
    // The same condition toolResultContent substitutes on — one fact, one place.
    acceptsImages: dialect === 'anthropic',
    createSession: ({ system, tools }, memory) => {
      const session = new AnthropicSession(
        client,
        { model, effort, dialect, contextWindow: options.contextWindow || DEFAULT_CONTEXT_WINDOW },
        system,
        tools,
      );
      if (memory !== undefined) session.restore(memory);
      return session;
    },
  };
}
