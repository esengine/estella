// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openai.ts
 * @brief   The Chat Completions AgentProvider — OpenAI's protocol, and every
 *          endpoint that implements it.
 *
 * A sibling of anthropic.ts rather than a third dialect of it. Those two are
 * dialects of ONE format; this is a different one, and the differences are not
 * cosmetic: tool calls arrive as a field on the assistant message with their
 * arguments as a STRING, each result goes back as its own `role: "tool"`
 * message, and the stream carries untyped deltas that have to be stitched by
 * index. Folded into the same file, every function would be a two-way branch.
 *
 * What it does share is the bookkeeping — folding old runs away, reading how
 * full the context is, saying what an HTTP failure means — because none of that
 * is about a wire format. See conversation.ts and apiError.ts.
 *
 * Three things about this protocol that the Anthropic one does not have, and
 * that each cost a turn when missed:
 *
 *   · An assistant message carrying `tool_calls` MUST be followed by a `tool`
 *     message for every one of them, or the next request is refused outright.
 *     The kernel abandons a round mid-dispatch when the user hits Stop, so this
 *     reconciles before it sends — see {@link answerOrphanedCalls}.
 *   · Reasoning comes back (`reasoning_content`, or `reasoning` on some
 *     gateways) and must NOT go back: the endpoints that send it reject it as
 *     input. The exact opposite of Anthropic's thinking blocks.
 *   · Usage is not streamed unless it is asked for, and asking is a request
 *     field a strict gateway may not know.
 */
import OpenAI from 'openai';
import type {
  AgentProvider, AgentSession, CatalogTool, StepEvent, ToolOutcome, UserImage,
} from './types';
import { ConversationLog, foldLine, type HistoryShape } from './conversation';
import { describeApiError, isTransientApiError } from './apiError';
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_EFFORT, type AgentEffort } from '../../src/settings/agentIds';

/** Names this history's wire format on disk — see conversation.ts LogMemory. */
export const OPENAI_FORMAT = 'openai';

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

/** Streaming, so the ceiling can be generous — the same reasoning as the
 *  Anthropic provider's: a truncated turn wastes the work before it. */
const MAX_TOKENS = 32000;

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  /** Where Chat Completions lives. Omitted = OpenAI's own API. */
  baseURL?: string;
  effort?: AgentEffort;
  contextWindow?: number;
  /**
   * Whether this endpoint's model can see. Declared rather than probed: finding
   * out costs a call spent on a screenshot the model will be told it cannot
   * look at, and the answer is a property of the endpoint, not of the editor.
   *
   * The editor always says (src/agent/providers.ts declares it per provider);
   * omitted falls back to the address, for a caller with nothing to declare.
   */
  vision?: boolean;
  /**
   * Send `reasoning_effort`. Off for an endpoint that would refuse an argument
   * it has never heard of — a rejected request is worse than an ignored field,
   * and which one you get is not knowable from here.
   */
  reasoningEffort?: boolean;
}

/**
 * How hard to think, in this protocol's vocabulary.
 *
 * The editor's five depths do not map one-to-one onto the four this field
 * takes, and the two ends are what matter: `low` must stay cheap, and the
 * agentic default must land on the deepest thing the endpoint offers.
 */
const EFFORT: Record<AgentEffort, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
};

/**
 * The body for one step.
 *
 * Pure and exported for the reason the Anthropic one is: it is where a field
 * that an endpoint silently ignores costs a behaviour the code claims to have.
 */
export function buildChatRequest(opts: {
  model: string;
  effort: AgentEffort;
  reasoningEffort: boolean;
  system: string;
  tools: readonly CatalogTool[];
  messages: readonly Message[];
}): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
  const request = {
    model: opts.model,
    // Not a top-level parameter here — the system prompt is the first message,
    // and it is prepended per request rather than kept in the history so that
    // the history's indices mean the same thing they do in the other provider
    // (the fold in conversation.ts counts messages, and a system message at
    // index 0 would shift every turn start by one).
    messages: [{ role: 'system', content: opts.system }, ...opts.messages] as Message[],
    // The whole point of the catalog being stable and ordered: tools render
    // first, so an unchanging list is what makes prompt caching work at all —
    // where there is caching.
    tools: opts.tools.map((t): Tool => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema },
    })),
    max_completion_tokens: MAX_TOKENS,
    stream: true,
    // Usage is not streamed unless asked for. Without it the context meter runs
    // entirely on the character estimate, which under-counts CJK badly — and
    // CJK is most of what this editor's users type.
    stream_options: { include_usage: true },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  if (opts.reasoningEffort) {
    (request as { reasoning_effort?: string }).reasoning_effort = EFFORT[opts.effort];
  }
  return request;
}

