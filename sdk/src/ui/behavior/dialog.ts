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
import { defineSystem, type SystemDef } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { Input, type InputState } from '../../input/input';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { UINode, UIDisplay, type UINodeData } from '../core/ui-node';
import { UIEventType, type UIEventQueue } from '../core/events';
import { UIDialog, isDialogOpen } from '../core/ui-dialog';
import { openList } from '../core/dropdown-popup';
import { FocusManager, type FocusManagerState } from '../input/focusable';
import { UIControlPointers, type UIControlPointersData } from '../input/control-pointers';
import { UIInteraction } from '../input/interactable';
import { readDialogScope } from '../input/modal-scope';
import { dropdownAvailable, escapeLayer } from '../input/overlay-input';
import { closeDropdown } from './dropdown';
export { UIDialog, isDialogOpen, type UIDialogData } from '../core/ui-dialog';

/** Show the dialog subtree and emit `change` with the new open state. */
export function openDialog(world: World, events: UIEventQueue, root: Entity): void {
    setOpen_(world, events, root, true);
}

/** Hide the dialog subtree and emit `change` with the new open state. */
export function closeDialog(world: World, events: UIEventQueue, root: Entity): void {
    setOpen_(world, events, root, false);
}

function setOpen_(
    world: World, events: UIEventQueue, root: Entity, open: boolean,
): void {
    if (!world.has(root, UINode) || isDialogOpen(world, root) === open) return;
    const node = world.get(root, UINode) as UINodeData;
    node.display = open ? UIDisplay.Flex : UIDisplay.None;
    world.insert(root, UINode, node);
    const popup = openList.get(world);
    if (popup && !dropdownAvailable(world, popup.owner)) closeDropdown(world, popup.owner);
    events.emit(root, UIEventType.Change, { open });
}

/** Only a visible leaf dialog can receive a dismissal. A list covering the
 *  scrim at press time owns that press, even for a tap released in the same frame. */
export function createDialogSystem(world: World, events: UIEventQueue): SystemDef {
    return defineSystem([Res(Input), Res(FocusManager), Res(UIControlPointers)],
    (input: InputState, focus: FocusManagerState, pointers: UIControlPointersData) => {
        const escape = input.isKeyPressed('Escape') ? escapeLayer(world, focus?.focusedEntity) : null;
        if (escape?.kind === 'dialog' && readDialogScope(world).roots.has(escape.entity)
            && world.get(escape.entity, UIDialog).closeOnEscape) {
            closeDialog(world, events, escape.entity);
        }
        for (const e of world.getEntitiesWithComponents([UIDialog, UIInteraction])) {
            if (!world.valid(e) || !world.has(e, UIInteraction) || !world.get(e, UIInteraction).justPressed) continue;
            const scope = readDialogScope(world);
            if (!scope.roots.has(e)) continue;
            const pointer = pointers && [...pointers.pointers.values()].find(p => p.pressedEntity === e);
            const popup = openList.get(world);
            if (pointer?.popupAtPress) {
                if (popup?.view.entity === pointer.popupAtPress.viewport) closeDropdown(world, popup.owner);
            } else if (!pointer && popup && dropdownAvailable(world, popup.owner, scope)) {
                // A standalone input system can supply justPressed without a pointer capture.
                closeDropdown(world, popup.owner);
            } else if (world.get(e, UIDialog).closeOnBackdrop) {
                closeDialog(world, events, e);
            }
        }
    }, { name: 'UIDialogSystem' });
}
