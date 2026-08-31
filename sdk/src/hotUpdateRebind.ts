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
import { defineResource } from './ecs/resource';
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

/**
 * The second barrier of an update. `Assets.applyUpdate` resolves when the ASSET
 * graph has caught up; the bindings that read it move on a frame, so a paused
 * app converges when it resumes and this is how to wait for that.
 *
 * @beta
 */
export interface LiveBindingsData {
    /** Resolves once every ended era seen so far has been migrated onto its
     *  replacement, or given up on. Needs the app to be ticking. */
    settled(): Promise<void>;
}

/** The per-App live-binding coordinator, for a game or host that has to know
 *  when the world has caught up with an update.
 *
 * @beta
 */
export const LiveBindings = defineResource<LiveBindingsData>(null!, 'LiveBindings');

export function installHotUpdateRebind(app: App, assets: Assets): LiveBindingsData {
    // Ended eras (with the value bound before the drop), awaiting the reload;
    // and replacements awaiting their owner's transaction.
    const pending: Array<{ ref: string; type: AssetFieldType; oldValue: unknown }> = [];
    const ready: Array<{
        type: AssetFieldType; oldValue: unknown; scope: AssetScope; lease: AssetLease;
    }> = [];
    // Reloads started but not yet placed. Without them a caller can ask between
    // the queues and be told the world has caught up while an acquisition is in
    // the air.
    let reloading = 0;
    const waiting: Array<() => void> = [];
    const converged = (): boolean => pending.length === 0 && ready.length === 0 && reloading === 0;

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
                // Nobody holding it is the other silent end: the update committed,
                // the pixels did not move, nothing said why. Usually two cache
                // entries for one image, under two spellings of the same asset.
                let owners = 0;
                for (const scope of ownerScopesOf(world, type, oldValue, ownerScopeOf)) {
                    owners++;
                    reloading++;
                    void acquire(assets, type, ref).then(
                        (lease) => { ready.push({ type, oldValue, scope, lease }); },
                        (e: unknown) => {
                            log.warn('asset', `hot-update rebind: reloading "${ref}" failed; its holders keep the asset they have`, e);
                        },
                    ).finally(() => { reloading--; });
                }
                if (owners === 0) {
                    log.warn('asset', `hot-update rebind: nothing holds "${ref}" (${type}) at ${String(oldValue)}`
                        + ' — the update landed and no live binding moved');
                }
            }
            while (ready.length > 0) {
                const { type, oldValue, scope, lease } = ready.shift()!;
                migrateScopeBindings(
                    world, scope, type, oldValue,
                    { lease, boundValue: boundValueOf }, ownerScopeOf,
                );
            }
            if (converged()) for (const wake of waiting.splice(0)) wake();
        },
        {
            name: 'HotUpdateRebindSystem',
            // The reach is every component declaring a handle-bound asset field,
            // read from the registry at access time — a project component
            // registered after this system was installed binds them too.
            touches: () => ({ writes: componentsBindingAssetTypes(assets.handleBoundTypes()) }),
        },
    ));

    const coordinator: LiveBindingsData = {
        settled: () => (converged()
            ? Promise.resolve()
            : new Promise<void>((resolve) => { waiting.push(resolve); })),
    };
    app.insertResource(LiveBindings, coordinator);
    return coordinator;
}
