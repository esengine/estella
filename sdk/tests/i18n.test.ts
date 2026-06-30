// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    LocalizationApi,
    interpolate,
    selectPluralForm,
    defaultPluralSelector,
    type PluralSelector,
} from '../src/i18n/Localization';

describe('interpolate', () => {
    it('replaces {placeholders} from params', () => {
        expect(interpolate('Hello {name}!', { name: 'Bob' })).toBe('Hello Bob!');
        expect(interpolate('{a}+{b}={c}', { a: 1, b: 2, c: 3 })).toBe('1+2=3');
    });
    it('leaves unknown placeholders intact', () => {
        expect(interpolate('Hi {name}', {})).toBe('Hi {name}');
        expect(interpolate('Hi {name}')).toBe('Hi {name}');
    });
});

describe('selectPluralForm', () => {
    const forms = { zero: 'no items', one: 'one item', other: '{count} items' };
    it('honors explicit zero at count 0', () => {
        expect(selectPluralForm(forms, 0, defaultPluralSelector)).toBe('no items');
    });
    it('default selector: 1 → one, else other', () => {
        expect(selectPluralForm(forms, 1, defaultPluralSelector)).toBe('one item');
        expect(selectPluralForm(forms, 5, defaultPluralSelector)).toBe('{count} items');
    });
    it('falls back to other when a category form is absent', () => {
        expect(selectPluralForm({ other: 'x' }, 1, defaultPluralSelector)).toBe('x');
    });
    it('supports a custom selector', () => {
        const ru: PluralSelector = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'one' : 'many');
        expect(selectPluralForm({ one: 'один', many: 'много', other: 'o' }, 21, ru)).toBe('один');
        expect(selectPluralForm({ one: 'один', many: 'много', other: 'o' }, 5, ru)).toBe('много');
    });
});

describe('LocalizationApi', () => {
    function setup() {
        const loc = new LocalizationApi('en', 'en');
        loc.addCatalog('en', {
            greeting: 'Hello {name}',
            apples: { zero: 'no apples', one: 'one apple', other: '{count} apples' },
            onlyEn: 'english only',
        });
        loc.addCatalog('zh', {
            greeting: '你好 {name}',
            apples: { other: '{count} 个苹果' },
        });
        return loc;
    }

    it('translates + interpolates in the active locale', () => {
        const loc = setup();
        expect(loc.t('greeting', { name: 'Bob' })).toBe('Hello Bob');
        loc.setLocale('zh');
        expect(loc.t('greeting', { name: '小明' })).toBe('你好 小明');
    });

    it('pluralizes from params.count', () => {
        const loc = setup();
        expect(loc.t('apples', { count: 0 })).toBe('no apples');
        expect(loc.t('apples', { count: 1 })).toBe('one apple');
        expect(loc.t('apples', { count: 7 })).toBe('7 apples');
        loc.setLocale('zh');
        expect(loc.t('apples', { count: 3 })).toBe('3 个苹果');
    });

    it('falls back to the fallback locale for missing keys', () => {
        const loc = setup();
        loc.setLocale('zh'); // zh has no 'onlyEn'
        expect(loc.t('onlyEn')).toBe('english only');
    });

    it('returns the key itself when unresolved anywhere', () => {
        const loc = setup();
        expect(loc.t('does.not.exist')).toBe('does.not.exist');
        expect(loc.has('does.not.exist')).toBe(false);
        expect(loc.has('greeting')).toBe(true);
    });

    it('addCatalog merges (later overrides)', () => {
        const loc = setup();
        loc.addCatalog('en', { greeting: 'Hi {name}' });
        expect(loc.t('greeting', { name: 'A' })).toBe('Hi A');
        expect(loc.t('onlyEn')).toBe('english only'); // untouched
    });

    it('availableLocales + custom plural selector', () => {
        const loc = setup();
        expect(loc.availableLocales()).toEqual(['en', 'zh']);
        loc.setPluralSelector('en', () => 'other');
        expect(loc.t('apples', { count: 1 })).toBe('1 apples'); // selector forces other
    });
});