/**
 * What a tool result looks like on the wire: one message per call.
 *
 * Anthropic takes every result of a round as blocks of ONE user message; here
 * they are separate messages, and every id the assistant asked about must get
 * one back.
 */
function toolMessage(outcome: ToolOutcome, vision: boolean): Message {
  const content = outcome.image && !vision
    ? `${outcome.content}\n[the screenshot could not be sent: this endpoint does not accept images]`
    : outcome.content;
  // The image itself cannot ride on a `tool` message in this protocol — it is
  // text-only — so a followed-up user message carries it. See pushToolResults.
  return { role: 'tool', tool_call_id: outcome.id, content: content || '(no output)' };
}

/** A person's attachment, or a tool's rendered frame, as a content part. */
const imagePart = (im: { data: string; mediaType: string }): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
  type: 'image_url',
  image_url: { url: `data:${im.mediaType};base64,${im.data}` },
});

/**
 * Give every unanswered `tool_calls` id a result, so the history is one this
 * protocol will accept.
 *
 * The kernel abandons a round mid-dispatch when the run is aborted — it breaks
 * out of the loop and never pushes the results — which leaves an assistant
 * message asking for tools that nothing answers. Anthropic tolerates that;
 * Chat Completions refuses the whole request, so the NEXT message after a Stop
 * would fail and keep failing, with nothing on screen linking it to the Stop.
 *
 * Exported because it is the one piece of this file that only ever runs after
 * something went wrong, which is the worst way to find out it is broken.
 */
export function answerOrphanedCalls(messages: Message[]): number {
  let added = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const calls = message.tool_calls;
    if (!calls?.length) break; // the last assistant turn asked for nothing
    const answered = new Set<string>();
    // The results already back sit in a run directly after the call, and the
    // made-up ones join the END of it: inserted before, they would put a
    // result ahead of one that actually happened.
    let at = i + 1;
    for (let j = i + 1; j < messages.length; j++) {
      const later = messages[j];
      if (later.role !== 'tool') break;
      answered.add(later.tool_call_id);
      at = j + 1;
    }
    const missing = calls.filter((c) => !answered.has(c.id));
    if (missing.length === 0) break;
    messages.splice(at, 0, ...missing.map((c): Message => ({
      role: 'tool',
      tool_call_id: c.id,
      content: '(the run was interrupted before this tool ran)',
    })));
    added = missing.length;
    break;
  }
  return added;
}

/**
 * Append editor context — a diagnostics feed, a nudge, a verdict's failures —
 * as a USER turn. A mid-conversation `system` message is legal in this protocol
 * and is not carried by every endpoint that speaks it: one delivered the turn
 * with no content at all, and the model answered that the message was empty.
 */
export function pushContextMessage(messages: Message[], text: string): void {
  messages.push({ role: 'user', content: text });
}

const SHAPE: HistoryShape<Message> = {
  askedIn: (message) => {
    const content = message?.content;
    if (typeof content === 'string') return foldLine(content);
    const text = Array.isArray(content)
      ? content.find((p) => p.type === 'text')?.text ?? ''
      : '';
    return foldLine(text);
  },
  foldNote: (text) => [
    { role: 'user', content: text },
    { role: 'assistant', content: 'Understood.' },
  ],
  weigh: (message) => (typeof message.content === 'string'
    ? message.content.length
    : JSON.stringify(message.content ?? '').length),
};

class OpenAISession implements AgentSession {
  private readonly log: ConversationLog<Message>;
  /** Context waiting for a legal spot — see {@link flushContext}. */
  private readonly pending: string[] = [];

