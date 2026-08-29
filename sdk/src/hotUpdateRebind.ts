// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hotUpdateRebind.ts
 * @brief   Built-in live-binding coordinator — makes a new generation transparent
 *          to game code. When applyUpdate / invalidate ends an asset's era this
 *          reloads the ref (now resolved to the fresh content) and moves every
 *          live binding of it onto the new one, so a scene that references an
 *          asset by @uuid updates on screen with ZERO game code.
 *
 *          A RECEIPT never changes generation: whoever holds one keeps the era
 *          they acquired until they release it. A live BINDING is the other
 *          thing — a field that names an asset and follows what that name means
 *          now — and it is the only thing migrated here.
 *
 *          Which types are migrated is read, not listed: an asset a component
 *          holds by handle has a `load` door, and one it holds by ref has a slot
 *          that swaps under the name the field already carries.
 *
 *          It is a transaction coordinator, not an owner: which fields hold the
 *          asset comes from `component.assetFields` (liveAssetBindings.ts), and
 *          the replacement is acquired once per owning scope and handed to that
 *          scope (liveAssetRebind.ts). What it acquires and cannot place, it
 *          gives back.
 *
 *          Registered once per App (initRuntime). State lives in this closure —
 *          per install, not module-global — so realms don't share queues.
 */
import type { App } from './app/app';
import { Schedule, defineSystem, GetWorld } from './ecs/system';
import { assetScopeForEntity } from './scene/sceneManager';
import type { Entity } from './types';
import type { Assets } from './asset/Assets';
import type { AssetScope, AssetLease } from './asset/AssetLease';
import type { AssetFieldType } from './scene/scene';
import { componentsBindingAssetTypes } from './asset/liveAssetBindings';
import { boundValueIn, boundValueOf, migrateScopeBindings, ownerScopesOf } from './asset/liveAssetRebind';
import { log } from './util/logger';

/** Take the replacement out of the realm — by receipt, whatever its kind. */
function acquire(assets: Assets, type: AssetFieldType, ref: string): Promise<AssetLease> {
    return type === 'texture'
        ? assets.acquireTexture(ref)
        : assets.acquireTyped(type, ref);
}

export function installHotUpdateRebind(app: App, assets: Assets): void {
    // Ended eras (with the value bound before the drop), awaiting the reload;
    // and replacements awaiting their owner's transaction.
    const pending: Array<{ ref: string; type: AssetFieldType; oldValue: unknown }> = [];
    const ready: Array<{
        type: AssetFieldType; oldValue: unknown; scope: AssetScope; lease: AssetLease;
    }> = [];

    assets.onInvalidate((event) => {
        // The type vocabulary is one: what a loader answers to is what a field
        // declares. A ref-bound asset reports one too, and has nothing to move.
        const type = event.type as AssetFieldType;
        if (!assets.handleBoundTypes().includes(type)) return;
        const oldValue = boundValueIn(event.oldValue);
        if (oldValue !== undefined && oldValue !== 0) pending.push({ ref: event.ref, type, oldValue });
    });

    // Who owns what an entity holds is answered in ONE place, not here: a
    // promoted entity carries no scene tag and owns its assets itself, and a
    // second copy of this rule is how it came to be handed to the app instead.
    const ownerScopeOf = (entity: Entity): AssetScope =>
        assetScopeForEntity(app, assets, entity);

    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [GetWorld()],
        (world) => {
            // One acquisition per owning scope; the async results land in
            // `ready` a frame or two later, each with the scope it is for.
            while (pending.length > 0) {
                const { ref, type, oldValue } = pending.shift()!;
                for (const scope of ownerScopesOf(world, type, oldValue, ownerScopeOf)) {
                    void acquire(assets, type, ref).then(
                        (lease) => { ready.push({ type, oldValue, scope, lease }); },
                        (e: unknown) => {
                            log.warn('asset', `hot-update rebind: reloading "${ref}" failed; its holders keep the asset they have`, e);
                        },
                    );
                }
            }
            while (ready.length > 0) {
                const { type, oldValue, scope, lease } = ready.shift()!;
                migrateScopeBindings(
                    world, scope, type, oldValue,
                    { lease, boundValue: boundValueOf }, ownerScopeOf,
                );
            }
        },
        {
            name: 'HotUpdateRebindSystem',
            // The reach is every component declaring a handle-bound asset field,
            // read from the registry at access time — a project component
            // registered after this system was installed binds them too.
            touches: () => ({ writes: componentsBindingAssetTypes(assets.handleBoundTypes()) }),
        },
    ));
}
