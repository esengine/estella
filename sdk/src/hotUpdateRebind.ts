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
 *          Each loader declares how its fields bind. The coordinator migrates
 *          stored handles. A field that reads a registry or file by name
 *          keeps its authored reference.
 *
 *          It is a transaction coordinator, not an owner: which fields hold the
 *          asset comes from `component.assetFields` (liveAssetBindings.ts), and
 *          one replacement generation is acquired, and each scope still holding
 *          the asset receives its own receipt (liveAssetRebind.ts).
 *
 *          Registered once per App (initRuntime). State lives in this closure —
 *          per install, not module-global — so realms don't share queues.
 */
import type { App } from './app/app';
import type { World } from './ecs/world';
import { defineResource } from './ecs/resource';
import { Schedule, defineSystem, GetWorld } from './ecs/system';
import { assetScopeForEntity } from './scene/sceneManager';
import type { Assets } from './asset/Assets';
import type { AssetLease } from './asset/AssetLease';
import type { AssetFieldType } from './scene/scene';
import { componentsBindingAssetTypes, liveAssetBindings, type LiveAssetBinding } from './asset/liveAssetBindings';
import { migrateLiveBindings } from './asset/liveAssetRebind';
import { boundValueIn } from './asset/leaseBindings';
import { log } from './util/logger';

/** Take the replacement out of the realm — by receipt, whatever its kind. */
function acquire(
    assets: Assets, type: AssetFieldType, ref: string, first: LiveAssetBinding, rest: Iterable<LiveAssetBinding>,
): Promise<AssetLease> {
    if (type !== 'texture' && type !== 'material') return assets.acquireTyped(type, ref);
    if (first.measuresTextureDensity) {
        for (const binding of rest) {
            if (!binding.measuresTextureDensity) return assets.acquireSurfaceBinding(type, ref, 'full');
        }
        return assets.acquireSurfaceBinding(type, ref, 'mesh');
    }
    return assets.acquireSurfaceBinding(type, ref, 'full');
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

interface BindingChange {
    ref: string;
    type: AssetFieldType;
    oldValue: number | string;
    epoch: number;
}

export function installHotUpdateRebind(app: App, assets: Assets): LiveBindingsData {
    const pending: BindingChange[] = [];
    const ready: Array<{ change: BindingChange; lease: AssetLease }> = [];
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
        if ((typeof oldValue === 'number' || typeof oldValue === 'string') && oldValue) {
            pending.push({ ref: event.bindingRef ?? event.ref, type, oldValue, epoch: assets.epoch });
        }
    });

    function publish(world: World, change: BindingChange, lease: AssetLease): void {
        try {
            if (change.epoch !== assets.epoch) return;
            const { ref, type, oldValue } = change;
            if (!assets.isCurrentBindingLease(type, ref, lease)) {
                // A second invalidation still owes the original bindings the latest era.
                pending.push(change);
                return;
            }
            const { moved, revisit } = migrateLiveBindings(world, type, oldValue, lease,
                (entity, create, value, preferred) => assetScopeForEntity(app, assets, entity, type, value, create, preferred));
            if (revisit) pending.push(change);
            else if (!moved) log.warn('asset', `hot-update rebind: placed nothing for "${type}" at ${String(oldValue)}`);
        } finally {
            lease.release();
        }
    }

    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [GetWorld()],
        (world) => {
            while (ready.length > 0) {
                const { change, lease } = ready.shift()!;
                try {
                    publish(world, change, lease);
                } catch (error) {
                    log.warn('asset', `hot-update rebind: could not finish publishing "${change.ref}"`, error);
                }
            }
            while (pending.length > 0) {
                const change = pending.shift()!;
                if (change.epoch !== assets.epoch) continue;
                const { ref, type, oldValue } = change;
                const bindings = liveAssetBindings(world, type, oldValue);
                const first = bindings.next();
                if (first.done) {
                    log.warn('asset', `hot-update rebind: nothing holds "${ref}" (${type}) at ${String(oldValue)}`);
                    continue;
                }
                reloading++;
                void acquire(assets, type, ref, first.value, bindings).then(
                    lease => { ready.push({ change, lease }); },
                    error => { log.warn('asset', `hot-update rebind: reloading "${ref}" failed; its holders keep the asset they have`, error); },
                ).finally(() => { reloading--; });
            }
            if (waiting.length && converged()) for (const wake of waiting.splice(0)) wake();
        },
        {
            name: 'HotUpdateRebindSystem',
            touches: () => ({ writes: componentsBindingAssetTypes(app.world, assets.handleBoundTypes()) }),
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
