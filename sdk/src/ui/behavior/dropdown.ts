// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/dropdown.ts
 * @brief   UIDropdown — data-driven select control.
 *
 * The component holds the display labels + `selectedIndex` + the button-label
 * entity ref; the system owns the popup lifecycle (click toggles it, a click
 * anywhere else closes it), row selection, keyboard stepping while focused,
 * and the label sync — the single writer, so `setSelectedIndex`, a binding,
 * the editor inspector, and pointer selection all behave identically. A
 * prefab-placed dropdown is fully functional without code.
 *
 * The popup is a transient runtime subtree, rebuilt on each open with fresh
 * theme colors and tagged with ThemeStyle roles for live re-theming.
 */
import { defineSystem, type SystemDef } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { Input, type InputState } from '../../input/input';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { auto, px, percent } from '../core/dimension';
import { UINode, UIPositionType, UIPointerEvents } from '../core/ui-node';
import { UIMask } from '../core/ui-mask';
import { ScreenLayout, type ScreenLayoutData } from '../core/screen-layout';
import { ScreenOverlay, type ScreenOverlayData } from '../core/screen-overlay';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { UICollections, type CollectionHost } from '../collection/collection-host';
import { createScrollView } from '../collection/scroll-view';
import { createPopupBoundsReader, createPopupCanvas } from '../util/popup-anchor';
import { spawnUIEntity } from '../core/compose';
import { Text, TextAlign, TextOverflow, type TextData } from '../core/text';
import { UIEventType, type UIEventQueue } from '../core/events';
import { makeWidgetInteractable } from '../input/interactable';
import { Focusable, FocusManager, type FocusManagerState, type FocusableData } from '../input/focusable';
import { UIControlPointers, type UIControlPointersData } from '../input/control-pointers';
import { UIController, interactionController, setControllerPage, type UIControllerData, INTERACTION_CONTROLLER } from '../controller/ui-controller';
import { UIGear } from '../controller/ui-gear';
import { interactionGears } from '../controller/interaction-gears';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { EntityStateMap, walkParentChain } from '../util/helpers';
import { UIDropdown, openList, popupOf, isDropdownOpen, isPopupHit, type PopupState, type UIDropdownData } from '../core/dropdown-popup';
import { dropdownAvailable, escapeLayer } from '../input/overlay-input';
export { UIDropdown, isDropdownOpen, type UIDropdownData } from '../core/dropdown-popup';


const POPUP_PADDING = 3;
const POPUP_GAP = 3;
const MAX_VISIBLE_ROWS = 8;
export const DROPDOWN_CONTROLLER = '$dropdown';
const rowHeight = (height: number) => Number.isFinite(height) && height > 0 ? height : UIDropdown._default.optionHeight;

export function clampDropdownIndex(index: number, count: number): number {
    return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : 0, count - 1));
}

function popupMatches(p: PopupState, d: UIDropdownData): boolean {
    if (p.optionHeight !== rowHeight(d.optionHeight) || p.options.length !== d.options.length) return false;
    for (let i = 0; i < p.options.length; i++) if (p.options[i] !== d.options[i]) return false;
    return true;
}


function setExpanded(world: World, e: Entity, expanded: boolean): void {
    if (world.valid(e) && !world.isDestructionPending(e) && world.has(e, UIController)
        && world.get(e, UIController).controllers.some(c => c.name === DROPDOWN_CONTROLLER)) {
        setControllerPage(world, e, DROPDOWN_CONTROLLER, expanded ? 'open' : 'closed');
    }
}

export function closeDropdown(world: World, e: Entity): void {
    const p = popupOf(world, e);
    if (!p) return;
    openList.delete(world);
    setExpanded(world, e, false);
    for (const off of p.unsubs) off();
    p.bounds.dispose();
    p.host?.detachScrollContainer(p.view.entity);
    p.view.dispose();
    if (p.canvas !== undefined && world.valid(p.canvas)) world.despawn(p.canvas);
}

export function closeAllDropdowns(world: World): void {
    const popup = openList.get(world);
    if (popup) closeDropdown(world, popup.owner);
}

