// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    types.ts
 * @brief   The contract between the agent kernel and a model provider, and the
 *          events the kernel streams out to the editor.
 *
 * The split is deliberate and is what keeps a second provider cheap: the
 * PROVIDER owns its own conversation history in whatever shape its API wants
 * (Anthropic requires thinking blocks echoed back unchanged, and a message array
 * whose prefix must stay byte-identical to stay cached — neither survives being
 * normalised into a neutral shape and rebuilt), while the KERNEL owns the loop,
 * the permission tiers, the undo checkpoint and the verification reflex. Nothing
 * about a vendor reaches the kernel, and no editor policy reaches a provider.
 */
import type { HistoryMark } from '../../src/engine/EditorHistory';

/** A tool as the catalog declares it (the .mjs registry is untyped). */
export interface CatalogTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  effect?: 'read' | 'undoable' | 'irreversible';
}

/** One call the model wants made. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Its outcome, in the shape a provider appends to its history. */
export interface ToolOutcome {
  id: string;
  /** Text or an image the model reads back. */
  content: string;
  isError: boolean;
}

/** What a provider emits while ONE model call runs. */
export type StepEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  /** Why the model stopped. `refusal` is a provider-level decline, not an error. */
  | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'refusal' | 'max_tokens' }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

/**
 * One conversation. Stateful on purpose — see the file header. The kernel
 * appends, then asks for a step; it never reads the history back.
 */
export interface AgentSession {
  /** The person's turn. */
  pushUser(text: string): void;
  /**
   * Operator context for the turns from here on — what the editor is showing,
   * what the diagnostics say. Kept OUT of the system prompt: that sits at the
   * front of the cached prefix, and rewriting it every turn would re-bill the
   * whole conversation.
   */
  pushContext(text: string): void;
  /** Results for the calls the last step asked for, all of them, in one go. */
  pushToolResults(outcomes: readonly ToolOutcome[]): void;
  /** Run one model call. */
  step(signal: AbortSignal): AsyncIterable<StepEvent>;
}

export interface AgentProvider {
  readonly id: string;
  /** The model this provider will run, for the transcript header. */
  readonly model: string;
  createSession(opts: { system: string; tools: readonly CatalogTool[] }): AgentSession;
}

/** A tool the user has to say yes to before it runs (see `effect`). */
export interface ConfirmRequest {
  callId: string;
  tool: string;
  /** Why it needs asking, already phrased for a person. */
  reason: string;
  input: Record<string, unknown>;
}

/** What the editor renders. A superset of what the provider emitted. */
export type AgentEvent =
  | StepEvent
  | { type: 'turn_start' }
  | { type: 'tool_start'; call: ToolCall; effect: NonNullable<CatalogTool['effect']> }
  | { type: 'tool_end'; id: string; ok: boolean; summary: string }
  | { type: 'awaiting_confirm'; request: ConfirmRequest }
  /** The turn is over. `steps` is what a single Undo would take back, and 0 is
   *  the signal not to offer one. */
  | { type: 'turn_end'; steps: number; reason: 'end_turn' | 'aborted' | 'error' | 'refusal' }
  | { type: 'error'; message: string };

/** Everything the kernel needs from outside, so it runs under a test with none
 *  of Electron present. */
export interface KernelDeps {
  /** The one driver every consumer shares (electron/surfaceDriver.ts). */
  driver: {
    (method: string, args?: readonly unknown[], root?: string): Promise<unknown>;
    js(code: string): Promise<unknown>;
    op(op: string, input?: Record<string, unknown>): Promise<unknown>;
  };
  session: AgentSession;
  /** Ask the person. Resolving false means "declined", which the model is told. */
  confirm(request: ConfirmRequest): Promise<boolean>;
  emit(event: AgentEvent): void;
}

export type { HistoryMark };
