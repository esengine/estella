// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from 'vitest';
import { LocalizationAPI } from '../src/i18n/Localization';
import * as preview from '../src/i18n/pseudo-localization';

afterEach(() => vi.restoreAllMocks());

it('avoids repeating preview expansion for unchanged plain UI labels', () => {
    const loc = new LocalizationAPI();
    loc.addCatalog('en', { label: 'Settings' });
    loc.setPseudoLocalization({ expansion: 1 });
    const expansion = vi.spyOn(preview, 'pseudoLocalize');
    const first = loc.t('label');
    for (let frame = 0; frame < 100; frame++) expect(loc.t('label')).toBe(first);
    expect(expansion).toHaveBeenCalledTimes(1);
});

it('updates warmed labels on locale, fallback, catalog and preview changes', () => {
    const loc = new LocalizationAPI();
    loc.addCatalog('en', { label: 'Settings' });
    loc.addCatalog('zh', { label: '设置' });
    expect(loc.t('label')).toBe('Settings');
    loc.setLocale('zh'); expect(loc.t('label')).toBe('设置');
    loc.setLocale('unknown'); expect(loc.t('label')).toBe('Settings');
    loc.setFallbackLocale('zh'); expect(loc.t('label')).toBe('设置');
    loc.addCatalog('zh', { label: '音量' }); expect(loc.t('label')).toBe('音量');
    loc.setPseudoLocalization({ expansion: 1, accents: false });
    expect(loc.t('label')).toBe(preview.pseudoLocalize('音量', { expansion: 1, accents: false }));
    loc.setPseudoLocalization(null); expect(loc.t('label')).toBe('音量');
    expect(loc.t('new')).toBe('new');
    loc.addCatalog('zh', { new: '新增' }); expect(loc.t('new')).toBe('新增');
    loc.addCatalog('zh', { label: { zero: '零项', other: '多个' } });
    expect(loc.t('label')).toBe('零项');
});

it('keeps parameters and externally stateful plural rules live', () => {
    const loc = new LocalizationAPI();
    const forms = { zero: 'zero', other: 'other' };
    loc.addCatalog('en', { greeting: 'Hello {name}', plural: forms });
    expect(loc.t('greeting')).toBe('Hello {name}');
    expect(loc.t('greeting', { name: 'Alice' })).toBe('Hello Alice');
    expect(loc.t('greeting', { name: 'Bob' })).toBe('Hello Bob');
    expect(loc.t('plural')).toBe('zero');
    forms.zero = 'updated'; expect(loc.t('plural')).toBe('updated');
    let category: 'one' | 'other' = 'one';
    loc.addCatalog('en', { dynamic: { one: 'one', other: 'other' } });
    loc.setPluralSelector('en', () => category);
    expect(loc.t('dynamic')).toBe('one');
    category = 'other'; expect(loc.t('dynamic')).toBe('other');
});

it('evicts old cached translations while keeping results correct', () => {
    const loc = new LocalizationAPI();
    loc.addCatalog('en', Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, `Label ${i}`])));
    loc.setPseudoLocalization({ expansion: 0 });
    const expansion = vi.spyOn(preview, 'pseudoLocalize');
    for (let i = 0; i < 300; i++) loc.t(`key${i}`);
    expansion.mockClear();
    expect(loc.t('key299')).toBe(preview.pseudoLocalize('Label 299', { expansion: 0 }));
    expansion.mockClear(); loc.t('key299'); expect(expansion).not.toHaveBeenCalled();
    loc.t('key0'); expect(expansion).toHaveBeenCalledTimes(1);
});
