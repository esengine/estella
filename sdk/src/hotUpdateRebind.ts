// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hotUpdateRebind.ts
 * @brief   Built-in hot-update rebinder — makes a hot update transparent to game
 *          code. When applyUpdate / invalidate drops an asset it reports the
 *          texture handle that was bound; this reloads the ref (now resolved to
 *          the fresh content) and swaps old→new in every live texture-bearing
 *          component, so a scene that references an asset by @uuid updates on
 *          screen with ZERO game code.
 *
 *          Registered once per App (initRuntime). State lives in this closure —
 *          per install, not module-global — so realms don't share queues.
 */
import type { App } from './app';
import { Schedule, defineSystem } from './ecs/system';
import { Query, Mut } from './ecs/query';
import { Sprite, Mesh2D } from './ecs/component';
import type { Assets } from './asset/Assets';

export function installHotUpdateRebind(app: App, assets: Assets): void {
    // Refs whose asset was invalidated (with the handle bound before the drop),
    // awaiting a reload; and resolved old→new handle swaps awaiting application.
    const pending: Array<{ ref: string; oldHandle: number }> = [];
    const swaps: Array<{ oldHandle: number; newHandle: number }> = [];

    assets.onInvalidate((ref, oldTextureHandle) => {
        if (oldTextureHandle) pending.push({ ref, oldHandle: oldTextureHandle });
    });

    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [Query(Mut(Sprite)), Query(Mut(Mesh2D))],
        (sprites, meshes) => {
            // Kick a reload for each newly-invalidated ref; the async result (the
            // new handle) lands in `swaps` a frame or two later.
            while (pending.length > 0) {
                const { ref, oldHandle } = pending.shift()!;
                void assets.loadTexture(ref).then((tex) => {
                    if (tex.handle !== oldHandle) swaps.push({ oldHandle, newHandle: tex.handle });
                });
            }
            if (swaps.length === 0) return;
            // Swap old→new in every live sprite / mesh (each query iterated once).
            for (const [, sprite] of sprites) {
                const s = swaps.find((x) => x.oldHandle === sprite.texture);
                if (s) sprite.texture = s.newHandle;
            }
            for (const [, mesh] of meshes) {
                const s = swaps.find((x) => x.oldHandle === mesh.texture);
                if (s) mesh.texture = s.newHandle;
            }
            swaps.length = 0;
        },
        { name: 'HotUpdateRebindSystem' },
    ));
}
