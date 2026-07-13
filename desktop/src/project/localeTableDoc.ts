// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  localeTableDoc.ts
 * @brief Pure, immutable edits over a LocaleTableAsset (the `.eslocale` content:
 *        one locale's key → string | plural forms). The data model is the SDK's
 *        (parseLocaleTable / LocaleAssetLoader ship the same JSON), so the editor
 *        authors exactly what the runtime loads — the inputMapDoc pattern.
 *        Engine/DOM-free → unit-tests in isolation; the panel renders + dispatches.
 */
import type { LocaleTableAsset, LocaleEntry, PluralForms, PluralCategory } from 'esengine';

export const LOCALE_TABLE_VERSION = 1;

/** CLDR plural categories, in display order. `other` is the required catch-all. */
export const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

export const blankLocaleTable = (locale = 'en'): LocaleTableAsset =>
  ({ version: LOCALE_TABLE_VERSION, locale, entries: {} });

const withEntries = (table: LocaleTableAsset, entries: Record<string, LocaleEntry>): LocaleTableAsset =>
  ({ ...table, entries });

/** The stable on-disk form (2-space indent + trailing newline — what
 *  createLocaleTableFile writes and git diffs expect). */
export const serializeLocaleTable = (table: LocaleTableAsset): string =>
  JSON.stringify(table, null, 2) + '\n';

export function setLocaleTag(table: LocaleTableAsset, locale: string): LocaleTableAsset {
  const tag = locale.trim();
  if (!tag || tag === table.locale) return table;
  return { ...table, locale: tag };
}

export function addEntry(table: LocaleTableAsset, key: string, text = ''): LocaleTableAsset {
  const k = key.trim();
  if (!k || table.entries[k] !== undefined) return table;
  return withEntries(table, { ...table.entries, [k]: text });
}

/** Rename a key, preserving its position in the (ordered) entry list. */
export function renameEntry(table: LocaleTableAsset, from: string, to: string): LocaleTableAsset {
  const t = to.trim();
  if (from === t || table.entries[from] === undefined || !t || table.entries[t] !== undefined) return table;
  const entries: Record<string, LocaleEntry> = {};
  for (const [k, v] of Object.entries(table.entries)) entries[k === from ? t : k] = v;
  return withEntries(table, entries);
}

export function removeEntry(table: LocaleTableAsset, key: string): LocaleTableAsset {
  if (table.entries[key] === undefined) return table;
  const entries = { ...table.entries };
  delete entries[key];
  return withEntries(table, entries);
}

/** Set a plain-string entry's text (no-op on plural entries — edit their forms). */
export function setEntryText(table: LocaleTableAsset, key: string, text: string): LocaleTableAsset {
  const cur = table.entries[key];
  if (cur === undefined || typeof cur !== 'string' || cur === text) return table;
  return withEntries(table, { ...table.entries, [key]: text });
}

/** Convert a plain entry to plural forms (its text becomes `other`). */
export function toPlural(table: LocaleTableAsset, key: string): LocaleTableAsset {
  const cur = table.entries[key];
  if (cur === undefined || typeof cur !== 'string') return table;
  return withEntries(table, { ...table.entries, [key]: { other: cur } });
}

/** Collapse a plural entry back to a plain string (keeps its `other` form). */
export function toSingle(table: LocaleTableAsset, key: string): LocaleTableAsset {
  const cur = table.entries[key];
  if (cur === undefined || typeof cur === 'string') return table;
  return withEntries(table, { ...table.entries, [key]: cur.other });
}

/** Set one plural form's text; adds the form if absent. */
export function setPluralForm(
  table: LocaleTableAsset, key: string, form: PluralCategory, text: string,
): LocaleTableAsset {
  const cur = table.entries[key];
  if (cur === undefined || typeof cur === 'string' || cur[form] === text) return table;
  return withEntries(table, { ...table.entries, [key]: { ...cur, [form]: text } });
}

/** Remove a plural form. `other` is the required catch-all — never removable. */
export function removePluralForm(
  table: LocaleTableAsset, key: string, form: PluralCategory,
): LocaleTableAsset {
  const cur = table.entries[key];
  if (cur === undefined || typeof cur === 'string' || form === 'other' || cur[form] === undefined) return table;
  const forms: PluralForms = { ...cur };
  delete forms[form];
  return withEntries(table, { ...table.entries, [key]: forms });
}

/** The plural categories an entry does NOT carry yet (for the add-form picker). */
export function absentPluralForms(entry: LocaleEntry): PluralCategory[] {
  if (typeof entry === 'string') return [];
  return PLURAL_CATEGORIES.filter((c) => entry[c] === undefined);
}
