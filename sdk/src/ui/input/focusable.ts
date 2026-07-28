// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/input/focusable.ts
 * @brief   Keyboard-focus primitives: Focusable component + the FocusManager
 *          resource tracking the currently-focused entity. Driven by the
 *          FocusPlugin system in this concept module.
 */
import { defineComponent } from '../../ecs/component';
import { defineResource } from '../../ecs/resource';
import type { Entity } from '../../types';

export interface FocusableData {
    tabIndex: number;
    isFocused: boolean;
}

export const Focusable = defineComponent<FocusableData>('Focusable', {
    tabIndex: 0,
    isFocused: false,
});

export class FocusManagerState {
    focusedEntity: Entity | null = null;

    /**
     * Whether the current focus should be SHOWN — the `:focus-visible` rule the web
     * arrived at, for the same reason.
     *
     * Focus follows a pointer press (so Enter/Space then act on what you clicked),
     * but a clicked control that keeps a focus highlight reads as stuck: the pointer
     * has moved on and the button is still lit, until you click something else. Only
     * keyboard-acquired focus is worth drawing, because only then is the highlight
     * the sole thing telling you where you are.
     *
     * Lives here rather than on {@link Focusable} because it is per-session input
     * state, like hover — authoring it into a scene would mean nothing.
     */
    focusVisible = false;

    /** `visible` = acquired by keyboard. Pointer presses pass false. */
    focus(entity: Entity, visible = false): Entity | null {
        const prev = this.focusedEntity;
        this.focusedEntity = entity;
        this.focusVisible = visible;
        return prev;
    }

    blur(): Entity | null {
        const prev = this.focusedEntity;
        this.focusedEntity = null;
        this.focusVisible = false;
        return prev;
    }

    /** Whether `entity` holds focus AND that focus should be drawn. */
    isVisiblyFocused(entity: Entity): boolean {
        return this.focusedEntity === entity && this.focusVisible;
    }
}

export const FocusManager = defineResource<FocusManagerState>(
    new FocusManagerState(), 'FocusManager'
);
