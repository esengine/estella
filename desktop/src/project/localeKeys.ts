// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  localeKeys.ts — the project's i18n key index behind the Text.i18nKey
 *        picker. Scans every `.eslocale` table and serves the union of keys as
 *        dynamic-enum options, each labeled with a translated preview (in the
 *        EDITOR's language when that locale ships, else the first table's).
 *
 * The dynamic-enum provider is synchronous (called during inspector render),
 * so the index is a sync cache refreshed asynchronously: a render kicks a scan
 * when stale, and a finished scan that CHANGED the list bumps `fsRefresh` so
 * open inspectors re-render with the fresh options (no change → no bump, so
 * the kick can't loop). File edits mark the cache stale via the same signal.
 */
import { parseLocaleTable } from 'esengine';
import { registerDynamicEnum, type DynamicEnumOption } from '@/engine/schema';
import { ProjectStore } from './ProjectStore';
import { fsRefresh } from './fsWatch';
import { editorLocale } from '@/i18n';

let options: DynamicEnumOption[] = [];
let stale = true;
let scanning = false;

async function scan(): Promise<DynamicEnumOption[]> {
  // key → per-locale preview text (plural entries preview their `other` form).
  const previews = new Map<string, Map<string, string>>();
  for (const { path } of ProjectStore.listAssets('locale')) {
    let text: string;
    try {
      text = await window.estella.fs.read(path);
    } catch {
      continue; // deleted between scan start and read — the next bump rescans
    }
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
      if (changed) fsRefresh.bump();
    })
    .finally(() => { scanning = false; });
}

// Any on-disk change may add/remove keys — mark stale; the next inspector
// render (or directory re-read) kicks the rescan.
fsRefresh.subscribe(() => { stale = true; });

registerDynamicEnum('Text', 'i18nKey', () => {
  kickScan();
  return options;
});
