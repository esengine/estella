// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    conversation.ts
 * @brief   The bookkeeping every provider needs and none of them should own:
 *          where each run started, which ones have been folded away, and how
 *          full the context is.
 *
 * None of it is about a wire format. Turn COORDINATES have to outlive the
 * messages they named (the editor says "re-ask run 7" long after run 7's
 * messages went); the fold has to carry every request it ever swallowed, not
 * just the last batch; and how full a context is has to be answered even by an
 * endpoint that reports nothing. Those are three pieces of hard-won arithmetic,
 * and a second copy of them is a second place for the bugs they already have
 * scars from.
 *
 * What IS about the wire format is parameterised: a {@link HistoryShape} says
 * how to read the person's line out of a message, what pair of messages a fold
 * leaves behind, and roughly what a message weighs. Three functions, and the
 * provider keeps the rest of its format to itself.
 */
import { COMPACT_AT, KEEP_WHOLE_RUNS, shouldCompact } from '../../src/settings/agentIds';

export { COMPACT_AT, KEEP_WHOLE_RUNS };

/** The three things this needs to know about a provider's message type. */
export interface HistoryShape<M> {
  /**
   * What a person's turn said, as one line for the fold note.
   *
   * The FIRST text of it only. A turn is pushed as a plain string and then gets
   * the editor context appended (flushContext), which is the same paragraph
   * every turn — joining them would quote the state of the editor once per
   * folded run and bury the sentence that was actually said.
   */
  askedIn(message: M | undefined): string;
  /** The user/assistant pair a fold leaves in place of what it dropped. */
  foldNote(text: string): readonly [M, M];
  /** Roughly what this message occupies, in characters. */
  weigh(message: M): number;
}

/**
 * A conversation's memory on disk. Versioned, and NAMED by wire format.
 *
 * The name is what stops a Claude conversation being resumed into an OpenAI
 * session. Both formats serialize to `{ v: 1, messages: [...] }` and a shape
 * check cannot tell them apart, so without it a provider would happily load a
 * history it has no way to send — which fails as a 400 several seconds later,
 * with nothing on screen connecting it to the model switch that caused it.
 * Absent means `anthropic`: conversations saved before this field existed were
 * all that one.
 */
export interface LogMemory<M> {
  v: 1;
  format?: string;
  messages: M[];
  turnStarts: number[];
  dropped: number;
  folded: string[];
  lastInputTokens: number;
}

/** How many past requests a fold note quotes before it elides the oldest. */
const MAX_FOLDED_ASKS = 20;

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
 * Pure and exported because it rewrites the history everything else depends on,
 * and the bookkeeping — turn COORDINATES outliving the messages they named — is
 * the part worth pinning by test rather than by whichever long conversation
 * happens to hit it first.
 *
 * @returns the rewritten history, or null when there is not enough to fold.
 */
export function compactHistory<M>(
  shape: HistoryShape<M>,
  messages: readonly M[],
  turnStarts: readonly number[],
  dropped: number,
  keepRuns: number,
  folded: readonly string[] = [],
): { messages: M[]; turnStarts: number[]; dropped: number; folded: string[] } | null {
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
    ...turnStarts.slice(0, cut).map((start, i) => `${dropped + i + 1}. ${shape.askedIn(messages[start])}`),
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
  const kept: M[] = [...shape.foldNote(note), ...messages.slice(at)];
  const shift = at - 2;
  return {
    messages: kept,
    turnStarts: turnStarts.slice(cut).map((s) => s - shift),
    // Coordinates count from the start of the CONVERSATION, not of what is left.
    dropped: dropped + cut,
    folded: asked,
  };
}

/** One line of a fold note, from raw text — the shared half of `askedIn`. */
export function foldLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '(no text)';
  return flat.length > 200 ? `${flat.slice(0, 197)}…` : flat;
}

/**
 * One conversation's history, and everything true of it that is not its shape.
 *
 * The provider owns `messages` — it appends in its own format and reads them
 * back to build a request. This owns where the runs are, what has been folded,
 * and what the endpoint last billed.
 */
