// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/DragPlugin.ts
 * @brief   Back-compat shim — the drag plugin moved to the input concept module
 *          (REARCH_GUI P0). Re-exported here to keep the public symbol +
 *          existing imports stable until REARCH_GUI P4.
 */
export { DragPlugin, dragPlugin } from './input/drag';
