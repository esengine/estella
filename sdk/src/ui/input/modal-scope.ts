// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { UIDialog, isDialogOpen } from '../core/ui-dialog';
import { walkParentChain } from '../util/helpers';
import { createLiveVisibilityQuery } from '../util/live-visibility';

/** Read-only scene queries needed to inspect focus. @experimental */
export type FocusInspectionWorld = Pick<World, 'getWasmModule' | 'getCppRegistry' | 'getEntitiesWithComponents' | 'valid' | 'has' | 'get'>;

export function isLiveUIEntity(world: Pick<World, 'valid'> & Partial<Pick<World, 'isDestructionPending'>>, entity: Entity): boolean {
    return world.valid(entity) && !world.isDestructionPending?.(entity);
}

/** Visible leaf dialogs own input. Independent branches each keep their own
 *  controls. Read live authored visibility so callbacks can change the scope
 *  between a pointer press and release without waiting for layout. */
export function readDialogScope(world: FocusInspectionWorld) {
    const engine = worldEngineApi(world), registry = world.getCppRegistry();
    const visibilityResolved = !!(registry && engine?.getUINodeHiddenInTree);
    const hiddenInTree = createLiveVisibilityQuery(world, entity =>
        visibilityResolved && engine!.getUINodeHiddenInTree!(registry!, entity));
    const roots = new Set(world.getEntitiesWithComponents([UIDialog])
        .filter(entity => isLiveUIEntity(world, entity) && isDialogOpen(world, entity) && !hiddenInTree(entity)));
    if (roots.size > 1) for (const root of [...roots]) {
        walkParentChain(world, root, ancestor => { roots.delete(ancestor); return false; });
    }
    function dialogOf(entity: Entity): Entity | null {
        if (!roots.size) return null;
        if (roots.has(entity)) return entity;
        let dialog: Entity | null = null;
        walkParentChain(world, entity, ancestor => {
            if (!roots.has(ancestor)) return false;
            dialog = ancestor;
            return true;
        });
        return dialog;
    }
    return { roots, hiddenInTree, visibilityResolved, dialogOf };
}
