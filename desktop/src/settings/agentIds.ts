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
