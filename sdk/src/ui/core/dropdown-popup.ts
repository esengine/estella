// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../../ecs/component';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import type { CollectionHost } from '../collection/collection-host';
import type { ScrollViewHandle } from '../collection/scroll-view';
import type { createPopupBoundsReader } from '../util/popup-anchor';
import { walkParentChain } from '../util/helpers';

export interface UIDropdownData {
    /** Display labels, one per option. */
    options: string[];
    selectedIndex: number;
    /** Popup row height in px. */
    optionHeight: number;
    /** The button's label Text entity (content tracks the selection). */
    label: Entity;
}

export const UIDropdown = defineComponent<UIDropdownData>('UIDropdown', {
    options: [],
    selectedIndex: 0,
    optionHeight: 32,
    label: 0 as Entity,
}, { entityFields: ['label'] });

export interface PopupState {
    owner: Entity;
    view: ScrollViewHandle;
    bounds: ReturnType<typeof createPopupBoundsReader>;
    canvas?: Entity;
    host?: CollectionHost;
    revealed?: number;
    check: Entity;
    rows: Entity[];
    unsubs: Array<() => void>;
    options: string[];
    optionHeight: number;
}

/** An app has one open list. Its logical owner stays the button even when the
 *  viewport is reparented to a separate canvas to escape a clip. */
export const openList = new WeakMap<World, PopupState>();

export function popupOf(world: World, owner: Entity): PopupState | undefined {
    const popup = openList.get(world);
    return popup?.owner === owner ? popup : undefined;
}

export function isDropdownOpen(world: World, e: Entity): boolean {
    return popupOf(world, e) !== undefined;
}

export function isPopupHit(world: World, popup: PopupState, target: Entity): boolean {
    let inside = target === popup.view.entity;
    if (!inside) walkParentChain(world, target, ancestor => (inside = ancestor === popup.view.entity));
    return inside;
}
