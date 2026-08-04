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
import {
  DEFAULT_MODEL, DEFAULT_CONTEXT_WINDOW, KEEP_WHOLE_RUNS, shouldCompact,
} from '../../src/settings/agentIds';

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
 * What went wrong, said to the person who has to decide what to do about it.
 *
 * The SDK's own message is written for whoever is reading a stack trace — it
 * names a status code and a URL. In the transcript the only useful content is
 * which of four situations this is, because each has a different answer: wait,
 * fix the key, check the address, or nothing (it already retried).
 *
 * Exported so the phrasing is pinned by a test rather than by whichever error
 * happens to occur first in production.
 */
/** The SDK hands back a `Headers` on some paths and a plain object on others;
 *  reading only one shape is how the useful half of a 429 goes missing. */
function headerOf(error: unknown, name: string): string | undefined {
  const headers = (error as { headers?: unknown })?.headers;
  if (!headers) return undefined;
  const get = (headers as Headers).get;
  if (typeof get === 'function') return (headers as Headers).get(name) ?? undefined;
  return (headers as Record<string, string>)[name];
}

export function describeApiError(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const raw = (error as Error)?.message ?? String(error);
  const retryAfter = Number(headerOf(error, 'retry-after'));

  if (status === 429) {
    // The SDK has already retried this with backoff by the time it reaches us,
    // so "try again" is not advice — how long to wait is.
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `Rate limited, and the automatic retries did not clear it. The endpoint asks for ${retryAfter}s.`
      : 'Rate limited, and the automatic retries did not clear it. Wait a moment and send again.';
  }
  if (status === 401 || status === 403) {
    return 'The endpoint rejected the API key. Check it in Settings › AI Agents.';
  }
  if (status === 404) {
    return 'The endpoint has no such model, or the address is wrong. Check both in Settings › AI Agents.';
  }
  if (status === 400) return `The endpoint refused the request: ${raw}`;
  if (status && status >= 500) return 'The endpoint is having trouble. Nothing is wrong on this side — try again shortly.';
  // Not an HTTP failure at all: DNS, offline, a gateway that is not running.
  if (!status) return `Could not reach the endpoint: ${raw}`;
  return raw;
}

/**
 * Fold the oldest runs into one note, keeping what the PERSON said.
 *
 * A conversation grows mostly by tool traffic — a scene tree, a diagnostics
 * list, the reasoning about them — and almost none of that is worth carrying
 * once the edits have landed. The intent is: "make it feel like dusk" governs
 * the ninth run as much as the first. So the person's own words survive verbatim
 * and everything around them becomes a line.
 *
 * Structural rather than model-written: asking a model to summarise costs a call
 * and a wait at exactly the moment the conversation is already long, and the
 * facts worth keeping (what was asked) are ones already held exactly.
 *
 * Pure and exported for the reason buildStepRequest is: it rewrites the history
 * everything else depends on, and the bookkeeping — turn COORDINATES outliving
 * the messages they named — is the part worth pinning by test rather than by
 * whichever long conversation happens to hit it first.
 *
 * @returns the rewritten history, or null when there is not enough to fold.
 */
