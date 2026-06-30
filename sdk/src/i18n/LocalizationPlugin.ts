// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LocalizationPlugin.ts
 * @brief   Registers the per-App Localization resource. Opt-in: add it via
 *          `app.addPlugin(localizationPlugin)` or with options.
 */

import type { App, Plugin } from '../app';
import { Localization, LocalizationApi, type LocaleCatalog } from './Localization';

export interface LocalizationOptions {
    /** Active locale (default 'en'). */
    locale?: string;
    /** Fallback locale when a key is missing in the active one (default 'en'). */
    fallback?: string;
    /** Catalogs to preload, keyed by locale. */
    catalogs?: Record<string, LocaleCatalog>;
}

export class LocalizationPlugin implements Plugin {
    name = 'localization';

    constructor(private readonly opts: LocalizationOptions = {}) {}

    build(app: App): void {
        const loc = new LocalizationApi(this.opts.locale, this.opts.fallback);
        if (this.opts.catalogs) {
            for (const locale of Object.keys(this.opts.catalogs)) {
                loc.addCatalog(locale, this.opts.catalogs[locale]);
            }
        }
        app.insertResource(Localization, loc);
    }
}

export const localizationPlugin = new LocalizationPlugin();
