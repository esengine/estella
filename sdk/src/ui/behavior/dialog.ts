// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/dialog.ts
 * @brief   UIDialog — data-driven modal dismissal.
 *
 * The component lives on the dialog's backdrop root; its open state IS the
 * root's `UINode.display` (no shadow state to desync). The system owns the two
 * standard dismissal affordances — Escape and a click on the backdrop scrim —
 * so a dialog instantiated from a prefab behaves without any code hookup.
 * `createDialog` composes this; the panel swallows clicks with its own
 * Interactable, so only true scrim clicks dismiss.
 */
import { defineComponent } from '../../component';
import { defineSystem, type SystemDef } from '../../system';
import { Res } from '../../resource';
import { Input, type InputState } from '../../input';
import type { World } from '../../world';
import type { Entity } from '../../types';
import { UINode, UIDisplay, type UINodeData } from '../core/ui-node';
import { UIInteraction, type UIInteractionData } from '../input/interactable';
import { UIEventType, type UIEventQueue } from '../core/events';

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
export function isDialogOpen(world: World, root: Entity): boolean {
    if (!world.has(root, UINode)) return false;
    return (world.get(root, UINode) as UINodeData).display !== UIDisplay.None;
}

/** Show/hide the dialog subtree and emit `change` with the new open state. */
export function setDialogOpen(
    world: World, events: UIEventQueue, root: Entity, open: boolean,
): void {
    if (!world.has(root, UINode) || isDialogOpen(world, root) === open) return;
    const node = world.get(root, UINode) as UINodeData;
    node.display = open ? UIDisplay.Flex : UIDisplay.None;
    world.insert(root, UINode, node);
    events.emit(root, UIEventType.Change, { open });
}

/** Applies UIDialog's dismissal affordances to every open dialog. */
export function createDialogSystem(world: World, events: UIEventQueue): SystemDef {
    return defineSystem([Res(Input)], (input: InputState) => {
        const escape = input.isKeyPressed('Escape');
        for (const e of world.getEntitiesWithComponents([UIDialog, UINode])) {
            if (!isDialogOpen(world, e)) continue;
            const d = world.get(e, UIDialog) as UIDialogData;

            const scrimClicked = d.closeOnBackdrop
                && world.has(e, UIInteraction)
                && (world.get(e, UIInteraction) as UIInteractionData).justPressed;

            if ((d.closeOnEscape && escape) || scrimClicked) {
                setDialogOpen(world, events, e, false);
            }
        }
    }, { name: 'UIDialogSystem' });
}