export function compactHistory(
  messages: readonly Message[],
  turnStarts: readonly number[],
  dropped: number,
  keepRuns: number,
  folded: readonly string[] = [],
): { messages: Message[]; turnStarts: number[]; dropped: number; folded: string[] } | null {
  const cut = turnStarts.length - keepRuns;
  if (cut <= 0) return null;
  const at = turnStarts[cut];
  // Everything ever folded, not only this pass. The note a fold produces is NOT
  // in turnStarts, so the next one splices straight over it — carrying the asks
  // in a value of their own is what stops the oldest request disappearing one
  // compaction at a time. (Caught against a real gateway: the first fold kept
  // "remember the passphrase", the second silently ate it.)
  const asked = [
    ...folded,
    ...turnStarts.slice(0, cut).map((start, i) => `${dropped + i + 1}. ${firstText(messages[start])}`),
  ];
  // A conversation folded many times would otherwise grow a note that is itself
  // the problem. The oldest go first: their edits are furthest downstream.
  const shown = asked.length > MAX_FOLDED_ASKS
    ? [`(${asked.length - MAX_FOLDED_ASKS} earlier requests omitted)`, ...asked.slice(-MAX_FOLDED_ASKS)]
    : asked;
  const note = 'Earlier in this conversation you were asked, in order:\n'
    + `${shown.join('\n')}\n`
    + 'The tool calls and results from those runs were dropped to keep this conversation '
    + 'inside its context window. Whatever they changed is in the scene — read it back if '
    + 'you need the current state rather than trusting this summary.';
  const kept: Message[] = [
    { role: 'user', content: note },
    { role: 'assistant', content: 'Understood.' },
    ...messages.slice(at),
  ];
  const shift = at - 2;
  return {
    messages: kept,
    turnStarts: turnStarts.slice(cut).map((s) => s - shift),
    // Coordinates count from the start of the CONVERSATION, not of what is left.
    dropped: dropped + cut,
    folded: asked,
  };
}

/** How many past requests the note quotes before it elides the oldest. */
const MAX_FOLDED_ASKS = 20;

/**
 * What a person's turn said, as one line for the compaction note.
 *
 * The FIRST text block only. A turn is pushed as a plain string and then gets
 * the editor context appended as a second block (flushContext), which is the
 * same paragraph every turn — joining them would quote the state of the editor
 * once per folded run and bury the sentence that was actually said.
 */
function firstText(message: Message | undefined): string {
  const content = message?.content;
  const text = typeof content === 'string'
    ? content
    : content?.find((b) => b.type === 'text')?.text ?? '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '(no text)';
  return flat.length > 200 ? `${flat.slice(0, 197)}…` : flat;
}

/** What a conversation's memory looks like on disk. Versioned: a shape this
 *  does not recognise is refused rather than half-read. */
interface SessionMemory {
  v: 1;
  messages: Message[];
  turnStarts: number[];
  dropped: number;
  folded: string[];
  lastInputTokens: number;
}

const isSessionMemory = (value: unknown): value is SessionMemory => {
  const m = value as Partial<SessionMemory> | null;
  return !!m && m.v === 1 && Array.isArray(m.messages) && Array.isArray(m.turnStarts)
    && typeof m.dropped === 'number' && Array.isArray(m.folded);
};

class AnthropicSession implements AgentSession {
  private messages: Message[] = [];
  /** Context waiting for a legal spot — see {@link flushContext}. */
  private readonly pending: string[] = [];
  /** Where each person's turn starts. A tool result is a `user` message too, so
   *  counting roles would not find them. */
  private turnStarts: number[] = [];
  /** Runs folded away by {@link compactOldest}. Turn coordinates count from the
   *  start of the CONVERSATION, so they must survive their messages. */
  private dropped = 0;
  /** What was asked in every folded run, oldest first — see compactHistory. */
  private folded: string[] = [];
  /** What the last call was billed for its input. Authoritative WHERE it counts
   *  the whole request — see {@link contextUsed}, which does not assume it does. */
  private lastInputTokens = 0;

  constructor(
    private readonly client: Anthropic,
    private readonly opts: { model: string; effort: string; dialect: Dialect; contextWindow: number },
    private readonly system: string,
    private readonly tools: readonly CatalogTool[],
  ) {}

  get turnIndex(): number {
    return this.dropped + this.turnStarts.length;
  }

  /**
   * Everything the model remembers, and nothing about how it got there.
   *
   * `pending` is deliberately absent: it holds context gathered for a turn that
   * has not been sent, which describes an editor state that will be re-gathered
   * anyway. Restoring it would replay a stale reading of the scene as if it were
   * current — the one thing the per-turn context exists to avoid.
   */
  serialize(): SessionMemory {
    return {
      v: 1,
      messages: this.messages,
      turnStarts: this.turnStarts,
      dropped: this.dropped,
      folded: this.folded,
      lastInputTokens: this.lastInputTokens,
    };
  }

