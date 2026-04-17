import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { Interactable, UIInteraction } from '../behavior/interactable';
import { StateMachine } from '../behavior/state-machine';
import { StateVisuals, TransitionFlag, type StateVisualsData } from '../behavior/state-visuals';
import { UIEventType, type UIEventQueue } from '../core/events';
import { Text, type TextData } from '../core/text';

import { spawnUIEntity, type UIRectInit, type UIRendererInit } from './helpers';

export interface DropdownOptions<T> {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    rect?: UIRectInit;

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
    popupRenderer?: UIRendererInit;
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

const DEFAULT_BTN_NORMAL: Color  = { r: 0.22, g: 0.22, b: 0.26, a: 1 };
const DEFAULT_BTN_HOVER:  Color  = { r: 0.28, g: 0.28, b: 0.32, a: 1 };
const DEFAULT_BTN_PRESS:  Color  = { r: 0.18, g: 0.18, b: 0.22, a: 1 };
const DEFAULT_OPT_NORMAL: Color  = { r: 0.20, g: 0.20, b: 0.24, a: 1 };
const DEFAULT_OPT_HOVER:  Color  = { r: 0.30, g: 0.50, b: 0.90, a: 1 };
const DEFAULT_OPT_PRESS:  Color  = { r: 0.20, g: 0.40, b: 0.75, a: 1 };
const DEFAULT_POPUP_BG:   Color  = { r: 0.14, g: 0.14, b: 0.16, a: 1 };

const INTERACTION_DEFAULT = {
    hovered: false, pressed: false, justPressed: false, justReleased: false,
};

function makeStatesSV(colors: {
    normal: Color; hover: Color; pressed: Color;
}): StateVisualsData {
    const white = { r: 1, g: 1, b: 1, a: 1 };
    return {
        targetGraphic: 0 as Entity,
        transitionFlags: TransitionFlag.ColorTint,
        fadeDuration: 0,
        slot0Name: 'normal',  slot0Color: colors.normal,  slot0Sprite: 0, slot0Scale: 1,
        slot1Name: 'hover',   slot1Color: colors.hover,   slot1Sprite: 0, slot1Scale: 1,
        slot2Name: 'pressed', slot2Color: colors.pressed, slot2Sprite: 0, slot2Scale: 1,
        slot3Name: '', slot3Color: white, slot3Sprite: 0, slot3Scale: 1,
        slot4Name: '', slot4Color: white, slot4Sprite: 0, slot4Scale: 1,
        slot5Name: '', slot5Color: white, slot5Sprite: 0, slot5Scale: 1,
        slot6Name: '', slot6Color: white, slot6Sprite: 0, slot6Scale: 1,
        slot7Name: '', slot7Color: white, slot7Sprite: 0, slot7Scale: 1,
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

    const btnColors = {
        normal:  opts.buttonStates?.normal  ?? DEFAULT_BTN_NORMAL,
        hover:   opts.buttonStates?.hover   ?? DEFAULT_BTN_HOVER,
        pressed: opts.buttonStates?.pressed ?? DEFAULT_BTN_PRESS,
    };
    const optColors = {
        normal:  opts.optionStates?.normal  ?? DEFAULT_OPT_NORMAL,
        hover:   opts.optionStates?.hover   ?? DEFAULT_OPT_HOVER,
        pressed: opts.optionStates?.pressed ?? DEFAULT_OPT_PRESS,
    };

    // Button root.
    const button = spawnUIEntity({
        world,
        parent: opts.parent,
        rect: opts.rect,
        renderer: { color: btnColors.normal },
    });
    world.insert(button, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
    world.insert(button, UIInteraction, INTERACTION_DEFAULT);
    world.insert(button, StateMachine, { current: 'normal', previous: '' });
    world.insert(button, StateVisuals, makeStatesSV(btnColors));

    const label = spawnUIEntity({
        world,
        parent: button,
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
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
            rect: {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 1, y: 0 },
                offsetMin: { x: 0, y: -totalHeight },
                offsetMax: { x: 0, y: 0 },
            },
            renderer: opts.popupRenderer ?? { color: DEFAULT_POPUP_BG },
        });

        for (let i = 0; i < opts.options.length; i++) {
            const index = i;
            const row = spawnOptionRow(index, totalHeight);
            const off = events.on(row, UIEventType.StateChanged, (e) => {
                const d = e.data as { from: string; to: string };
                if (d.from === 'pressed' && d.to === 'hover') {
                    selectAndClose(index);
                }
            });
            optionUnsubs.push(off);
        }
    }

    function spawnOptionRow(index: number, totalHeight: number): Entity {
        const yTop = 1 - (index * optionHeight) / totalHeight;
        const yBottom = 1 - ((index + 1) * optionHeight) / totalHeight;
        const row = spawnUIEntity({
            world,
            parent: popupPanel!,
            rect: {
                anchorMin: { x: 0, y: yBottom },
                anchorMax: { x: 1, y: yTop },
            },
            renderer: { color: optColors.normal },
        });
        world.insert(row, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(row, UIInteraction, INTERACTION_DEFAULT);
        world.insert(row, StateMachine, { current: 'normal', previous: '' });
        world.insert(row, StateVisuals, makeStatesSV(optColors));

        spawnUIEntity({
            world,
            parent: row,
            rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
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
