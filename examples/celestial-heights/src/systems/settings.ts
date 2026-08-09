import { defineSystem, Res, Input, Localization } from 'esengine';

/**
 * Cycles the language. Every bound `Text` re-flows on the next frame from its
 * `i18nKey`, so nothing here touches a label — this is the whole of what the
 * settings menu will call once it exists.
 */
export const cycleLanguageSystem = defineSystem(
    [Res(Input), Res(Localization)],
    (input, i18n) => {
        if (!input.isKeyPressed('KeyL')) return;
        const locales = i18n.availableLocales();
        if (locales.length < 2) return;
        const next = (locales.indexOf(i18n.locale) + 1) % locales.length;
        i18n.setLocale(locales[next]);
    },
    { name: 'CycleLanguageSystem' },
);
