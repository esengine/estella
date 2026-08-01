// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  secretIds.ts — the ids a secret is stored under.
 *
 * Shared by both sides on purpose: the settings row registers under one of these
 * and main reads back under the same one, and a secret written under an id
 * nobody reads is indistinguishable from a machine that lost its keychain. A
 * leaf module with no imports, so main can take it without pulling the editor in
 * (the same reason plugins/paths.ts exists).
 */

/** The built-in agent's model credential. Also its settings-row id. */
export const AGENT_API_KEY = 'agents.apiKey';
