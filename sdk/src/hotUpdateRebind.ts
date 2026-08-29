// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hotUpdateRebind.ts
 * @brief   Built-in hot-update rebinder — makes a hot update transparent to game
 *          code. When applyUpdate / invalidate drops an asset it reports the
 *          value that was bound; this reloads the ref (now resolved to the fresh
 *          content) and swaps old→new in every live component that declares a
 *          field of that asset type, so a scene that references an asset by
 *          @uuid updates on screen with ZERO game code.
 *
 *          Which fields those are comes from `component.assetFields` — see
 *          liveAssetBindings.ts for why it cannot be a list kept here.
 *
 *          Registered once per App (initRuntime). State lives in this closure —
 *          per install, not module-global — so realms don't share queues.
 */
import type { App } from './app/app';
import { Schedule, defineSystem, GetWorld } from './ecs/system';
import type { Assets } from './asset/Assets';
import {
    componentsBindingAssetType, findLiveAssetBindings, writeLiveAssetBinding,
} from './asset/liveAssetBindings';

export function installHotUpdateRebind(app: App, assets: Assets): void {
    // Refs whose asset was invalidated (with the handle bound before the drop),
    // awaiting a reload; and resolved old→new handle swaps awaiting application.
    const pending: Array<{ ref: string; oldHandle: number }> = [];
    const swaps: Array<{ oldHandle: number; newHandle: number }> = [];

    assets.onInvalidate((event) => {
        // Textures only for now, said by reading the kind rather than by the event
        // being unable to describe anything else.
        if (event.type !== 'texture') return;
        const oldHandle = typeof event.oldValue === 'number' ? event.oldValue : 0;
        if (oldHandle) pending.push({ ref: event.ref, oldHandle });
    });

    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [GetWorld()],
        (world) => {
            // Kick a reload for each newly-invalidated ref; the async result (the
            // new handle) lands in `swaps` a frame or two later.
            while (pending.length > 0) {
                const { ref, oldHandle } = pending.shift()!;
                void assets.loadTexture(ref).then((tex) => {
                    if (tex.handle !== oldHandle) swaps.push({ oldHandle, newHandle: tex.handle });
                });
            }
            while (swaps.length > 0) {
                const { oldHandle, newHandle } = swaps.shift()!;
                for (const binding of findLiveAssetBindings(world, 'texture', oldHandle)) {
                    writeLiveAssetBinding(world, binding, newHandle);
                }
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
