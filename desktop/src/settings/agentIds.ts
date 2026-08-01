// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  agentIds.ts — the built-in agent's constants, shared by both processes.
 *
 * Shared on purpose: the settings row registers under an id and main reads back
 * under the same one, and a secret written under an id nobody reads is
 * indistinguishable from a machine that lost its keychain. Likewise the default
 * model — main falls back to it and the settings row shows it as the
 * placeholder, so a second copy would eventually tell the user something untrue.
 *
 * A leaf module with no imports, so main can take it without pulling the editor
 * in (the same reason plugins/paths.ts exists).
 */

/** The built-in agent's model credential. Also its settings-row id. */
export const AGENT_API_KEY = 'agents.apiKey';

/** What runs when the model setting is blank. Opus-tier because this drives a
 *  real project: a wrong edit costs the user their scene, and the turn's
 *  checkpoint only helps if the plan was sane. */
export const DEFAULT_MODEL = 'claude-opus-5';
