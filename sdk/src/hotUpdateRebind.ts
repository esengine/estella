// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hotUpdateRebind.ts
 * @brief   Built-in hot-update rebinder — makes a hot update transparent to game
 *          code. When applyUpdate / invalidate ends an asset's era this reloads
 *          the ref (now resolved to the fresh content) and moves every live
 *          binding of it onto the new one, so a scene that references an asset
 *          by @uuid updates on screen with ZERO game code.
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
import { componentsBindingAssetType } from './asset/liveAssetBindings';
import { boundValueOf, migrateScopeBindings, ownerScopesOf } from './asset/liveAssetRebind';
import { log } from './util/logger';

export function installHotUpdateRebind(app: App, assets: Assets): void {
    // Refs whose asset era ended (with the handle bound before the drop),
    // awaiting the reload; and replacements awaiting their owner's transaction.
    const pending: Array<{ ref: string; oldHandle: number }> = [];
    const ready: Array<{ oldHandle: number; scope: AssetScope; lease: AssetLease }> = [];

    assets.onInvalidate((event) => {
        // Textures only for now, said by reading the kind rather than by the event
        // being unable to describe anything else.
        if (event.type !== 'texture') return;
        const oldHandle = typeof event.oldValue === 'number' ? event.oldValue : 0;
        if (oldHandle) pending.push({ ref: event.ref, oldHandle });
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
                const { ref, oldHandle } = pending.shift()!;
                for (const scope of ownerScopesOf(world, 'texture', oldHandle, ownerScopeOf)) {
                    void assets.acquireTexture(ref).then(
                        (lease) => { ready.push({ oldHandle, scope, lease }); },
                        (e: unknown) => {
                            log.warn('asset', `hot-update rebind: reloading "${ref}" failed; its holders keep the asset they have`, e);
                        },
                    );
                }
            }
            while (ready.length > 0) {
                const { oldHandle, scope, lease } = ready.shift()!;
                migrateScopeBindings(
                    world, scope, 'texture', oldHandle,
                    { lease, boundValue: boundValueOf }, ownerScopeOf,
                );
            }
        },
        {
            name: 'HotUpdateRebindSystem',
            // The reach is every component declaring a texture field, read from
            // the registry at access time — a project component registered after
            // this system was installed binds textures too.
            touches: () => ({ writes: componentsBindingAssetType('texture') }),
        },
    ));
}