export function openDropdown(world: World, events: UIEventQueue, e: Entity): void {
    if (isDropdownOpen(world, e) || !dropdownAvailable(world, e)) return;
    if (!world.get(e, UIDropdown).options.length) return;
    if (openList.has(world)) {
        closeAllDropdowns(world);
        if (openList.has(world) || !dropdownAvailable(world, e)) return;
    }
    const d = world.get(e, UIDropdown);
    const options = [...d.options], optionHeight = rowHeight(d.optionHeight);
    if (!options.length) return;

    // Fresh theme resolution per open — the popup is transient, so a stale
    // capture would pin whatever theme was active earlier.
    const t = themeColors(world);
    const size = { x: 0, y: options.length * optionHeight + 2 * POPUP_PADDING };
    const view = createScrollView({
        world, parent: e, viewportSize: size, contentSize: size,
        // The trigger owns the popup until a rendered anchor and screen are available.
        node: {
            position: UIPositionType.Absolute, width: auto(),
            insetLeft: px(0),
            insetRight: px(0),
            insetTop: percent(100),
        },
        background: { color: t.control },
    });
    world.insert(view.content, UINode, { ...world.get(view.content, UINode), width: percent(100) });
    markThemed(world, view.entity, { visual: 'control' });

    const unsubs: Array<() => void> = [];
    const rows: Entity[] = [];
    for (let i = 0; i < options.length; i++) {
        const row = spawnUIEntity({
            world,
            parent: view.content,
            node: {
                position: 1,
                insetLeft: px(POPUP_PADDING),
                insetRight: px(POPUP_PADDING),
                insetTop: px(POPUP_PADDING + i * optionHeight),
                height: px(optionHeight),
            },
            visual: { color: t.surfaceElevated },
        });
        // Rows are pointer-only: the popup is transient, so they stay out of
        // the Tab ring. 'selected' is NOT driver-owned — the keyboard highlight
        // holds it, and the pointer driver leaves such pages alone.
        makeWidgetInteractable(world, row, { focusable: false });
        world.insert(row, UIController, {
            controllers: [interactionController(['normal', 'hover', 'pressed', 'selected'])],
        });
        world.insert(row, UIGear, {
            bindings: interactionGears({
                normal: { color: t.surfaceElevated },
                hover: { color: t.controlHover },
                pressed: { color: t.controlActive },
                selected: { color: t.controlFocus },
            }),
        });
        markThemed(world, row, {
            states: {
                normal: 'surfaceElevated', hover: 'controlHover',
                pressed: 'controlActive', selected: 'controlFocus',
            },
        });

        const rowLabel = spawnUIEntity({
            world,
            parent: row,
            node: { fill: true, insetLeft: px(8), insetRight: px(24) },
            text: { content: options[i]!, color: t.text, align: TextAlign.Left, overflow: TextOverflow.Ellipsis },
        });
        markThemed(world, rowLabel, { text: 'text' });

        const index = i;
        unsubs.push(events.on(row, UIEventType.Click, () => {
            const available = dropdownAvailable(world, e);
            closeDropdown(world, e);
            if (!available || !dropdownAvailable(world, e)) return;
            const cur = world.get(e, UIDropdown) as UIDropdownData;
            if (cur.options[index] !== options[index]) return;
            if (cur.selectedIndex !== index) {
                cur.selectedIndex = index;
                world.insert(e, UIDropdown, cur);
            }
        }));
        rows.push(row);
    }
    const check = spawnUIEntity({ world, parent: rows[0], node: {
        position: UIPositionType.Absolute, insetTop: px(0), insetBottom: px(0), insetRight: px(4), width: px(16),
    }, text: { content: '✓', color: t.text } });
    markThemed(world, check, { text: 'text' });
    const popup = { owner: e, view, bounds: createPopupBoundsReader(world), rows, check, unsubs, options, optionHeight };
    openList.set(world, popup);
    setExpanded(world, e, true);
    highlightRow(world, popup, clampDropdownIndex(d.selectedIndex, options.length));
}

/** Keyboard highlight: the selected row holds the non-driver-owned 'selected'
 *  page; every other row returns to 'normal', handing pointer hover back to
 *  the driver. */
function highlightRow(world: World, popup: PopupState, selected: number): void {
    const { rows, check } = popup;
    if (rows[selected] !== undefined) world.setParent(check, rows[selected]!);
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        if (!world.valid(row) || !world.has(row, UIController)) continue;
        const data = world.get(row, UIController) as UIControllerData;
        const ctrl = data.controllers.find((c) => c.name === INTERACTION_CONTROLLER);
        if (!ctrl) continue;
        const want = i === selected ? 'selected' : (ctrl.current === 'selected' ? 'normal' : ctrl.current);
        if (ctrl.current !== want) {
            ctrl.current = want;
            world.insert(row, UIController, data);
        }
    }
}

/** Place the list against the visible trigger. Only the trigger is clipped by its
 *  ancestors. The options use the same scroll viewport as other engine UI. */
