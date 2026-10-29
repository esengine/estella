// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from '../../ecs/resource';
import type { Entity } from '../../types';
export interface ControlPointer {
    id: number;
    down: boolean;
    pressed: boolean;
    /** Captured control while held; null on a released/hover-only pointer. */
    entity: Entity | null;
    /** Press edge target, only populated in the frame the capture starts. */
    pressedEntity: Entity | null;
    layoutX: number;
    layoutY: number;
    worldX: number;
    worldY: number;
    /** The pointer on the drawing surface: pixels, origin bottom-left — what a camera's `screenToWorld` takes. */
    screenX: number;
    screenY: number;
}

/** What a pointer event says about the pointer that made it. */
export interface UiPointerEventData {
    pointer: number;
    worldX: number;
    worldY: number;
    layoutX: number;
    layoutY: number;
    screenX: number;
    screenY: number;
}
/** Per-app projection of the UI hit tester's captures; never a second raycast. */
export interface UIControlPointersData {
    pointers: Map<number, ControlPointer>;
    /**
     * Take what @p pointer is holding away from it: the held entity gets `press_cancel` and is clicked by nothing when the pointer
     * lifts. With @p to, that entity holds the pointer from now on and hears its moves and its release — a scroll area that has
     * decided a drag is a drag takes it from the button under the finger this way.
     */
    cancelHold(pointer: number, to?: Entity): void;
}
export const UIControlPointers = defineResource<UIControlPointersData>({ pointers: new Map(), cancelHold: () => {} }, 'UIControlPointers');
