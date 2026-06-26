// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction } from '../behavior/interactable';
import { StateMachine } from '../behavior/state-machine';
import { StateVisuals, TransitionFlag, visualState, type StateVisualsData } from '../behavior/state-visuals';
import { UIEventType, type UIEventQueue } from '../core/events';
import { Text, type TextData } from '../core/text';

import { spawnUIEntity, type UINodeInit, type UIVisualInit } from './helpers';
import { px, percent } from '../core/dimension';
import { themeColors } from '../theme/tokens';

export interface DropdownOptions<T> {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;

    options: readonly T[];
    selectedIndex?: number;
    optionToLabel?: (option: T, index: number) => string;

    /** Visual state overrides for the main button. */
    buttonStates?: {
        normal?: Color;
        hover?: Color;
        pressed?: Color;
    };
    /** Visual state overrides for option rows in the popup. */
    optionStates?: {
        normal?: Color;
        hover?: Color;
        pressed?: Color;
    };
    /** Popup panel background. */
    popupVisual?: UIVisualInit;
    /** Height of each option row in pixels. Default 32. */
    optionHeight?: number;

    onSelect?: (index: number, option: T, entity: Entity) => void;
}

export interface DropdownHandle<T> {
    readonly entity: Entity;
    readonly labelEntity: Entity;
    isOpen(): boolean;
    getSelectedIndex(): number;
    getSelected(): T;
    setSelectedIndex(index: number, silent?: boolean): void;
    open(): void;
    close(): void;
    dispose(): void;
}

const INTERACTION_DEFAULT = {
    hovered: false, pressed: false, justPressed: false, justReleased: false,
};

function makeStatesSV(colors: {
    normal: Color; hover: Color; pressed: Color;
}): StateVisualsData {
    return {
        targetGraphic: 0 as Entity,
        transitionFlags: TransitionFlag.ColorTint,
        fadeDuration: 0,
        states: [
            visualState('normal', colors.normal),
            visualState('hover', colors.hover),
            visualState('pressed', colors.pressed),
        ],
    };
}

/**
 * Dropdown: a button showing the current selection that opens a popup
 * with clickable option rows. Click an option to select it (popup
 * closes automatically). Click the button again to close without
 * selecting. Click-outside-to-close is not wired in v1 — callers can
 * call `close()` from their own global input layer if needed.
 */
export function createDropdown<T>(opts: DropdownOptions<T>): DropdownHandle<T> {
    const { world, events } = opts;
    const labelOf = opts.optionToLabel ?? ((o: T) => String(o));
    const optionHeight = opts.optionHeight ?? 32;
    let selectedIndex = opts.selectedIndex ?? 0;

    const c = themeColors();
    const btnColors = {
        normal:  opts.buttonStates?.normal  ?? c.control,
        hover:   opts.buttonStates?.hover   ?? c.controlHover,
        pressed: opts.buttonStates?.pressed ?? c.controlActive,
    };
    const optColors = {
        normal:  opts.optionStates?.normal  ?? c.control,
        hover:   opts.optionStates?.hover   ?? c.primaryHover,
        pressed: opts.optionStates?.pressed ?? c.primaryActive,
    };

    // Button root.
    const button = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        visual: { color: btnColors.normal },
    });
    world.insert(button, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
    world.insert(button, UIInteraction, INTERACTION_DEFAULT);
    world.insert(button, StateMachine, { current: 'normal', previous: '' });
    world.insert(button, StateVisuals, makeStatesSV(btnColors));

    const label = spawnUIEntity({
        world,
        parent: button,
        node: { fill: true },
        text: { content: labelOf(opts.options[selectedIndex]!, selectedIndex) },
    });

    let popupPanel: Entity | null = null;
    const optionUnsubs: Array<() => void> = [];

    function isOpen(): boolean {
        return popupPanel !== null;
    }

    function open(): void {
        if (popupPanel) return;
        const totalHeight = opts.options.length * optionHeight;

        popupPanel = spawnUIEntity({
            world,
            parent: button,
            // Below the button: absolute, full width, top at the button's bottom edge.
            node: {
                position: 1,
                insetLeft: px(0),
                insetRight: px(0),
                insetTop: percent(100),
                height: px(totalHeight),
            },
            visual: opts.popupVisual ?? { color: c.surfaceElevated },
        });

        for (let i = 0; i < opts.options.length; i++) {
            const index = i;
            const row = spawnOptionRow(index);
            const off = events.on(row, UIEventType.StateChanged, (e) => {
                const d = e.data as { from: string; to: string };
                if (d.from === 'pressed' && d.to === 'hover') {
                    selectAndClose(index);
                }
            });
            optionUnsubs.push(off);
        }
    }

    function spawnOptionRow(index: number): Entity {
        const row = spawnUIEntity({
            world,
            parent: popupPanel!,
            // Stacked top-down: absolute, full width, row i at i*optionHeight.
            node: {
                position: 1,
                insetLeft: px(0),
                insetRight: px(0),
                insetTop: px(index * optionHeight),
                height: px(optionHeight),
            },
            visual: { color: optColors.normal },
        });
        world.insert(row, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(row, UIInteraction, INTERACTION_DEFAULT);
        world.insert(row, StateMachine, { current: 'normal', previous: '' });
        world.insert(row, StateVisuals, makeStatesSV(optColors));

        spawnUIEntity({
            world,
            parent: row,
            node: { fill: true },
            text: { content: labelOf(opts.options[index]!, index) },
        });

        return row;
    }

    function close(): void {
        if (!popupPanel) return;
        for (const off of optionUnsubs) off();
        optionUnsubs.length = 0;
        if (world.valid(popupPanel)) world.despawn(popupPanel);
        popupPanel = null;
    }

    function selectAndClose(index: number): void {
        close();
        setSelectedIndex(index, false);
    }

    function setSelectedIndex(index: number, silent = false): void {
        if (index < 0 || index >= opts.options.length) return;
        if (index === selectedIndex) return;
        selectedIndex = index;
        const labelData = world.get(label, Text) as TextData;
        labelData.content = labelOf(opts.options[index]!, index);
        world.insert(label, Text, labelData);
        if (!silent) {
            opts.onSelect?.(index, opts.options[index]!, button);
        }
    }

    // Click on button toggles popup.
    const offButtonClick = events.on(button, UIEventType.StateChanged, (e) => {
        const d = e.data as { from: string; to: string };
        if (d.from === 'pressed' && d.to === 'hover') {
            isOpen() ? close() : open();
        }
    });

    return {
        entity: button,
        labelEntity: label,
        isOpen,
        getSelectedIndex: () => selectedIndex,
        getSelected: () => opts.options[selectedIndex]!,
        setSelectedIndex,
        open,
        close,
        dispose: () => {
            offButtonClick();
            close();
            if (world.valid(button)) world.despawn(button);
        },
    };
}
