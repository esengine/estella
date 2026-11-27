// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Focusable } from './focusable';
import { Interactable } from './interactable';
import { isLiveUIEntity, readDialogScope, type FocusInspectionWorld } from './modal-scope';
export type { FocusInspectionWorld } from './modal-scope';

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

function skipReason(world: FocusInspectionWorld, entity: Entity,
    { hiddenInTree, roots, dialogOf }: ReturnType<typeof readDialogScope>): FocusSkipReason | null {
    let skipped: FocusSkipReason | null = null;
    if (world.has(entity, Interactable) && !world.get(entity, Interactable).enabled) {
        skipped = 'disabled';
    } else if (hiddenInTree(entity)) {
        skipped = 'hidden';
    } else if (roots.size && dialogOf(entity) === null) {
        skipped = 'outside-dialog';
    }
    return skipped;
}

/** Check a single target without sorting the entire Tab ring. */
export function isFocusEligible(world: FocusInspectionWorld & Partial<Pick<World, 'isEntityActive'>>, entity: Entity): boolean {
    if (!isLiveUIEntity(world, entity) || !world.has(entity, Focusable)) return false;
    const active = world.isEntityActive
        ? world.isEntityActive(entity)
        : world.getEntitiesWithComponents([Focusable]).includes(entity);
    return active && skipReason(world, entity, readDialogScope(world)) === null;
}

/** Inspect Tab order without moving focus or emitting events. @experimental */
export function inspectFocusTraversal(world: FocusInspectionWorld): FocusTraversalInspection {
    const context = readDialogScope(world);
    const entries: FocusTraversalEntry[] = [];
    for (const entity of world.getEntitiesWithComponents([Focusable])) {
        if (!isLiveUIEntity(world, entity)) continue;
        entries.push({ entity, tabIndex: world.get(entity, Focusable).tabIndex,
            skipped: skipReason(world, entity, context) });
    }
    entries.sort((a, b) => a.tabIndex - b.tabIndex);
    return { entries, visibilityResolved: context.visibilityResolved };
}
