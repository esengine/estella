// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/ui-controller.ts
 * @brief   UIController — a shared, named enum-state ("pages") scoped to a UI root.
 *
 * A controller is a named state that MANY descendant elements subscribe to —
 * one enum on the UI root, arbitrarily many geared leaves. Expressed as a plain
 * TS-side `defineComponent` (same class as StateMachineAgent / TimelinePlayer /
 * the physics joints — no C++ struct, serializes through the prefab/scene path). A
 * controller is deliberately a *dumb enum*, not an FSM: it names a set of `pages`
 * and holds the `current` one. Deciding *when* to switch pages is someone else's
 * job — game code calling {@link setControllerPage}, the `$interaction` driver,
 * or a data-driven `.esfsm` (the same layering as `.esfsm → timeline.play`).
 * Many descendant {@link UIGear}s reference one controller by name and snap/tween
 * their properties as `current` changes; the resolution walks self → ancestors so
 * a controller can live on the UI root while gears live on the leaves.
 */
import { defineComponent } from '../../component';
import { walkParentChain } from '../util/helpers';
import type { Entity } from '../../types';
import type { World } from '../../world';

/** One named enum-state: a page list plus the currently selected page name. */
export interface ControllerState {
    /** Controller name, referenced by gears (e.g. "tab", "$interaction"). */
    name: string;
    /** Ordered page names (the enum's members). */
    pages: string[];
    /** Currently selected page name (should be one of `pages`). */
    current: string;
}

export interface UIControllerData {
    controllers: ControllerState[];
}

export const UIController = defineComponent<UIControllerData>('UIController', {
    controllers: [],
});

/**
 * The built-in controller name driven by pointer state (normal/hover/pressed/
 * disabled). An entity that carries a `$interaction` controller + Interactable
 * gets its button states through gears — the one mechanism for all widget
 * interaction visuals (color/sprite/scale, or any other reflected field).
 */
export const INTERACTION_CONTROLLER = '$interaction';

/** Canonical interaction pages, in the order the driver prefers them. */
export const INTERACTION_PAGES = ['normal', 'hover', 'pressed', 'disabled', 'focused'] as const;

/** Build an interaction ControllerState (defaults to the 4 canonical pages). */
export function interactionController(pages: string[] = [...INTERACTION_PAGES]): ControllerState {
    return { name: INTERACTION_CONTROLLER, pages, current: pages[0] ?? 'normal' };
}

/** Build a plain named ControllerState (current defaults to the first page). */
export function controllerState(name: string, pages: string[], current?: string): ControllerState {
    return { name, pages, current: current ?? pages[0] ?? '' };
}

/** The ControllerState named `name` on `entity`, or null if `entity` has none. */
function controllerOn(world: World, entity: Entity, name: string): ControllerState | null {
    if (!world.has(entity, UIController)) return null;
    const data = world.get(entity, UIController) as UIControllerData;
    return data.controllers.find(c => c.name === name) ?? null;
}

/**
 * The entity that OWNS the controller named `name`, searching `entity` then its
 * ancestors (nearest wins). Null if no ancestor declares it. This is how a gear
 * on a leaf finds the controller on the UI root.
 */
export function findControllerOwner(world: World, entity: Entity, name: string): Entity | null {
    if (controllerOn(world, entity, name)) return entity;
    let owner: Entity | null = null;
    walkParentChain(world, entity, (ancestor) => {
        if (controllerOn(world, ancestor, name)) { owner = ancestor; return true; }
        return false;
    });
    return owner;
}

/** The current page of the nearest controller named `name`, or null if none. */
export function getControllerPage(world: World, entity: Entity, name: string): string | null {
    const owner = findControllerOwner(world, entity, name);
    if (owner === null) return null;
    return controllerOn(world, owner, name)!.current;
}

/**
 * Switch the nearest controller named `name` to `page`. No-op (returns false)
 * when the controller is missing, already on that page, or `page` is not one of
 * its declared pages (a guard against typos silently doing nothing visible).
 */
export function setControllerPage(world: World, entity: Entity, name: string, page: string): boolean {
    const owner = findControllerOwner(world, entity, name);
    if (owner === null) return false;
    const data = world.get(owner, UIController) as UIControllerData;
    const ctrl = data.controllers.find(c => c.name === name);
    if (!ctrl || ctrl.current === page || !ctrl.pages.includes(page)) return false;
    ctrl.current = page;
    world.insert(owner, UIController, data);
    return true;
}
