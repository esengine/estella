// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../../ecs/component';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { UINode, UIDisplay } from './ui-node';

export interface UIDialogData {
    /** Escape closes the dialog while open. */
    closeOnEscape: boolean;
    /** A click on the backdrop scrim (not the panel) closes the dialog. */
    closeOnBackdrop: boolean;
}

export const UIDialog = defineComponent<UIDialogData>('UIDialog', {
    closeOnEscape: true,
    closeOnBackdrop: true,
});

/** True when the dialog root's subtree is displayed. */
export function isDialogOpen(world: Pick<World, 'has' | 'get'>, root: Entity): boolean {
    if (!world.has(root, UINode)) return false;
    return world.get(root, UINode).display !== UIDisplay.None;
}
