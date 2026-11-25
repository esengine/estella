// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LocaleAssetLoader.ts
 * @brief   Prepares a string table for its registry slot. Only a committed
 *          publication contributes translations to the app's catalog.
 *
 * One file carries ONE locale (`{ version, locale, entries }`), so a game
 * loads only the languages it needs. Requires the LocalizationPlugin: with no
 * Localization resource the table has nowhere to register, and that is a
 * setup error worth failing loud over — not a silent no-op.
 */

import type { AssetLoader, LocaleResult, RegistryAssetLoader } from '../AssetLoader';
import { localeCatalogsFor, parseLocaleTable } from '../../i18n/Localization';

export class LocaleAssetLoader implements AssetLoader<LocaleResult> {
    readonly type = 'locale';
    readonly extensions = ['.eslocale'];

    constructor(private readonly owner: object) {}

    readonly registry: RegistryAssetLoader<LocaleResult> = {
        prepare: async (path, ctx, slot) => {
            const localization = ctx.getLocalization();
            if (!localization) {
                throw new Error(`${path}: no Localization resource — add localizationPlugin to the app before loading locale tables`);
            }
            const publish = localeCatalogsFor(localization).prepare(slot?.key ?? path, this.owner, slot);
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const table = parseLocaleTable(text, path);
            return {
                published: table, value: { locale: table.locale, keyCount: Object.keys(table.entries).length },
                didPublish: () => publish(table),
            };
        },
    };
}
