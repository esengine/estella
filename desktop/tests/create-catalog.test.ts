// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { flattenCatalog, matchCatalog } from '@/engine/entityTemplates';

describe('Create catalog (searchable template list)', () => {
  it('flattens categories into a list, preserving order + carrying category', () => {
    const all = flattenCatalog();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.category !== '' && e.template.label !== '')).toBe(true);
    expect(all.map((e) => e.template.label)).toEqual(expect.arrayContaining(['Button', 'Slider']));
  });

  it('matches on item label, case-insensitively', () => {
    const all = flattenCatalog();
    const r = matchCatalog(all, 'BUT');
    expect(r.map((e) => e.template.label)).toEqual(['Button']);
  });

  it('matches on category label', () => {
    const all = flattenCatalog();
    expect(matchCatalog(all, 'ui').length).toBe(all.length); // every current template is UI
  });

  it('empty query returns everything; no match returns nothing', () => {
    const all = flattenCatalog();
    expect(matchCatalog(all, '   ')).toEqual(all);
    expect(matchCatalog(all, 'zzzzz')).toEqual([]);
  });
});
