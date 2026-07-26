// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  api.ts — the runtime half of `@estella/editor-api`, the one module a
 *        plugin imports. It stays deliberately tiny: everything a plugin can DO
 *        arrives through the context object handed to `activate`, not through
 *        imported functions.
 *
 * The SIGNATURES live in ./types (which doubles as the `.d.ts` shipped to plugin
 * authors); each implementation below is annotated with the declared type, so an
 * implementation that stops matching what authors were promised is a compile error
 * rather than a runtime surprise in someone else's plugin.
 */
import type * as Api from './types';

export type * from './types';

export const definePlugin: typeof Api.definePlugin = (plugin) => plugin;

export const localize: typeof Api.localize = (value, locale) => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value[locale] ?? value.en ?? Object.values(value)[0] ?? '';
};
