// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Localization (i18n) module barrel.
 */

export {
    Localization,
    LocalizationAPI,
    interpolate,
    selectPluralForm,
    defaultPluralSelector,
    parseLocaleTable,
    matchLocale,
    type LocaleTableAsset,
    type PluralCategory,
    type PluralForms,
    type LocaleEntry,
    type LocaleCatalog,
    type TParams,
    type PluralSelector,
} from './Localization';

export {
    LocalizationPlugin,
    localizationPlugin,
    type LocalizationOptions,
} from './LocalizationPlugin';
