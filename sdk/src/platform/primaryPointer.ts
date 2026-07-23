// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    primaryPointer.ts
 * @brief   The primary-pointer synthesis every touch host shares. The first
 *          active touch drives pointer 0 (down / move / up); a concurrent second
 *          touch is still forwarded as a raw touch but does not move the pointer.
 *          The primary touch's END or CANCEL both release the pointer, so a
 *          cancelled gesture never leaves it stuck down. Adapters (web / native /
 *          mini-game) feed it already-extracted `(id, x, y)`; the state machine
 *          lives here once instead of being copied per adapter.
 */
import type { InputEventCallbacks } from './types';

export interface PrimaryPointer {
    start(id: number, x: number, y: number): void;
    move(id: number, x: number, y: number): void;
    end(id: number): void;
    cancel(id: number): void;
}

export function createPrimaryPointer(callbacks: InputEventCallbacks): PrimaryPointer {
    let primary: number | null = null;
    return {
        start(id, x, y) {
            callbacks.onTouchStart?.(id, x, y);
            if (primary === null) {
                primary = id;
                callbacks.onPointerDown(0, x, y);
            }
        },
        move(id, x, y) {
            callbacks.onTouchMove?.(id, x, y);
            if (id === primary) callbacks.onPointerMove(x, y);
        },
        end(id) {
            callbacks.onTouchEnd?.(id);
            if (id === primary) {
                primary = null;
                callbacks.onPointerUp(0);
            }
        },
        cancel(id) {
            callbacks.onTouchCancel?.(id);
            if (id === primary) {
                primary = null;
                callbacks.onPointerUp(0);
            }
        },
    };
}
