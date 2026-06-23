// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction } from '../behavior/interactable';

import { spawnUIEntity, setUIVisible, type UINodeInit, type UIVisualInit } from './helpers';
import { px, percent } from '../core/dimension';

export interface DialogOptions {
    world: World;
    parent?: Entity;
    /** Full-viewport backdrop. Default: fill the parent. */
    backdropNode?: UINodeInit;
    /** Backdrop visuals. Default: 50% black overlay. */
    backdropRenderer?: UIVisualInit;
    /** Panel box (the modal). Default: 400x300 centered. */
    panelNode?: UINodeInit;
    panelRenderer?: UIVisualInit;
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

const DEFAULT_BACKDROP_COLOR: Color = { r: 0, g: 0, b: 0, a: 0.5 };
const DEFAULT_PANEL_COLOR: Color = { r: 0.16, g: 0.16, b: 0.18, a: 1 };

/**
 * Modal dialog: backdrop entity (blocks clicks behind it) with a
 * centered panel child. Hidden by default; `open()` / `close()`
 * toggle visibility + interactivity.
 *
 * Add children to `panelEntity` to populate the dialog.
 */
export function createDialog(opts: DialogOptions): DialogHandle {
    const { world } = opts;

    const backdrop = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.backdropNode ?? { fill: true },
        visual: opts.backdropRenderer ?? { color: DEFAULT_BACKDROP_COLOR },
    });

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
        visual: opts.panelRenderer ?? { color: DEFAULT_PANEL_COLOR },
    });

    let open = !(opts.startHidden ?? true);
    applyOpen(open);

    function applyOpen(value: boolean): void {
        setUIVisible(world, backdrop, value);
        setUIVisible(world, panel, value);
        // Disable the backdrop's raycast blocker when hidden so clicks
        // fall through to scene behind.
        if (world.has(backdrop, Interactable)) {
            const i = world.get(backdrop, Interactable) as {
                enabled: boolean;
                blockRaycast: boolean;
                raycastTarget: boolean;
            };
            i.enabled = value;
            world.insert(backdrop, Interactable, i);
        }
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
