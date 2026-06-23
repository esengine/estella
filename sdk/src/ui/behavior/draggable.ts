// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/draggable.ts
 * @brief   Back-compat shim — Draggable/DragState moved to the input concept
 *          module. Re-exported here to keep existing imports stable.
 */
export {
    Draggable,
    DragState,
    type DraggableData,
    type DragStateData,
} from '../input/draggable';
