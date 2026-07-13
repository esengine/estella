// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// The suggest dropdown's grouping/filter contract (pure half of SuggestInput):
// un-namespaced names lead without a header, namespaces follow alphabetically
// under headers, filtering is a case-insensitive substring, and the flat pick
// list stays index-aligned with the rendered item rows.
import { describe, it, expect } from 'vitest';
import { buildSuggestRows, type SuggestItem } from '@/components/SuggestInput';

const items: SuggestItem[] = [
  { value: 'timeline.play', desc: 'play it' },
  { value: 'patrol' },
  { value: 'timeline.pause' },
  { value: 'audio.duck' },
  { value: 'chase' },
];

describe('buildSuggestRows', () => {
  it('groups: un-namespaced first (headerless), then namespaces alphabetically', () => {
    const { rows } = buildSuggestRows(items, '');
    const shape = rows.map((r) => (r.kind === 'header' ? `#${r.label}` : r.item.value));
    expect(shape).toEqual([
      'patrol', 'chase',
      '#audio', 'audio.duck',
      '#timeline', 'timeline.play', 'timeline.pause',
    ]);
  });

  it('flat list is index-aligned with the item rows', () => {
    const { rows, flat } = buildSuggestRows(items, '');
    for (const r of rows) {
      if (r.kind === 'item') expect(flat[r.index]).toBe(r.item);
    }
    expect(flat).toHaveLength(5);
  });

  it('filters by case-insensitive substring and drops emptied groups', () => {
    const { rows, flat } = buildSuggestRows(items, 'PLAY');
    expect(flat.map((i) => i.value)).toEqual(['timeline.play']);
    expect(rows).toEqual([
      { kind: 'header', label: 'timeline' },
      { kind: 'item', item: items[0], index: 0 },
    ]);
  });

  it('keeps descriptions attached through grouping', () => {
    const { flat } = buildSuggestRows(items, 'timeline.play');
    expect(flat[0].desc).toBe('play it');
  });

  it('empty query returns everything; no-hit query returns nothing', () => {
    expect(buildSuggestRows(items, '').flat).toHaveLength(5);
    expect(buildSuggestRows(items, 'zzz').rows).toHaveLength(0);
  });
});
