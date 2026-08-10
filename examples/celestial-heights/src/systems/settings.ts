import { defineSystem, Res, Localization } from 'esengine';
import { Actions, BINDINGS_KEY } from '../actions';
import { loadSettings, saveSettings } from '../settings';
import { session } from '../state';

/**
 * Reads back what the player chose last time — their language, whether effects
 * are drawn, and their own key bindings, which the input map serializes itself.
 */
export const applySettingsSystem = defineSystem(
    [Res(Localization)],
    (i18n) => {
        const settings = loadSettings();
        if (settings.locale) i18n.setLocale(settings.locale);
        session.effects = settings.effects;
        Actions.load(BINDINGS_KEY);
    },
    { name: 'ApplySettingsSystem' },
);

/**
 * Cycles the language. Every bound `Text` re-flows on the next frame from its
 * `i18nKey`, so nothing here touches a label — this is the whole of what the
 * settings menu will call once it exists.
 */
export const cycleLanguageSystem = defineSystem(
    [Res(Localization)],
    (i18n) => {
        if (!Actions.pressed('Language')) return;
        const locales = i18n.availableLocales();
        if (locales.length < 2) return;
        const next = (locales.indexOf(i18n.locale) + 1) % locales.length;
        i18n.setLocale(locales[next]);
        saveSettings({ locale: locales[next], effects: session.effects });
    },
    { name: 'CycleLanguageSystem' },
);
