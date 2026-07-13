// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  i18n.test.ts — the editor localization seams: the pure boot-locale
 *        rule, catalog integrity (key uniqueness across area modules — the
 *        merge spread would silently last-write-wins), and t() resolution in
 *        both languages. Per-entry language completeness is a COMPILE error
 *        (Message requires en+zh), so no runtime test re-checks it.
 */
import { describe, it, expect } from 'vitest';
import { resolveLocale, t, editorLocale, editorMessages } from '@/i18n';
import { messageModules } from '@/i18n/messages';
import { LocalizationApi } from 'esengine';

describe('resolveLocale', () => {
  it('persisted value wins when it is a shipped locale', () => {
    expect(resolveLocale('zh-CN', 'en-US')).toBe('zh-CN');
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
  });

  it('falls back to the system language, mapping any zh variant to zh-CN', () => {
    expect(resolveLocale(undefined, 'zh-CN')).toBe('zh-CN');
    expect(resolveLocale(undefined, 'zh-Hans-CN')).toBe('zh-CN');
    expect(resolveLocale(undefined, 'zh')).toBe('zh-CN');
    expect(resolveLocale(undefined, 'en-US')).toBe('en');
    expect(resolveLocale(undefined, 'ja-JP')).toBe('en');
  });

  it('rejects junk persisted values (corrupt storage, removed locales)', () => {
    expect(resolveLocale('fr', 'en-US')).toBe('en');
    expect(resolveLocale(42, 'zh-CN')).toBe('zh-CN');
    expect(resolveLocale(null, 'en-US')).toBe('en');
  });
});

describe('catalog integrity', () => {
  it('keys are unique across area modules (no silent spread override)', () => {
    const perModule = Object.values(messageModules).map((m) => Object.keys(m).length);
    const total = perModule.reduce((a, b) => a + b, 0);
    expect(Object.keys(editorMessages).length).toBe(total);
  });

  it('placeholders match between languages on every entry', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, msg] of Object.entries(editorMessages)) {
      expect(params(msg.zh), `placeholder drift in '${key}'`).toEqual(params(msg.en));
    }
  });
});

describe('t()', () => {
  it('resolves English deterministically outside a browser window', () => {
    // Node ≥21 has a global navigator tracking the OS locale; the service must
    // ignore it without a window so this suite passes on any machine.
    expect(editorLocale).toBe('en');
    expect(t('cmd.entity.delete')).toBe('Delete');
  });

  it('interpolates params', () => {
    expect(t('set.layerN', { i: 3 })).toBe('Layer 3');
    expect(t('toast.updateAvailable', { version: '1.2.3' })).toContain('1.2.3');
  });

  it('the zh catalog serves the same keys through the shared engine', () => {
    // The editor's own t() is boot-locked to en here; drive a second
    // LocalizationApi over the same messages to pin the zh side.
    const zh: Record<string, string> = {};
    for (const [k, m] of Object.entries(editorMessages)) zh[k] = m.zh;
    const loc = new LocalizationApi('zh-CN', 'en');
    loc.addCatalog('zh-CN', zh);
    expect(loc.t('cmd.entity.delete')).toBe('删除');
    expect(loc.t('set.layerN', { i: 3 })).toBe('层 3');
  });
});
