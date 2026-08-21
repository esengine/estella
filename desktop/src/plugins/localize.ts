// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  localize.ts — resolves a plugin-supplied {@link LocalizedString} against the
 *        editor's session locale.
 *
 * Plugins can't use `t()`: the editor's catalog is closed at compile time, so a
 * plugin string could never be a valid key. They carry their own per-locale text
 * instead, and this is the one place that rule is applied — the plugin host, the
 * inspector, and the menus all resolve identically.
 */
import { editorLocale } from '@/i18n';
import type { LocalizedString } from '@estella/editor-api';

/** Resolve for the current editor locale, falling back to `en`, then any value. */
export function localizePlugin(value: LocalizedString | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value[editorLocale] ?? value.en ?? Object.values(value)[0] ?? '';
}
