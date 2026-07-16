// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction } from '../input/interactable';

import { spawnUIEntity, type UINodeInit, type UIVisualInit } from './helpers';
import { UINode, UIDisplay, type UINodeData } from '../core/ui-node';
import { px, percent } from '../core/dimension';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';

export interface DialogOptions {
    world: World;
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
}

export interface DialogHandle {
    readonly backdropEntity: Entity;
    readonly panelEntity: Entity;
    isOpen(): boolean;
    open(): void;
    close(): void;
    dispose(): void;
}

/**
 * Modal dialog: backdrop entity (blocks clicks behind it) with a
 * centered panel child. Hidden by default; `open()` / `close()`
 * toggle visibility + interactivity.
 *
 * Add children to `panelEntity` to populate the dialog.
 */
export function createDialog(opts: DialogOptions): DialogHandle {
    const { world } = opts;
    const c = themeColors();

    const backdrop = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.backdropNode ?? { fill: true },
        visual: opts.backdropVisual ?? { color: c.backdrop },
    });
    if (!opts.backdropVisual) markThemed(world, backdrop, { visual: 'backdrop' });

    // Blocks hit-test on the scene behind the dialog.
    world.insert(backdrop, Interactable, {
        enabled: true,
        blockRaycast: true,
        raycastTarget: true,
    });
    world.insert(backdrop, UIInteraction, {
        hovered: false, pressed: false, justPressed: false, justReleased: false,
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

    let open = !(opts.startHidden ?? true);
    applyOpen(open);

    // display:none removes the backdrop AND everything the user parented under
    // the panel from layout, rendering and hit-testing in one write — closing
    // must hide user content too, not just the two entities we own.
    function applyOpen(value: boolean): void {
        const node = world.get(backdrop, UINode) as UINodeData;
        node.display = value ? UIDisplay.Flex : UIDisplay.None;
        world.insert(backdrop, UINode, node);
    }

    return {
        backdropEntity: backdrop,
        panelEntity: panel,
        isOpen: () => open,
        open: () => {
            if (open) return;
            open = true;
            applyOpen(true);
        },
        close: () => {
            if (!open) return;
            open = false;
            applyOpen(false);
        },
        dispose: () => {
            if (world.valid(backdrop)) world.despawn(backdrop);
        },
    };
}
