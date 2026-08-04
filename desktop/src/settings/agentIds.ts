// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  agentIds.ts — the built-in agent's constants, shared by both processes.
 *
 * A leaf module with no imports, so main can take it without pulling the editor
 * in (the same reason plugins/paths.ts exists). Key ids are NOT here — they are
 * per provider and derived (agent/providers.ts), and the window is the side that
 * knows which provider was picked.
 */

/** What runs when the model setting is blank. Opus-tier because this drives a
 *  real project: a wrong edit costs the user their scene, and the turn's
 *  checkpoint only helps if the plan was sane. */
export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * What a gateway we have never heard of is assumed to accept, in tokens.
 *
 * Deliberately low. Guessing high means a turn that fails outright after the
 * person waited for it; guessing low means a compaction that was not needed yet.
 * Providers we do ship say their own (agent/providers.ts).
 */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * How hard the model is asked to think, and what it costs.
 *
 * Agentic work is what `xhigh` is for — it is the depth Claude Code runs at,
 * and it is the default here for the same reason the model is Opus-tier: this
 * drives a real project and a wrong edit costs someone their scene. But the
 * same model is worth running shallower when the ask is "rename these three
 * entities", and depth is what a person reaches for when a turn cost too much
 * or took too long. So it is a setting, separate from the model pick.
 */
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];
export const DEFAULT_EFFORT: AgentEffort = 'xhigh';

/** A stored value, narrowed — a settings file is a file a person can edit, and
 *  an unknown depth must not reach the wire. */
export const asEffort = (value: unknown): AgentEffort =>
    (AGENT_EFFORTS as readonly string[]).includes(String(value)) ? (value as AgentEffort) : DEFAULT_EFFORT;

/**
 * Fold the oldest runs away once the conversation is this far into its window,
 * keeping the last {@link KEEP_WHOLE_RUNS} intact.
 *
 * Not at the brim: the call that trips the limit is the one that fails, and it
 * fails after the wait. Three quarters leaves room for one more large turn.
 */
export const COMPACT_AT = 0.75;
export const KEEP_WHOLE_RUNS = 3;

/**
 * Whether a conversation this full is past that line.
 *
 * The rule lives with the number because two sides ask it and they must not
 * drift apart: the session, deciding whether to fold before its next call, and
 * the editor's meter, saying that the next run is where the folding starts. A
 * comparison written out twice is one edit away from a gauge that promises what
 * the session is not about to do.
 */
export const shouldCompact = (used: number, contextWindow: number): boolean =>
  used > contextWindow * COMPACT_AT;
