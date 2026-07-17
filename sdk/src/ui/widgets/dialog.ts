// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../world';

import { spawnUIEntity, type UINodeInit, type UIVisualInit } from '../core/compose';
import { makeWidgetInteractable } from '../input/interactable';
import { UINode, UIDisplay, type UINodeData } from '../core/ui-node';
import { px, percent } from '../core/dimension';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { UIDialog, isDialogOpen, setDialogOpen } from '../behavior/dialog';
import type { UIEventQueue } from '../core/events';

export interface DialogOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    /** Full-viewport backdrop. Default: fill the parent. */
    backdropNode?: UINodeInit;
    /** Backdrop visuals. Default: themed scrim. */
    backdropVisual?: UIVisualInit;
    /** Panel box (the modal). Default: 400x300 centered. */
    panelNode?: UINodeInit;
    panelVisual?: UIVisualInit;
    /** Start hidden. Default true. */
    startHidden?: boolean;
    /** Escape closes the dialog. Default true. */
    closeOnEscape?: boolean;
    /** Clicking the backdrop scrim (not the panel) closes the dialog. Default true. */
    closeOnBackdrop?: boolean;
    /** Fires on every open/close, whoever initiated it (code, Escape, scrim). */
    onOpenChange?: (open: boolean) => void;
}

export interface DialogHandle {
    readonly entity: Entity;
    readonly panelEntity: Entity;
    isOpen(): boolean;
    open(): void;
    close(): void;
    dispose(): void;
}

/**
 * Modal dialog: a backdrop scrim (blocks clicks behind it) with a centered
 * panel child. Hidden by default; open state IS the backdrop root's
 * `UINode.display`, so hiding removes the whole subtree — including anything
 * the caller parents under `panelEntity` — from layout, rendering and input.
 *
 * Dismissal (Escape / scrim click) is data-driven by the {@link UIDialog}
 * component, so a dialog instantiated from a prefab behaves without code.
 */
export function createDialog(opts: DialogOptions): DialogHandle {
    const { world, events } = opts;
    const c = themeColors();

    const backdrop = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.backdropNode ?? { fill: true },
        visual: opts.backdropVisual ?? { color: c.backdrop },
    });
    if (!opts.backdropVisual) markThemed(world, backdrop, { visual: 'backdrop' });

    // Blocks hit-test on the scene behind the dialog. Not focusable — the
    // scrim is an input barrier, not a control.
    makeWidgetInteractable(world, backdrop, { focusable: false });
    world.insert(backdrop, UIDialog, {
        closeOnEscape: opts.closeOnEscape ?? true,
        closeOnBackdrop: opts.closeOnBackdrop ?? true,
    });

    const panel = spawnUIEntity({
        world,
        parent: backdrop,
        // Centered modal: absolute, 50% inset shifted back by half its size.
        node: opts.panelNode ?? {
            position: 1,
            width: px(400),
            height: px(300),
            insetLeft: percent(50),
            insetTop: percent(50),
            marginLeft: px(-200),
            marginTop: px(-150),
        },
        visual: opts.panelVisual ?? { color: c.surface },
    });
    if (!opts.panelVisual) markThemed(world, panel, { visual: 'surface' });
    // The panel swallows clicks so only true scrim clicks reach the dismissal
    // system.
    makeWidgetInteractable(world, panel, { focusable: false });

    if (opts.startHidden ?? true) {
        const node = world.get(backdrop, UINode) as UINodeData;
        node.display = UIDisplay.None;
        world.insert(backdrop, UINode, node);
    }

    const offChange = opts.onOpenChange
        ? events.on(backdrop, 'change', (ev) => {
              opts.onOpenChange!((ev.data as { open: boolean }).open);
          })
        : undefined;

    return {
        entity: backdrop,
        panelEntity: panel,
        isOpen: () => isDialogOpen(world, backdrop),
        open: () => setDialogOpen(world, events, backdrop, true),
        close: () => setDialogOpen(world, events, backdrop, false),
        dispose: () => {
            offChange?.();
            if (world.valid(backdrop)) world.despawn(backdrop);
        },
    };
}
