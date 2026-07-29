// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineBuiltin } from '../../ecs/component';

export const ScrollMovement = {
    /** Stop dead at the ends. */
    Clamped: 0,
    /** Overshoot and spring back — the touch-UI feel. */
    Elastic: 1,
} as const;
export type ScrollMovement = (typeof ScrollMovement)[keyof typeof ScrollMovement];

/**
 * A scrollable viewport, authored in the scene rather than constructed in code.
 * `uiBehaviorPlugin` attaches a ScrollContainer to every entity carrying one.
 */
export interface UIScrollData {
    enabled: boolean;
    /** The child that moves; 0 ⇒ this node's first child. */
    content: number;
    horizontal: boolean;
    vertical: boolean;
    movement: ScrollMovement;
    wheelSpeed: number;
    dragScroll: boolean;
    /** Fraction of flick velocity kept per second; 0 stops on release. */
    decelerationRate: number;
}

export const UIScroll = defineBuiltin<UIScrollData>('UIScroll', {
    enabled: true,
    content: 0,
    horizontal: false,
    vertical: true,
    movement: ScrollMovement.Clamped,
    wheelSpeed: 1,
    dragScroll: true,
    decelerationRate: 0.135,
});
