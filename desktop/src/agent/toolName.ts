// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    toolName.ts
 * @brief   What a tool may be CALLED, on the wire — the one rule both protocols
 *          impose, in the one place that decides it.
 *
 * Anthropic takes `^[a-zA-Z0-9_-]{1,128}$` and Chat Completions `^[a-zA-Z0-9_-]{1,64}$`.
 * Neither accepts a dot. A name outside that is not a tool the endpoint quietly
 * ignores: it refuses the whole REQUEST with a 400 naming an index, so one
 * plugin's tool takes every conversation down with it and the message says
 * nothing about plugins.
 *
 * Lives under src/ and is read from main as well, because the rule has to be one
 * rule — it was two (a validator that required dots, a wire that forbids them),
 * and each half looked right on its own.
 */

/** The intersection of what both protocols accept. */
export const WIRE_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export const isWireToolName = (name: string): boolean => WIRE_TOOL_NAME.test(name);

/**
 * A plugin id as a tool-name prefix.
 *
 * Ids are dotted by convention (`estella.ldtk`) and tool names cannot be, so the
 * namespace is the id with everything illegal folded to `_`. Derived, not
 * declared: a plugin picking its own prefix could pick another plugin's id.
 */
export const toolNamespace = (pluginId: string): string => pluginId.replace(/[^a-zA-Z0-9_-]+/g, '_');