  constructor(
    private readonly client: OpenAI,
    private readonly opts: {
      model: string;
      effort: AgentEffort;
      reasoningEffort: boolean;
      vision: boolean;
      contextWindow: number;
    },
    private readonly system: string,
    private readonly tools: readonly CatalogTool[],
  ) {
    let fixedChars = system.length;
    for (const tool of tools) {
      fixedChars += tool.name.length + tool.description.length + JSON.stringify(tool.schema).length;
    }
    this.log = new ConversationLog(SHAPE, { contextWindow: opts.contextWindow, fixedChars });
  }

  private get messages(): Message[] {
    return this.log.messages;
  }

  get turnIndex(): number {
    return this.log.turnIndex;
  }

  serialize(): unknown {
    return this.log.serialize(OPENAI_FORMAT);
  }

  restore(memory: unknown): void {
    this.log.restore(memory, OPENAI_FORMAT);
  }

  pushUser(text: string, images?: readonly UserImage[]): void {
    this.log.markTurnStart();
    if (!images?.length) {
      this.messages.push({ role: 'user', content: text });
      return;
    }
    if (!this.opts.vision) {
      // Told, in the turn itself, rather than quietly handed the text alone: a
      // model that never learns a picture was attached answers confidently
      // about something it was not shown.
      const note = images.length === 1
        ? '[the user attached an image; this endpoint cannot receive images, so you have not seen it]'
        : `[the user attached ${images.length} images; this endpoint cannot receive images, so you have not seen them]`;
      this.messages.push({ role: 'user', content: `${text}\n\n${note}` });
      return;
    }
    // Images first: the question after them reads as being about them.
    this.messages.push({
      role: 'user',
      content: [...images.map(imagePart), ...(text ? [{ type: 'text' as const, text }] : [])],
    });
  }

  rewindTo(n: number): void {
    if (!this.log.rewindTo(n)) return;
    this.pending.length = 0;
  }

  pushContext(text: string): void {
    this.pending.push(text);
  }

