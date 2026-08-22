// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/input/draggable.ts
 * @brief   Drag config (Draggable) + runtime drag state (DragState) components.
 *          Driven by the DragPlugin system in this concept module.
 */
import { defineComponent } from '../../ecs/component';

// An engine component now, so it reaches the inspector, the scene file and the
// reflection table like any other, and its defaults come from the C++ struct.
// Defined with the rest of them; re-exported here so this stays the drag module.
export { Draggable } from '../../ecs/component';
export type { DraggableData } from '../../ecs/component';

export interface DragStateData {
    isDragging: boolean;
    startWorldPos: { x: number; y: number };
    currentWorldPos: { x: number; y: number };
    deltaWorld: { x: number; y: number };
    totalDeltaWorld: { x: number; y: number };
    pointerStartWorld: { x: number; y: number };
}

// Per-frame drag state written by the drag system — never authored, never
// persisted, so it stays a script component and never crosses the wasm boundary.
export const DragState = defineComponent<DragStateData>('DragState', {
    isDragging: false,
    startWorldPos: { x: 0, y: 0 },
    currentWorldPos: { x: 0, y: 0 },
    deltaWorld: { x: 0, y: 0 },
    totalDeltaWorld: { x: 0, y: 0 },
    pointerStartWorld: { x: 0, y: 0 },
}, { transient: true });
