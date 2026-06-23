// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/UILayoutPlugin.ts
 * @brief   Back-compat shim — the Yoga layout driver moved into the layout
 *          concept module (REARCH_GUI P0). Re-exported here to keep the
 *          public symbol + existing imports stable until REARCH_GUI P4.
 */
export { UILayoutPlugin, uiLayoutPlugin } from './layout/layout';