function placePopup(world: World, owner: Entity, p: PopupState, selected: number,
    layout: ScreenLayoutData, overlay: ScreenOverlayData, camera: UICameraData, host: CollectionHost | null): void {
    if (!layout?.valid || !overlay?.active) return;
    const anchor = p.bounds.read(owner, camera, overlay);
    if (!anchor) {
        if (p.canvas !== undefined) closeDropdown(world, owner);
        return;
    }
    const anchorWidth = anchor.right - anchor.left;
    walkParentChain(world, owner, ancestor => {
        if (!world.has(ancestor, UIMask) || !world.get(ancestor, UIMask).enabled) return false;
        const clip = p.bounds.read(ancestor, camera, overlay);
        if (clip) {
            anchor.left = Math.max(anchor.left, clip.left); anchor.right = Math.min(anchor.right, clip.right);
            anchor.bottom = Math.max(anchor.bottom, clip.bottom); anchor.top = Math.min(anchor.top, clip.top);
        }
        return false;
    });
    if (Math.min(anchor.right, layout.right) <= Math.max(anchor.left, layout.left)
        || Math.min(anchor.top, layout.top) <= Math.max(anchor.bottom, layout.bottom)) {
        closeDropdown(world, owner);
        return;
    }

    const fullHeight = p.options.length * p.optionHeight + 2 * POPUP_PADDING;
    const preferredHeight = Math.min(fullHeight, MAX_VISIBLE_ROWS * p.optionHeight + 2 * POPUP_PADDING);
    const width = Math.fround(Math.min(anchorWidth, layout.safeRight - layout.safeLeft));
    const safeHeight = layout.safeTop - layout.safeBottom;
    if (width <= 0 || safeHeight <= 0) { closeDropdown(world, owner); return; }
    const below = anchor.bottom - POPUP_GAP - layout.safeBottom;
    const above = layout.safeTop - anchor.top - POPUP_GAP;
    const up = below < preferredHeight && above > below;
    const room = up ? above : below;
    // A trigger can itself fill the screen. Allow overlap to keep a whole row reachable.
    const height = Math.fround(Math.min(preferredHeight, safeHeight, room < p.optionHeight + 2 * POPUP_PADDING ? safeHeight : room));
    const x = Math.max(layout.safeLeft, Math.min(anchor.left, layout.safeRight - width));
    const y = Math.min(layout.safeTop, Math.max(layout.safeBottom + height,
        up ? anchor.top + POPUP_GAP + height : anchor.bottom - POPUP_GAP));

    const { view } = p;
    if (p.canvas === undefined) {
        p.canvas = createPopupCanvas(world, owner, UIPointerEvents.Auto);
        world.setParent(view.entity, p.canvas);
    }
    const scrollHost = height < fullHeight ? host ?? undefined : undefined;
    if (p.host !== scrollHost) {
        p.host?.detachScrollContainer(view.entity);
        scrollHost?.attachScrollContainer(view.entity, view.scroll);
        p.host = scrollHost;
    }
    const node = world.get(view.entity, UINode);
    const left = Math.fround(x - layout.left), top = Math.fround(layout.top - y);
    if (node.width.unit !== 0 || node.width.value !== width || node.height.value !== height
        || node.insetLeft.value !== left || node.insetTop.unit !== 0 || node.insetTop.value !== top) {
        world.insert(view.entity, UINode, { ...node, width: px(width), height: px(height),
            insetLeft: px(left), insetTop: px(top), insetRight: auto() });
    }
    const size = view.scroll.getViewportSize();
    const resized = size.y !== height;
    if (resized || size.x !== width) view.scroll.setSizes({ x: width, y: height }, { x: width, y: fullHeight });
    if (resized || p.revealed !== selected) {
        const offset = view.scroll.getOffset().y, rowTop = POPUP_PADDING + selected * p.optionHeight;
        const y = Math.min(rowTop - POPUP_PADDING, Math.max(offset, rowTop + p.optionHeight + POPUP_PADDING - height));
        view.scrollTo({ x: 0, y });
        p.revealed = selected;
    }
}


/**
 * Popup lifecycle + selection + keyboard + label sync for every UIDropdown.
 */
