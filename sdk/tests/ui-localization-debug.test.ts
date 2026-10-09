// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { LocalizationAPI } from '../src/i18n/Localization';
import { pseudoLocalize } from '../src/i18n/pseudo-localization';
import { inspectTextLayout } from '../src/ui/text/inspect-text';

describe('localization preview', () => {
    it('preserves markup, parameters and line boundaries', () => {
        expect(pseudoLocalize('<b>Hello {name}</b>\n\n[image=star]', { expansion: 0 }))
            .toBe('⟦<b>Ĥéľľó {name}</b>⟧\n\n⟦[image=star]⟧');
    });
    it('selects plurals before preview and leaves bound values intact', () => {
        const loc = new LocalizationAPI();
        loc.addCatalog('en', { count: { one: '{count} item for {name}', other: '{count} items for {name}' } });
        loc.setPseudoLocalization({ expansion: 0 });
        expect(loc.t('count', { count: 2, name: 'Alice' })).toBe('⟦2 íţéṁš ƒóŕ Alice⟧');
        expect(loc.t('missing')).toBe('missing');
        loc.setPseudoLocalization(null);
        expect(loc.t('count', { count: 1, name: 'Alice' })).toBe('1 item for Alice');
    });
    it('bounds malformed or extreme expansion settings', () => {
        expect(pseudoLocalize('Hi', { accents: false, expansion: Infinity })).toBe('⟦Hi~⟧');
        expect(pseudoLocalize('Hi', { accents: false, expansion: -1 })).toBe('⟦Hi⟧');
    });
});

describe('text inspection', () => {
    const box = { width: 30, height: 12, fontSize: 10, lineHeight: 12 };
    it('reports overflow before clipping instead of treating truncation as fitting', () => {
        expect(inspectTextLayout('123456', box).horizontalOverflow).toBe(true);
        expect(inspectTextLayout('123456', { ...box, wordWrap: true }).verticalOverflow).toBe(true);
        expect(inspectTextLayout('12', box).metrics?.lineCount).toBe(1);
    });
    it('counts explicit empty lines and uses configured line height', () => {
        expect(inspectTextLayout('A\n\nB', box).metrics?.height).toBe(36);
    });
    it('does not claim shaped, rich or custom-font text fits', () => {
        expect(inspectTextLayout('العربية', box).unsupported).toBe('complex-script');
        expect(inspectTextLayout('ไทย', box).unsupported).toBe('complex-script');
        expect(inspectTextLayout('e\u0301', box).unsupported).toBe('complex-script');
        expect(inspectTextLayout('<b>Hi</b>', { ...box, richText: true }).unsupported).toBe('rich-text');
        expect(inspectTextLayout('Hi', { ...box, customFont: true }).unsupported).toBe('custom-font');
        expect(inspectTextLayout('Hi', { ...box, width: 0 }).unsupported).toBe('invalid-box');
        expect(inspectTextLayout('Hi', { ...box, lineHeight: -1 }).unsupported).toBe('invalid-box');
    });
});
