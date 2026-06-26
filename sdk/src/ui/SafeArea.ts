// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/SafeArea.ts
 * @brief   Back-compat shim — the SafeArea component moved into the layout
 *          concept module. Re-exported here to keep the public symbol +
 *          existing imports stable.
 */
export { SafeArea, type SafeAreaData } from './layout/safe-area';