export function createDropdownSystem(world: World, events: UIEventQueue): SystemDef {
    const shown = new EntityStateMap<{ index: number; label: Entity; content: string }>();

    // One global click handler arbitrates: the dropdown root toggles its own
    // popup; a click inside a popup is the row handler's business; any other
    // click closes every open popup (click-outside-to-close).
    events.on(UIEventType.Click, (ev) => {
        if (ev.currentTarget !== ev.target) return;
        const target = ev.target;
        if (world.valid(target) && world.has(target, UIDropdown)) {
            if (!dropdownAvailable(world, target)) {
                closeDropdown(world, target);
                return;
            }
            if (isDropdownOpen(world, target)) closeDropdown(world, target);
            else openDropdown(world, events, target);
            return;
        }
        const open = openList.get(world);
        if (open && isPopupHit(world, open, target)) return;
        closeAllDropdowns(world);
    });

    events.on(UIEventType.Blur, ev => {
        if (ev.target === ev.currentTarget && isDropdownOpen(world, ev.target)) closeDropdown(world, ev.target);
    });
    world.onDespawn((e) => {
        // A screen popup lives outside the owner's clipping tree.
        if (isDropdownOpen(world, e)) closeDropdown(world, e);
    });

    return defineSystem([Res(Input), Res(ScreenLayout), Res(ScreenOverlay), Res(UICameraInfo), Res(UICollections), Res(UIControlPointers), Res(FocusManager)],
    (input: InputState, layout: ScreenLayoutData, overlay: ScreenOverlayData, camera: UICameraData,
        host: CollectionHost | null, pointers: UIControlPointersData, focus: FocusManagerState) => {
        const openPopup = openList.get(world);
        // Inactive owners disappear from component queries but still own popup entries.
        if (openPopup) {
            const escape = input.isKeyPressed('Escape') ? escapeLayer(world, focus?.focusedEntity) : null;
            // Empty space has no entity to emit a Click. The input system still records the press.
            const emptyPress = pointers && [...pointers.pointers.values()].some(p => p.pressed && p.pressedEntity === null);
            if ((escape?.kind === 'dropdown' && escape.entity === openPopup.owner)
                || emptyPress || !dropdownAvailable(world, openPopup.owner)) closeDropdown(world, openPopup.owner);
        }
        const stepDown = input.isKeyPressed('ArrowDown'), stepUp = input.isKeyPressed('ArrowUp');
        const activate = input.isKeyPressed('Enter') || input.isKeyPressed('Space');
        for (const e of world.getEntitiesWithComponents([UIDropdown])) {
            if (!world.valid(e) || !world.has(e, UIDropdown)) continue;
            let d = world.get(e, UIDropdown) as UIDropdownData;
            const clamped = clampDropdownIndex(d.selectedIndex, d.options.length);
            if (clamped !== d.selectedIndex) {
                d.selectedIndex = clamped;
                world.insert(e, UIDropdown, d);
            }
            const previousPopup = popupOf(world, e);
            if (previousPopup && !popupMatches(previousPopup, d)) {
                closeDropdown(world, e);
                if (!world.valid(e) || !world.has(e, UIDropdown)) continue;
                openDropdown(world, events, e);
                d = world.get(e, UIDropdown) as UIDropdownData;
            }

            // Keyboard: arrows step the selection whether the popup is open
            // (moving the row highlight) or closed (the native <select>
            // convention); Enter confirms and Escape dismisses an open popup.
            const focused = world.has(e, Focusable)
                && (world.get(e, Focusable) as FocusableData).isFocused;
            const open = isDropdownOpen(world, e);
            if (focused && (stepDown || stepUp || activate) && d.options.length > 0 && dropdownAvailable(world, e)) {
                let next = d.selectedIndex;
                if (stepDown) next = Math.min(next + 1, d.options.length - 1);
                if (stepUp) next = Math.max(next - 1, 0);
                if (next !== d.selectedIndex) {
                    d.selectedIndex = next;
                    world.insert(e, UIDropdown, d);
                }
                if (focus?.focusedEntity !== e && activate) {
                    // FocusSystem emits the click for its focused entity. A standalone
                    // behavior system also supports an explicitly focused control.
                    if (open) closeDropdown(world, e);
                    else openDropdown(world, events, e);
                }
            }

            if (!world.valid(e) || !world.has(e, UIDropdown)) continue;

            // Selection → label + row highlight + change event, whoever wrote
            // the index.
            const content = d.options[d.selectedIndex] ?? '';
            const previous = shown.get(e);
            if (!previous || previous.index !== d.selectedIndex || previous.label !== d.label || previous.content !== content) {
                const emitChange = previous !== undefined && previous.index !== d.selectedIndex;
                if (previous) {
                    previous.index = d.selectedIndex; previous.label = d.label; previous.content = content;
                } else {
                    shown.set(e, { index: d.selectedIndex, label: d.label, content });
                }
                if (world.valid(d.label) && world.has(d.label, Text)) {
                    const txt = world.get(d.label, Text) as TextData;
                    if (txt.content !== content) {
                        txt.content = content;
                        world.insert(d.label, Text, txt);
                    }
                }
                const popup = popupOf(world, e);
                if (popup) highlightRow(world, popup, d.selectedIndex);
                if (emitChange) events.emit(e, UIEventType.Change, { index: d.selectedIndex });
            }
            const popup = popupOf(world, e);
            if (popup) placePopup(world, e, popup, d.selectedIndex, layout, overlay, camera, host);
        }
        shown.cleanup(world);
    }, { name: 'UIDropdownSystem' });
}
