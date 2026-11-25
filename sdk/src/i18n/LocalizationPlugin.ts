// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LocalizationPlugin.ts
 * @brief   Registers the per-App Localization resource. Opt-in: add it via
 *          `app.addPlugin(localizationPlugin)` or with options.
 */
import type { App, Plugin } from '../app/app';
import { Schedule, defineSystem } from '../ecs/system';
import { Assets } from '../asset/AssetPlugin';
import { log } from '../util/logger';
import { Localization, LocalizationAPI, type LocaleCatalog } from './Localization';

const startupTables = new WeakMap<LocalizationAPI, readonly string[]>();

/** @internal A prepared scene uses whichever localization service the game has installed at publication. */
export function configuredLocaleTables(app: App): readonly string[] {
    return app.hasResource(Localization) ? startupTables.get(app.getResource(Localization)) ?? [] : [];
}

/** @internal Declared tables override discovered ones in their configured order. */
export function installProjectLocaleTables(app: App, discovered?: readonly string[]): Promise<void> {
    return app.getResource(Assets).installProjectLocaleTables(configuredLocaleTables(app), discovered);
}

export interface LocalizationOptions {
    /** Active locale (default 'en'). */
    locale?: string;
    /** Fallback locale when a key is missing in the active one (default 'en'). */
    fallback?: string;
    /** Catalogs to preload, keyed by locale. */
    catalogs?: Record<string, LocaleCatalog>;
    /**
     * `.eslocale` string-table assets to load at startup (paths or `@uuid:`
     * refs). Later tables override earlier ones. Requires the AssetPlugin.
     */
    tables?: string[];
}

export class LocalizationPlugin implements Plugin {
    name = 'localization';

    constructor(private readonly opts: LocalizationOptions = {}) {}

    build(app: App): void {
        const loc = new LocalizationAPI(this.opts.locale, this.opts.fallback);
        if (this.opts.catalogs) {
            for (const locale of Object.keys(this.opts.catalogs)) {
                loc.addCatalog(locale, this.opts.catalogs[locale]);
            }
        }
        app.insertResource(Localization, loc);

        const tables = this.opts.tables;
        if (tables && tables.length > 0) {
            startupTables.set(loc, [...tables]);
            // Startup runs after every plugin build, so the Assets resource is
            // there regardless of install order. Loads are fire-and-forget —
            // the resolve system re-flows bound text the frame a table lands —
            // but a failed table is a shipped-content error: log it loud.
            app.addSystemToSchedule(Schedule.Startup, defineSystem([], () => {
                if (!app.hasResource(Assets)) {
                    log.error('i18n', `LocalizationPlugin: 'tables' needs the AssetPlugin — ${tables.length} table(s) not loaded`);
                    return;
                }
                void installProjectLocaleTables(app);
            }, { name: 'LocaleTableStartupSystem' }));
        }
    }
}

export const localizationPlugin = new LocalizationPlugin();
