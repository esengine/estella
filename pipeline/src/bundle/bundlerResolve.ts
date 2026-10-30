// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The `pluginData` a resolve plugin passes when it asks the bundler to resolve a path itself.
 *
 * Every plugin that re-resolves must pass this one value and step aside when it sees it. Two plugins that each
 * recognised only their own marker asked each other for the same path forever.
 */
export const BUNDLER_RESOLVES = Symbol('estella:bundler-resolves');