export class ConversationLog<M> {
  /** The provider's own history, in the provider's own format. */
  readonly messages: M[] = [];
  /** Where each person's turn starts. A tool result is a message too, so
   *  counting roles would not find them. */
  private turnStarts: number[] = [];
  /** Runs folded away. Turn coordinates count from the start of the
   *  CONVERSATION, so they must survive their messages. */
  private dropped = 0;
  /** What was asked in every folded run, oldest first — see compactHistory. */
  private folded: string[] = [];
  /**
   * What the last call was billed for its input. Authoritative WHERE it counts
   * the whole request — see {@link contextUsed}, which does not assume it does.
   */
  lastInputTokens = 0;

  constructor(
    private readonly shape: HistoryShape<M>,
    private readonly opts: {
      contextWindow: number;
      /** Characters the request carries regardless of history: system + tools. */
      fixedChars: number;
    },
  ) {}

  get turnIndex(): number {
    return this.dropped + this.turnStarts.length;
  }

  /** The next message appended opens a person's turn. */
  markTurnStart(): void {
    this.turnStarts.push(this.messages.length);
  }

  /**
   * Drop everything from the `n`-th person's turn onward.
   *
   * @returns false when that run has already been folded away — its messages
   *          are gone, and refusing beats half-doing it.
   */
  rewindTo(n: number): boolean {
    const at = this.turnStarts[n - this.dropped];
    if (at === undefined) return false;
    this.messages.length = at;
    this.turnStarts.length = n - this.dropped;
    return true;
  }

  /**
   * How full the context is, in tokens — the larger of what the endpoint billed
   * and what this conversation obviously weighs.
   *
   * Measured against a real gateway, the billed input is NOT always the whole
   * request: DeepSeek reported 33 for a first turn whose system prompt and 75
   * tool schemas are thousands, so trusting it alone meant compaction would
   * never fire and the conversation would hit the wall it exists to prevent.
   * Nor can the estimate simply replace it — chars/4 is a rule of thumb that
   * under-counts CJK badly, which is most of what this editor's users type.
   *
   * So: whichever is bigger. Both err by under-reporting, and the cost of
   * over-reporting is one compaction that was not needed yet.
   */
  contextUsed(): number {
    let chars = this.opts.fixedChars;
    for (const message of this.messages) chars += this.shape.weigh(message);
    return Math.max(this.lastInputTokens, Math.ceil(chars / 4));
  }

  /**
   * Fold the oldest runs away if this conversation has outgrown its budget.
   *
   * @returns how many runs went, 0 when none did. The caller SAYS it — a
   *          conversation losing part of its memory with nothing on screen to
   *          show for it is the thing this number exists to end.
   */
  compactIfNeeded(): number {
    if (!shouldCompact(this.contextUsed(), this.opts.contextWindow)) return 0;
    const next = compactHistory(
      this.shape, this.messages, this.turnStarts, this.dropped, KEEP_WHOLE_RUNS, this.folded,
    );
    if (!next) return 0;
    const runs = next.dropped - this.dropped;
    this.messages.splice(0, this.messages.length, ...next.messages);
    this.turnStarts = next.turnStarts;
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

  get contextWindow(): number {
    return this.opts.contextWindow;
  }

  serialize(format: string): LogMemory<M> {
    return {
      v: 1,
      format,
      messages: this.messages,
      turnStarts: this.turnStarts,
      dropped: this.dropped,
      folded: this.folded,
      lastInputTokens: this.lastInputTokens,
    };
  }

  /**
   * Put a serialized memory back, if it is one of ours.
   *
   * @returns false for anything else — a shape this does not recognise, or a
   *          history in another provider's wire format. The caller starts fresh:
   *          a conversation you cannot continue is worth less than a new one,
   *          and far less than a crash several seconds into the next turn.
   */
  restore(memory: unknown, format: string): boolean {
    const m = memory as Partial<LogMemory<M>> | null;
    if (!m || m.v !== 1 || !Array.isArray(m.messages) || !Array.isArray(m.turnStarts)) return false;
    if (typeof m.dropped !== 'number' || !Array.isArray(m.folded)) return false;
    // Absent means the format that existed before this field did.
    if ((m.format ?? 'anthropic') !== format) return false;
    this.messages.splice(0, this.messages.length, ...m.messages);
    this.turnStarts = m.turnStarts;
    this.dropped = m.dropped;
    this.folded = m.folded;
    this.lastInputTokens = m.lastInputTokens ?? 0;
    return true;
  }
}