  /** Put a serialized memory back. Anything else leaves the session empty —
   *  see AgentProvider.createSession on why that beats refusing. */
  restore(memory: unknown): void {
    if (!isSessionMemory(memory)) return;
    this.messages = memory.messages;
    this.turnStarts = memory.turnStarts;
    this.dropped = memory.dropped;
    this.folded = memory.folded;
    this.lastInputTokens = memory.lastInputTokens ?? 0;
  }

  pushUser(text: string, images?: readonly UserImage[]): void {
    this.turnStarts.push(this.messages.length);
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
    const at = this.turnStarts[n - this.dropped];
    // Rewinding into runs that have already been folded away is not something
    // this can do — their messages are gone. Refusing beats half-doing it.
    if (at === undefined) return;
    this.messages.length = at;
    this.turnStarts.length = n - this.dropped;
    // Context buffered for a turn that is no longer going to happen.
    this.pending.length = 0;
  }

  /**
   * How full the context is, in tokens — the larger of what the endpoint billed
   * and what this conversation obviously weighs.
   *
   * Measured against a real gateway, `input_tokens` is NOT always the whole
   * request: DeepSeek reported 33 for a first turn whose system prompt and 75
   * tool schemas are thousands, so trusting it alone meant compaction would
   * never fire and the conversation would hit the wall it exists to prevent.
   * Nor can the estimate simply replace it — chars/4 is a rule of thumb that
   * under-counts CJK badly, which is most of what this editor's users type.
   *
   * So: whichever is bigger. Both err by under-reporting, and the cost of
   * over-reporting is one compaction that was not needed yet.
   */
  private contextUsed(): number {
    let chars = this.system.length;
    for (const tool of this.tools) {
      chars += tool.name.length + tool.description.length + JSON.stringify(tool.schema).length;
    }
    for (const message of this.messages) {
      chars += typeof message.content === 'string'
        ? message.content.length
        : JSON.stringify(message.content).length;
    }
    return Math.max(this.lastInputTokens, Math.ceil(chars / 4));
  }

  /**
   * Fold the oldest runs away if this conversation has outgrown its budget.
   *
   * @returns how many runs went, 0 when none did. The caller SAYS it — a
   *          conversation losing part of its memory with nothing on screen to
   *          show for it is the thing this number exists to end.
   */
  private compactIfNeeded(): number {
    if (!shouldCompact(this.contextUsed(), this.opts.contextWindow)) return 0;
    const next = compactHistory(
      this.messages, this.turnStarts, this.dropped, KEEP_WHOLE_RUNS, this.folded,
    );
    if (!next) return 0;
    const runs = next.dropped - this.dropped;
    this.messages.splice(0, this.messages.length, ...next.messages);
    this.turnStarts.splice(0, this.turnStarts.length, ...next.turnStarts);
    this.dropped = next.dropped;
    this.folded = next.folded;
    // What the endpoint billed describes a history that no longer exists, and
    // it is the LARGER half of contextUsed() on an honest endpoint. Left in
    // place it would report the conversation as still full immediately after
    // emptying it: no visible drop, and the next step would fold again for a
    // reason that had already been dealt with. The estimate carries the reading
    // until the next call reports a real one.
    this.lastInputTokens = 0;
    return runs;
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
    const folded = this.compactIfNeeded();
    if (folded > 0) {
      yield { type: 'compacted', runs: folded };
      yield { type: 'context', used: this.contextUsed(), window: this.opts.contextWindow };
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
      throw new Error(describeApiError(e));
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
      this.lastInputTokens = message.usage.input_tokens ?? this.lastInputTokens;
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
    yield { type: 'context', used: this.contextUsed(), window: this.opts.contextWindow };

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
