// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Localization.ts
 * @brief   String localization (pure TypeScript). A per-App catalog registry +
 *          `t(key, params)` with `{placeholder}` interpolation and pluggable
 *          plural rules. Deliberately free of `Intl` so it behaves identically
 *          on web and WeChat (which lacks full Intl); supply a PluralSelector
 *          per locale for languages whose rules differ from the default.
 */

import { defineResource } from '../resource';

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** A pluralized message. `other` is required (the catch-all). */
export interface PluralForms {
    zero?: string;
    one?: string;
    two?: string;
    few?: string;
    many?: string;
    other: string;
}

export type LocaleEntry = string | PluralForms;
export type LocaleCatalog = Record<string, LocaleEntry>;
export type TParams = Record<string, string | number>;
export type PluralSelector = (count: number) => PluralCategory;

/** Default (English-like) rule: exactly 1 → `one`, everything else → `other`.
 *  `zero` is honored separately by selectPluralForm when count is 0. */
export const defaultPluralSelector: PluralSelector = (count) => (count === 1 ? 'one' : 'other');

/** Replace `{name}` placeholders from `params`; unknown placeholders are left
 *  intact so a missing binding is visible rather than silently blank. Pure. */
export function interpolate(template: string, params?: TParams): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole,
    );
}

/** Pick a plural form: explicit `zero` when count is 0, else the selector's
 *  category, falling back to `other`. Pure. */
export function selectPluralForm(forms: PluralForms, count: number, selector: PluralSelector): string {
    if (count === 0 && forms.zero !== undefined) return forms.zero;
    const category = selector(count);
    return forms[category] ?? forms.other;
}

/**
 * Per-App localization service: catalogs keyed by locale, an active locale + a
 * fallback, and `t()` resolution (active → fallback → the key itself). Published
 * as the {@link Localization} resource; read it as `app.getResource(Localization)`.
 */
export class LocalizationApi {
    private readonly catalogs = new Map<string, Map<string, LocaleEntry>>();
    private readonly selectors = new Map<string, PluralSelector>();
    private locale_: string;
    private fallback_: string;

    constructor(locale = 'en', fallback = 'en') {
        this.locale_ = locale;
        this.fallback_ = fallback;
    }

    /** Merge `entries` into a locale's catalog (later calls override keys). */
    addCatalog(locale: string, entries: LocaleCatalog): void {
        let m = this.catalogs.get(locale);
        if (!m) { m = new Map(); this.catalogs.set(locale, m); }
        for (const k of Object.keys(entries)) m.set(k, entries[k]);
    }

    setLocale(locale: string): void { this.locale_ = locale; }
    get locale(): string { return this.locale_; }

    setFallbackLocale(locale: string): void { this.fallback_ = locale; }
    get fallbackLocale(): string { return this.fallback_; }

    /** Override the plural rule for a locale (e.g. languages with few/many). */
    setPluralSelector(locale: string, selector: PluralSelector): void {
        this.selectors.set(locale, selector);
    }

    /** Locales that have a catalog, in insertion order. */
    availableLocales(): string[] {
        return [...this.catalogs.keys()];
    }

    /** True if the key resolves in the active locale or the fallback. */
    has(key: string): boolean {
        return this.lookup_(key) !== undefined;
    }

    /**
     * Translate `key`, interpolating `{params}`. A pluralized entry selects a
     * form from `params.count` (default 0). Unknown keys return the key itself
     * (a visible, greppable fallback) rather than throwing.
     */
    t(key: string, params?: TParams): string {
        const entry = this.lookup_(key);
        if (entry === undefined) return key;
        if (typeof entry === 'string') return interpolate(entry, params);
        const count = typeof params?.count === 'number' ? params.count : 0;
        const selector = this.selectors.get(this.locale_) ?? defaultPluralSelector;
        return interpolate(selectPluralForm(entry, count, selector), params);
    }

    private lookup_(key: string): LocaleEntry | undefined {
        return this.catalogs.get(this.locale_)?.get(key)
            ?? this.catalogs.get(this.fallback_)?.get(key);
    }
}

/**
 * Per-App localization resource, published by `LocalizationPlugin`. Read as
 * `app.getResource(Localization)`.
 */
export const Localization = defineResource<LocalizationApi>(null!, 'Localization');
