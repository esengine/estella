// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  index.ts — editor localization, built on the ENGINE's LocalizationAPI
 *        (one i18n engine for games and the editor — no second library). The
 *        locale is resolved ONCE at module load, before any other editor module
 *        evaluates: command labels, settings descriptors, and menu titles are
 *        registered at import time, so a per-session locale keeps every surface
 *        consistent. Changing the language setting prompts a reload (the
 *        renderer-backend precedent) rather than re-rendering half the strings.
 *
 *        t(key) is typed over the merged catalog — a typo'd key or a key
 *        missing a language is a compile error, not a runtime blank.
 */
import { LocalizationAPI, type TParams } from 'esengine';
import { editorMessages } from './messages';

export type { Message, MessageMap } from './messages/types';
export { editorMessages };

export type EditorLocale = 'en' | 'zh-CN';
export type MsgKey = keyof typeof editorMessages;

/** Languages offered in Settings. Labels are the languages' own names — never translated. */
export const EDITOR_LOCALES: { value: EditorLocale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
];

/**
 * Pure boot-locale rule: the persisted setting wins when valid, else the system
 * language (any zh variant → zh-CN), else English.
 */
export function resolveLocale(persisted: unknown, systemLang: string): EditorLocale {
    if (persisted === 'en' || persisted === 'zh-CN') return persisted;
    return /^zh/i.test(systemLang) ? 'zh-CN' : 'en';
}

// Reads the language straight from the settings store's persistence (the
// LS_KEY/value-map contract in store/settingsStore.ts) — importing the store
// here would cycle (settings descriptors import t()).
const LS_SETTINGS_KEY = 'estella.settings';
export const LANGUAGE_SETTING_ID = 'appearance.language';

function readPersistedLanguage(): unknown {
    if (typeof localStorage === 'undefined') return undefined;
    try {
        const values = JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
        return values[LANGUAGE_SETTING_ID];
    } catch {
        return undefined;
    }
}

// System-language detection wants a real renderer window: Node ≥21 also has a
// global navigator whose language tracks the OS, which would make the node test
// suite locale-dependent. Outside a window, English — deterministically.
const systemLang = typeof window !== 'undefined' && typeof navigator !== 'undefined' ? navigator.language : 'en';

/** What the language setting resets to: the OS language, clamped to what we ship. */
export const systemDefaultLocale: EditorLocale = resolveLocale(undefined, systemLang);

/** The locale this editor session renders in — fixed for the session's lifetime. */
export const editorLocale: EditorLocale = resolveLocale(readPersistedLanguage(), systemLang);

const loc = new LocalizationAPI(editorLocale, 'en');
{
    const en: Record<string, string> = {};
    const zh: Record<string, string> = {};
    for (const key of Object.keys(editorMessages) as MsgKey[]) {
        en[key] = editorMessages[key].en;
        zh[key] = editorMessages[key].zh;
    }
    loc.addCatalog('en', en);
    loc.addCatalog('zh-CN', zh);
}

/** Translate an editor string. `{name}` placeholders interpolate from `params`. */
export function t(key: MsgKey, params?: TParams): string {
    return loc.t(key, params);
}
