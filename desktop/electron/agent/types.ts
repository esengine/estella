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
  /** A call to MAKE. Exactly one per call — the kernel dispatches these. */
  | { type: 'tool_call'; call: ToolCall }
  /**
   * The model has committed to a call but is still writing its arguments.
   *
   * Deliberately NOT a `tool_call`: the kernel executes those, and an
   * announcement that shared the type would run every tool twice. This one is
   * for the editor, so a row can appear and fill in rather than arriving
   * finished out of a silence.
   */
  | { type: 'tool_pending'; id: string; name: string }
  | { type: 'tool_args'; id: string; delta: string }
  /** Why the model stopped. `refusal` is a provider-level decline, not an error. */
  | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'refusal' | 'max_tokens' }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

/**
 * One conversation. Stateful on purpose — see the file header. The kernel
 * appends, then asks for a step; it never reads the history back.
 */
export interface AgentSession {
  /**
   * Which person's turn the NEXT {@link pushUser} opens — the coordinate
   * {@link rewindTo} counts in.
   *
   * The transcript quotes it back as a run's identity rather than numbering runs
   * itself. A renderer that numbered its own would agree with the session only
   * until it lost some (a reload, a trimmed log), after which "re-ask run 0"
   * meant two different turns on the two sides and rewinding threw away a
   * conversation nobody asked to end.
   */
  readonly turnIndex: number;
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
  /**
   * The model's memory of this conversation, as JSON, so it can be put back.
   *
   * Opaque on purpose. What a model remembers is in the provider's wire format
   * — reasoning blocks that must return byte-identical, a prefix the cache
   * matches on — and the moment anything above here could read it, the kernel
   * and the host would be reasoning about that format, which is what this
   * contract exists to keep out of them. They hand it back and ask no questions.
   */
  serialize(): unknown;
}

export interface AgentProvider {
  readonly id: string;
  /** The model this provider will run, for the transcript header. */
  readonly model: string;
  /**
   * Whether a rendered frame can reach the model at all.
   *
   * A gateway that speaks the core format may still refuse image blocks, and
   * the agent has no way to find out except by spending a call on a screenshot
   * it will be told it cannot see. Stated once, in the turn's context, so it
   * can plan around being blind instead of discovering it.
   */
  readonly acceptsImages: boolean;
  /**
   * Start a conversation, or resume one from what {@link AgentSession.serialize}
   * returned.
   *
   * A resumed memory belongs to the model that produced it — reasoning blocks
   * go back to their author and the cached prefix is a byte match — so the
   * caller must only hand back memory it saved under this same provider and
   * model. A provider that cannot make sense of what it is given starts fresh
   * rather than failing: a conversation you cannot continue is worth less than
   * a new one, and far less than a crash.
   */
  createSession(
    opts: { system: string; tools: readonly CatalogTool[] },
    memory?: unknown,
  ): AgentSession;
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
  | 'arbitrary_code'
  /**
   * Authors a whole subtree at once. Undoable, so this is not about safety — it
   * is about seeing a hundred-node edit BEFORE it lands, while saying no to part
   * of it is still free. The window renders the preview, because reading what a
   * batch would change takes the scene, and the scene is on that side.
   */
  | 'bulk_edit';

/** A tool the user has to say yes to before it runs (see `effect`). */
export interface ConfirmRequest {
  callId: string;
  tool: string;
  reason: ConfirmReason;
  input: Record<string, unknown>;
}

/** What came back, and — for a previewed batch — which lines were struck out. */
export interface ConfirmDecision {
  answer: ConfirmAnswer;
  /**
   * Indices into the batch's `ops` the person declined. The rest still runs; the
   * kernel drops anything that depended on a declined line, because a `set` on
   * an entity that was never created is a throw, not a smaller change.
   */
  declined?: readonly number[];
}

/**
 * How one of those was answered.
 *
 * `turn` also covers every later call of the SAME tool in this run — a task that
 * saves eleven files should be one decision, not eleven identical ones, and a
 * gate that interrupts that often is one people learn to click through without
 * reading. It expires with the run on purpose: an "always" that outlives it is a
 * permission switch nobody remembers flipping, which is what the gate is for.
 */
export type ConfirmAnswer = 'once' | 'turn' | 'no';

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
  /** `model` because a conversation can change models between runs, and the
   *  header of a past run has to say which one answered it. `index` is the
   *  session's own coordinate for this run — see {@link AgentSession.turnIndex}. */
  | { type: 'turn_start'; prompt: string; model: string; index: number }
  /**
   * The session was dropped; run coordinates start over at zero.
   *
   * Said out loud rather than left implied, because a mirror that keeps the old
   * runs would then see the NEW run 0 as one it already has — runs are matched
   * by the session's index, and two sessions both have a run 0. Every path that
   * drops the conversation emits this, so no caller has to remember to.
   */
  | { type: 'conversation_reset' }
  | { type: 'tool_start'; call: ToolCall; effect: NonNullable<CatalogTool['effect']> }
  | { type: 'tool_end'; id: string; ok: boolean; summary: string; image?: string }
  | { type: 'awaiting_confirm'; request: ConfirmRequest }
  /** The turn is over. `steps` is what a single Undo would take back — 0 is the
   *  signal not to offer one — and `mark` is where it would take it back to. */
  /** `max_rounds` is its own ending because the work is UNFINISHED: reported as
   *  an ordinary end_turn it would look like the agent had said its piece. */
  | { type: 'turn_end'; steps: number; mark: unknown; reason: 'end_turn' | 'aborted' | 'error' | 'refusal' | 'max_rounds' }
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
  /** What is behind `session`, for the transcript. The session abstraction has
   *  no name for itself, and the host is where that name is known. */
  model: string;
  /** See {@link AgentProvider.acceptsImages}. */
  acceptsImages: boolean;
  /** Ask the person. `no` is declined, which the model is told about. */
  confirm(request: ConfirmRequest): Promise<ConfirmDecision>;
  emit(event: AgentEvent): void;
}

export type { HistoryMark };
