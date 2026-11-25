// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LocaleAssetLoader.ts
 * @brief   Prepares a string table for its registry slot. Only a committed
 *          publication contributes translations to the app's catalog.
 *
 * A speculative scene can decode tables before the app has a Localization
 * resource. Direct loads and active project tables own catalog publication.
 */

import type { AssetLoader, LocaleResult, RegistryAssetLoader } from '../AssetLoader';
import { localeCatalogsFor, parseLocaleTable } from '../../i18n/Localization';

export class LocaleAssetLoader implements AssetLoader<LocaleResult> {
    readonly type = 'locale';
    readonly extensions = ['.eslocale'];

    constructor(private readonly owner: object) {}

    readonly registry: RegistryAssetLoader<LocaleResult> = {
        prepare: async (path, ctx, slot) => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const table = parseLocaleTable(text, path);
            return {
                published: table, value: { locale: table.locale, keyCount: Object.keys(table.entries).length },
                didPublish: previous => {
                    const service = ctx.getLocalization();
                    if (service) localeCatalogsFor(service).refreshPublished(this.owner, slot?.key ?? path, previous, table);
                },
            };
        },
    };
}
