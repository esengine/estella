// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  localeKeys.ts — the project's i18n key index behind the Text.i18nKey
 *        picker. Scans every `.eslocale` table and serves the union of keys as
 *        enum-source options, each labeled with a translated preview (in the
 *        EDITOR's language when that locale ships, else the first table's).
 *
 * An enum source is synchronous (called during inspector render), so the index is
 * a sync cache refreshed asynchronously: a render kicks a scan when stale, and a
 * finished scan that CHANGED the list POKES the panels so open inspectors re-render
 * with the fresh options (no change → no poke, so the kick can't loop). File edits
 * mark the cache stale via `fsRefresh`.
 *
 * The poke goes to the scene revision, which is what an inspector actually listens
 * to — the same repaint seam the DragonBones name cache uses when its read lands.
 * Bumping `fsRefresh` instead only re-read directories, so the panel kept showing
 * the cold answer (a plain text field) until something else repainted it.
 */
import { parseLocaleTable } from 'esengine';
import { setEnumSource } from '@/engine/schema';
import { SceneStore } from '@/engine/SceneStore';
import type { EnumOption } from '@/types';

import { fsRefresh } from './fsRefresh';
import { editorLocale } from '@/i18n';

let options: EnumOption[] = [];
let stale = true;
let scanning = false;

/** Where the locale tables are, supplied at install time — see
 *  {@link installLocaleKeyEnumSource}. */
let listLocaleAssets: () => ReadonlyArray<{ path: string }> = () => [];

async function scan(): Promise<EnumOption[]> {
  // key → per-locale preview text (plural entries preview their `other` form).
  const previews = new Map<string, Map<string, string>>();
  for (const { path } of listLocaleAssets()) {
    // Deleted between the listing and the read — the next bump rescans.
    const text = await window.estella.fs.readOptional(path);
    if (text === null) continue;
    try {
      const table = parseLocaleTable(text, path);
      for (const [key, value] of Object.entries(table.entries)) {
        let byLocale = previews.get(key);
        if (!byLocale) { byLocale = new Map(); previews.set(key, byLocale); }
        byLocale.set(table.locale, typeof value === 'string' ? value : value.other);
      }
    } catch (e) {
      // A malformed table must not hide the others' keys; the loader/runtime
      // surfaces the same error loudly when the game ships it.
      console.warn('[i18n] skipping malformed locale table', path, e);
    }
  }
  return [...previews.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, byLocale]) => {
      const preview = byLocale.get(editorLocale) ?? byLocale.values().next().value ?? '';
      return { value: key, label: preview ? `${key} · ${preview}` : key };
    });
}

function kickScan(): void {
  if (!stale || scanning) return;
  scanning = true;
  void scan()
    .then((next) => {
      stale = false;
      const changed = next.length !== options.length
        || next.some((o, i) => o.value !== options[i].value || o.label !== options[i].label);
      options = next;
      if (changed) SceneStore.poke();
    })
    .finally(() => { scanning = false; });
}

// Any on-disk change may add/remove keys — mark stale; the next inspector
// render (or directory re-read) kicks the rescan.
fsRefresh.subscribe(() => { stale = true; });

/**
 * Register the `Text.i18nKey` picker's source. Called once, beside the others.
 *
 * The locale tables are handed in rather than read from the project store: this
 * module is one of the store's CONSUMERS, and importing it back to ask for a
 * list made the two a dependency cycle for the sake of a single call.
 */
export function installLocaleKeyEnumSource(
  listAssets: () => ReadonlyArray<{ path: string }>,
): void {
  listLocaleAssets = listAssets;
  setEnumSource('localeKeys', () => {
    kickScan();
    return options;
  });
}
