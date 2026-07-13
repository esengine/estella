// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pure edits over a LocaleTableAsset (the .eslocale editor's document
 *        model) — add/rename/remove keys (order-preserving, collision-safe),
 *        string ↔ plural conversion, per-form edits, and the stable
 *        serialization the runtime parses back.
 */
import { describe, it, expect } from 'vitest';
import { parseLocaleTable } from 'esengine';
import * as ldoc from '@/project/localeTableDoc';

const base = () => ldoc.addEntry(ldoc.addEntry(ldoc.blankLocaleTable('zh-CN'), 'a', '甲'), 'b', '乙');

describe('localeTableDoc', () => {
  it('addEntry: unique keys only; blank names rejected', () => {
    const t = base();
    expect(Object.keys(t.entries)).toEqual(['a', 'b']);
    expect(ldoc.addEntry(t, 'a', 'dup')).toBe(t);
    expect(ldoc.addEntry(t, '  ')).toBe(t);
  });

  it('renameEntry preserves order and refuses collisions', () => {
    const t = ldoc.renameEntry(base(), 'a', 'z');
    expect(Object.keys(t.entries)).toEqual(['z', 'b']); // position kept
    expect(t.entries.z).toBe('甲');
    expect(ldoc.renameEntry(t, 'z', 'b')).toBe(t); // collision → no-op
  });

  it('removeEntry / setEntryText', () => {
    const t = ldoc.setEntryText(base(), 'a', '改');
    expect(t.entries.a).toBe('改');
    expect(Object.keys(ldoc.removeEntry(t, 'a').entries)).toEqual(['b']);
  });

  it('string ↔ plural round-trips through the `other` form', () => {
    let t = ldoc.toPlural(base(), 'a');
    expect(t.entries.a).toEqual({ other: '甲' });
    t = ldoc.setPluralForm(t, 'a', 'one', '一');
    expect(t.entries.a).toEqual({ other: '甲', one: '一' });
    t = ldoc.toSingle(t, 'a');
    expect(t.entries.a).toBe('甲'); // collapses to other, dropping one
  });

  it('removePluralForm never removes the required `other`', () => {
    let t = ldoc.setPluralForm(ldoc.toPlural(base(), 'a'), 'a', 'few', '几');
    t = ldoc.removePluralForm(t, 'a', 'few');
    expect(t.entries.a).toEqual({ other: '甲' });
    expect(ldoc.removePluralForm(t, 'a', 'other')).toBe(t);
  });

  it('absentPluralForms lists what the add-form picker offers', () => {
    const t = ldoc.setPluralForm(ldoc.toPlural(base(), 'a'), 'a', 'one', '一');
    expect(ldoc.absentPluralForms(t.entries.a)).toEqual(['zero', 'two', 'few', 'many']);
    expect(ldoc.absentPluralForms('plain')).toEqual([]);
  });

  it('setLocaleTag trims and no-ops on empty/same', () => {
    const t = base();
    expect(ldoc.setLocaleTag(t, ' en ').locale).toBe('en');
    expect(ldoc.setLocaleTag(t, '')).toBe(t);
  });

  it('serialization round-trips through the runtime parser', () => {
    const t = ldoc.setPluralForm(ldoc.toPlural(base(), 'b'), 'b', 'one', '壹');
    const text = ldoc.serializeLocaleTable(t);
    expect(text.endsWith('\n')).toBe(true);
    const back = parseLocaleTable(text, 'x.eslocale');
    expect(back.locale).toBe('zh-CN');
    expect(back.entries).toEqual(t.entries);
  });
});
