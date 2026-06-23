// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/focusable.ts
 * @brief   Back-compat shim — Focusable/FocusManager moved to the input concept
 *          module. Re-exported here to keep existing imports stable.
 */
export {
    Focusable,
    FocusManager,
    FocusManagerState,
    type FocusableData,
} from '../input/focusable';
