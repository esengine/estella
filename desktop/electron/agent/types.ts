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
  content: string;
  isError: boolean;
  /**
   * A rendered frame the model is meant to LOOK at (capture_viewport,
   * screenshot). Kept as data rather than flattened to "[image]": a tool whose
   * entire purpose is sight is not served by being told it happened.
   *
   * The PROVIDER decides what becomes of it, because whether images cross the
   * wire is a property of the endpoint, not of the editor.
   */
  image?: { data: string; mediaType: string };
}

/** What a provider emits while ONE model call runs. */
export type StepEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  /** The model is still WRITING a call's arguments. Emitted before the call is
   *  complete, so the editor can show it being composed rather than appearing
   *  finished out of a silence. */
  | { type: 'tool_args'; id: string; delta: string }
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
  /**
   * Drop everything from the `n`-th person's turn onward, so it can be asked
   * again from there.
   *
   * Counted in PERSON's turns, not messages: a tool result is also a `user`
   * message, and a caller that knew that would be reasoning about the
   * provider's wire format — which is the one thing this contract exists to
   * keep out of the kernel.
   */
  rewindTo(n: number): void;
  /** Run one model call. */
  step(signal: AbortSignal): AsyncIterable<StepEvent>;
}

export interface AgentProvider {
  readonly id: string;
  /** The model this provider will run, for the transcript header. */
  readonly model: string;
  createSession(opts: { system: string; tools: readonly CatalogTool[] }): AgentSession;
}

/**
 * Why a call needs saying out loud. A code rather than a sentence: the person
 * who reads it is in the editor, and the editor is the only side that knows
 * their language.
 */
export type ConfirmReason =
  /** Escapes the undo stack — a file, a project setting, an export. */
  | 'irreversible'
  /** Runs code the agent wrote, so its effect is whatever that code does. */
  | 'arbitrary_code';

/** A tool the user has to say yes to before it runs (see `effect`). */
export interface ConfirmRequest {
  callId: string;
  tool: string;
  reason: ConfirmReason;
  input: Record<string, unknown>;
}

/**
 * What the editor renders. A superset of what the provider emitted.
 *
 * Self-describing on purpose: the editor's read model is rebuilt from this
 * stream alone (store/AgentStore.ts), across an IPC boundary where "the sender
 * also knows the prompt" stops being true. Hence `turn_start` carrying what was
 * asked and `turn_end` carrying the checkpoint, rather than the receiver pairing
 * events with state it kept on the side.
 */
export type AgentEvent =
  | StepEvent
  | { type: 'turn_start'; prompt: string }
  | { type: 'tool_start'; call: ToolCall; effect: NonNullable<CatalogTool['effect']> }
  | { type: 'tool_end'; id: string; ok: boolean; summary: string; image?: string }
  | { type: 'awaiting_confirm'; request: ConfirmRequest }
  /** The turn is over. `steps` is what a single Undo would take back — 0 is the
   *  signal not to offer one — and `mark` is where it would take it back to. */
  | { type: 'turn_end'; steps: number; mark: unknown; reason: 'end_turn' | 'aborted' | 'error' | 'refusal' }
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
