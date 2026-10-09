// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { Focusable } from './focusable';
import { Interactable } from './interactable';
import { UIDialog, isDialogOpen } from '../behavior/dialog';
import { walkParentChain } from '../util/helpers';

/** Read-only scene queries needed to inspect focus. @experimental */
export type FocusInspectionWorld = Pick<World, 'getWasmModule' | 'getCppRegistry' | 'getEntitiesWithComponents' | 'valid' | 'has' | 'get'>;

/** Why a focusable is absent from the current Tab ring. @experimental */
export type FocusSkipReason = 'disabled' | 'hidden' | 'outside-dialog';
/** A read-only focus traversal entry. Equal indices keep ECS query order. @experimental */
export interface FocusTraversalEntry {
    entity: Entity;
    tabIndex: number;
    skipped: FocusSkipReason | null;
}
/** The same snapshot used by keyboard traversal. @experimental */
export interface FocusTraversalInspection {
    entries: FocusTraversalEntry[];
    /** False when the host cannot report resolved hierarchical visibility. */
    visibilityResolved: boolean;
}

/** Inspect Tab order without moving focus or emitting events. @experimental */
export function inspectFocusTraversal(world: FocusInspectionWorld): FocusTraversalInspection {
    const engine = worldEngineApi(world);
    const registry = world.getCppRegistry();
    const visibilityResolved = !!(registry && engine?.getUINodeHiddenInTree);
    const roots = new Set(world.getEntitiesWithComponents([UIDialog])
        .filter(entity => isDialogOpen(world, entity)));
    const entries: FocusTraversalEntry[] = [];
    for (const entity of world.getEntitiesWithComponents([Focusable])) {
        if (!world.valid(entity)) continue;
        let skipped: FocusSkipReason | null = null;
        if (world.has(entity, Interactable) && !world.get(entity, Interactable).enabled) {
            skipped = 'disabled';
        } else if (visibilityResolved && engine!.getUINodeHiddenInTree!(registry!, entity)) {
            skipped = 'hidden';
        } else if (roots.size > 0 && !roots.has(entity)) {
            let inside = false;
            walkParentChain(world, entity, ancestor => {
                inside = roots.has(ancestor);
                return inside;
            });
            if (!inside) skipped = 'outside-dialog';
        }
        entries.push({ entity, tabIndex: world.get(entity, Focusable).tabIndex, skipped });
    }
    entries.sort((a, b) => a.tabIndex - b.tabIndex);
    return { entries, visibilityResolved };
}
