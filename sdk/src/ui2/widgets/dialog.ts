import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction } from '../behavior/interactable';

import { spawnUIEntity, setUIVisible, type UIRectInit, type UIRendererInit } from './helpers';

export interface DialogOptions {
    world: World;
    parent?: Entity;
    /** Full-viewport backdrop rect. Default: stretched to parent. */
    backdropRect?: UIRectInit;
    /** Backdrop visuals. Default: 50% black overlay. */
    backdropRenderer?: UIRendererInit;
    /** Panel rect (the modal box). Default: 400x300 centered. */
    panelRect?: UIRectInit;
    panelRenderer?: UIRendererInit;
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
        rect: opts.backdropRect ?? { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        renderer: opts.backdropRenderer ?? { color: DEFAULT_BACKDROP_COLOR },
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
        rect: opts.panelRect ?? {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size: { x: 400, y: 300 },
            pivot: { x: 0.5, y: 0.5 },
        },
        renderer: opts.panelRenderer ?? { color: DEFAULT_PANEL_COLOR },
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
