// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { UIDropdown, openList } from '../core/dropdown-popup';
import { Interactable } from './interactable';
import { isPointerBlockedInTree } from '../util/helpers';
import { isLiveUIEntity, readDialogScope } from './modal-scope';

export function dropdownAvailable(world: World, owner: Entity, scope = readDialogScope(world)): boolean {
    return world.isEntityActive(owner) && !world.isDestructionPending(owner) && world.has(owner, UIDropdown)
        && (!world.has(owner, Interactable) || world.get(owner, Interactable).enabled)
        && !isPointerBlockedInTree(world, owner) && !scope.hiddenInTree(owner)
        && (!scope.roots.size || scope.dialogOf(owner) !== null);
}

type DismissLayer = { kind: 'dropdown' | 'dialog'; entity: Entity };
const decisions = new WeakMap<World, { tick: number; layer: DismissLayer | null }>();

/** Resolve once per Escape edge. Closing a list or running a synchronous change
 *  handler must not turn that same key into a second dismissal in a later system. */
export function escapeLayer(world: World, focused?: Entity | null): DismissLayer | null {
    const tick = world.getWorldTick?.();
    const previous = decisions.get(world);
    if (previous && previous.tick === tick) return previous.layer;
    const scope = readDialogScope(world);
    const popup = openList.get(world);
    let layer: DismissLayer | null = null;
    if (popup && dropdownAvailable(world, popup.owner, scope)) {
        layer = { kind: 'dropdown', entity: popup.owner };
    } else if (scope.roots.size) {
        let dialog = focused != null && isLiveUIEntity(world, focused) && world.isEntityActive(focused) && !scope.hiddenInTree(focused)
            ? scope.dialogOf(focused) : null;
        if (dialog === null) {
            // With no focus to name a branch, prefer the scrim drawn last. For
            // a host without resolved paint order, ties follow the dialog query.
            const api = worldEngineApi(world);
            const registry = world.getCppRegistry();
            let best = -Infinity;
            for (const root of scope.roots) {
                const order = registry ? api?.ui_getRenderOrder?.(registry, root) ?? -1 : -1;
                if (order >= best) {
                    best = order;
                    dialog = root;
                }
            }
        }
        if (dialog !== null) layer = { kind: 'dialog', entity: dialog };
    }
    if (tick !== undefined) decisions.set(world, { tick, layer });
    return layer;
}