  pushToolResults(outcomes: readonly ToolOutcome[]): void {
    for (const outcome of outcomes) this.messages.push(toolMessage(outcome, this.opts.vision));
    // A rendered frame cannot ride on a `tool` message — this protocol's are
    // text-only — so the frames of the round follow as one user message. Kept
    // to the round rather than attached to each result for the same reason the
    // Anthropic provider batches: splitting a round across messages teaches the
    // model to stop asking for tools in parallel.
    if (!this.opts.vision) return;
    const frames = outcomes.filter((o) => o.image);
    if (frames.length === 0) return;
    this.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: frames.length === 1 ? 'The frame that tool captured:' : 'The frames those tools captured:' },
        ...frames.map((o) => imagePart(o.image!)),
      ],
    });
  }

  private flushContext(): void {
    if (this.pending.length === 0) return;
    pushContextMessage(this.messages, this.pending.join('\n\n'));
    this.pending.length = 0;
  }

  async *step(signal: AbortSignal): AsyncIterable<StepEvent> {
    // Before anything else: a history this protocol would refuse is one no
    // amount of retrying fixes.
    answerOrphanedCalls(this.messages);
    this.flushContext();

    const folded = this.log.compactIfNeeded();
    if (folded > 0) {
      yield { type: 'compacted', runs: folded };
      yield { type: 'context', used: this.log.contextUsed(), window: this.opts.contextWindow };
    }

    const request = buildChatRequest({
      model: this.opts.model,
      effort: this.opts.effort,
      reasoningEffort: this.opts.reasoningEffort,
      system: this.system,
      tools: this.tools,
      messages: this.messages,
    });

    try {
      yield* this.consume(await this.client.chat.completions.create(request, { signal }));
    } catch (e) {
      // Rethrown, not swallowed — the kernel still has to end the turn. Safe to
      // mark retryable because the history is appended only AFTER the stream
      // completes: a call that died left this session as it found it.
      const err = new Error(describeApiError(e)) as Error & { retryable?: boolean };
      err.retryable = isTransientApiError(e);
      throw err;
    }
  }

  private async *consume(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  ): AsyncIterable<StepEvent> {
    let text = '';
    // Tool calls arrive in pieces addressed by INDEX, and only the first piece
    // carries the id and the name. Arguments accumulate as a string.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta as (typeof choice.delta & { reasoning_content?: string; reasoning?: string }) | undefined;
      if (!delta) continue;

      // No standard field for it: DeepSeek and Qwen send `reasoning_content`,
      // OpenRouter sends `reasoning`. Shown, never sent back — the endpoints
      // that produce it refuse it as input.
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) yield { type: 'thinking', delta: reasoning };

      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        yield { type: 'text', delta: delta.content };
      }

      for (const piece of delta.tool_calls ?? []) {
        const at = piece.index ?? 0;
        let call = calls.get(at);
        if (!call) {
          call = { id: piece.id ?? `call_${at}`, name: piece.function?.name ?? '', args: '' };
          calls.set(at, call);
          // An announcement, not a call: the kernel executes `tool_call`, and
          // sharing the type here would run every tool twice.
          if (call.name) yield { type: 'tool_pending', id: call.id, name: call.name };
        } else if (piece.id && call.id !== piece.id) {
          call.id = piece.id;
        }
        // A gateway may send the name in a later piece than the id.
        if (!call.name && piece.function?.name) {
          call.name = piece.function.name;
          yield { type: 'tool_pending', id: call.id, name: call.name };
        }
        const args = piece.function?.arguments;
        if (args) {
          call.args += args;
          yield { type: 'tool_args', id: call.id, delta: args };
        }
      }
    }

    const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);

    // Verbatim enough: this protocol has no reasoning to echo back, and the
    // assistant message is exactly what it will accept next time.
    this.messages.push({
      role: 'assistant',
      content: text || null,
      ...(ordered.length
        ? {
          tool_calls: ordered.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: c.args || '{}' },
          })),
        }
        : {}),
    } as Message);

    if (inputTokens || outputTokens) {
      this.log.lastInputTokens = inputTokens || this.log.lastInputTokens;
      yield { type: 'usage', inputTokens, outputTokens };
    }
    yield { type: 'context', used: this.log.contextUsed(), window: this.opts.contextWindow };

    for (const call of ordered) {
      yield { type: 'tool_call', call: { id: call.id, name: call.name, input: parseArgs(call.args) } };
    }

    yield { type: 'stop', reason: stopReason(finish, ordered.length > 0) };
  }
}

/**
 * The arguments, as an object.
 *
 * They arrive as a STRING the model wrote, so a truncated turn produces one that
 * does not parse. An empty object beats throwing: the kernel dispatches the call,
 * the tool reports what it needed, and the model gets a result it can act on —
 * where a throw would end the run with the reason buried in a stack trace.
 */
function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Why the model stopped.
 *
 * `tool_calls` is the honest signal, but not every gateway sets it — several
 * report `stop` on a response that is nothing but tool calls. Having asked for
 * one is the fact that matters to the kernel, so it wins.
 */
function stopReason(raw: string | null, hasCalls: boolean): Extract<StepEvent, { type: 'stop' }>['reason'] {
  if (hasCalls) return 'tool_use';
  switch (raw) {
    case 'length': return 'max_tokens';
    case 'content_filter': return 'refusal';
    default: return 'end_turn';
  }
}

export function createOpenAIProvider(options: OpenAIOptions): AgentProvider {
  const baseURL = options.baseURL || undefined;
  const vision = options.vision ?? !baseURL;
  const client = new OpenAI({ apiKey: options.apiKey, baseURL });
  return {
    id: baseURL ? `openai:${baseURL}` : 'openai',
    model: options.model,
    acceptsImages: vision,
    createSession: ({ system, tools }, memory) => {
      const session = new OpenAISession(
        client,
        {
          model: options.model,
          effort: options.effort ?? DEFAULT_EFFORT,
          reasoningEffort: options.reasoningEffort ?? true,
          vision,
          contextWindow: options.contextWindow || DEFAULT_CONTEXT_WINDOW,
        },
        system,
        tools,
      );
      if (memory !== undefined) session.restore(memory);
      return session;
    },
  };
}
