// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LocaleAssetLoader.ts
 * @brief   Loads a `.eslocale` string table and merges it into the app's
 *          Localization catalogs — translations ship as data, not code.
 *
 * One file carries ONE locale (`{ version, locale, entries }`), so a game
 * loads only the languages it needs. Requires the LocalizationPlugin: with no
 * Localization resource the table has nowhere to register, and that is a
 * setup error worth failing loud over — not a silent no-op.
 */

import type { AssetLoader, LoadContext, LocaleResult } from '../AssetLoader';
import { parseLocaleTable } from '../../i18n/Localization';

export class LocaleAssetLoader implements AssetLoader<LocaleResult> {
    readonly type = 'locale';
    readonly extensions = ['.eslocale'];

    async load(path: string, ctx: LoadContext): Promise<LocaleResult> {
        const i18n = ctx.getLocalization();
        if (!i18n) {
            throw new Error(
                `${path}: no Localization resource — add localizationPlugin to the app before loading locale tables`,
            );
        }
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const table = parseLocaleTable(text, path);
        i18n.addCatalog(table.locale, table.entries);
        return { locale: table.locale, keyCount: Object.keys(table.entries).length };
    }

    unload(): void {
        // Catalogs merge; there is no per-table removal (same contract as the
        // FSM/BT stores). A reloaded table simply re-merges its keys.
    }
}
