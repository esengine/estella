// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from 'vitest';
import { LocalizationAPI, localeCatalogsFor, type LocaleCatalog } from '../src/i18n/Localization';
import { localeTableKeyCount } from '../src/i18n/localeCatalogs';
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

it('lists languages and refreshes individual labels without traversing unrelated translations', () => {
    const service = new LocalizationAPI('en', 'fr');
    const index = localeCatalogsFor(service);
    const owner = {};
    const traversed = vi.fn((entries: LocaleCatalog) => Reflect.ownKeys(entries));
    const file = (locale: string, entries: LocaleCatalog) => ({ version: 1, locale,
        entries: new Proxy(entries, { ownKeys: traversed }),
    });
    index.setProject(owner, ['base', 'overlay', 'french']);
    const labels = Object.fromEntries(Array.from({ length: 48 }, (_, i) => [`label${i}`, `Label ${i}`]));
    const base = file('en', { ...labels, title: 'Home', subtitle: 'Hello' });
    const overlay = file('en', { title: 'Welcome' });
    const french = file('fr', { message: 'Bonjour' });
    const updated = file('fr', { message: 'Salut' });
    const replacement = file('de', { title: 'Hallo' });
    // The registry counts decoded entries once, before publishing the tables.
    for (const table of [base, overlay, french, updated, replacement]) localeTableKeyCount(table);
    traversed.mockClear();
    index.usePublished(owner, 'base', base);
    index.usePublished(owner, 'overlay', overlay);
    index.usePublished(owner, 'french', french);
    expect(service.availableLocales()).toEqual(['en', 'fr']);
    expect(traversed).not.toHaveBeenCalled();
    expect(service.t('title')).toBe('Welcome');
    expect(service.t('message')).toBe('Bonjour');
    index.refreshPublished(owner, 'french', french, updated);
    expect(service.t('message')).toBe('Salut');
    index.refreshPublished(owner, 'overlay', overlay, replacement);
    expect(service.availableLocales()).toEqual(['en', 'de', 'fr']);
    expect(service.t('title')).toBe('Home');
    expect(traversed).not.toHaveBeenCalled();
});

it('keeps bulk lookup in split languages bounded and honors file and code precedence after refresh', () => {
    const service = new LocalizationAPI();
    const index = localeCatalogsFor(service);
    const owner = {};
    const paths = Array.from({ length: 24 }, (_, i) => `${i}.eslocale`);
    const probes = vi.fn(Reflect.getOwnPropertyDescriptor);
    const tables = paths.map((path, i) => ({ version: 1, locale: 'en',
        entries: new Proxy({ shared: path, [`key${i}`]: path }, { getOwnPropertyDescriptor: probes }),
    }));
    service.addCatalog('en', { shared: 'inline before project' });
    index.setProject(owner, paths);
    paths.forEach((path, i) => index.usePublished(owner, path, tables[i]));
    for (let round = 0; round < 3; round++) paths.forEach((path, i) => expect(service.t(`key${i}`, {})).toBe(path));
    probes.mockClear();
    paths.forEach((path, i) => expect(service.t(`key${i}`, {})).toBe(path));
    expect(probes.mock.calls.length).toBeLessThanOrEqual(paths.length);
    expect(service.t('shared')).toBe(paths[23]);
    service.addCatalog('en', { shared: 'inline after project' });
    paths.forEach((path, i) => expect(service.t(`key${i}`, {})).toBe(path));
    expect(service.t('shared', {})).toBe('inline after project');
    const replacement = { version: 1, locale: 'es', entries: { key23: 'Español' } };
    index.refreshPublished(owner, paths[23], tables[23], replacement);
    expect(service.t('shared')).toBe('inline after project');
    expect(service.has('key23')).toBe(false);
    service.setLocale('es');
    expect(service.t('key23')).toBe('Español');
    index.setProject(owner, paths.slice(0, -1).reverse());
    expect(service.availableLocales()).toEqual(['en']);
    expect(service.t('key23')).toBe('key23');
});
