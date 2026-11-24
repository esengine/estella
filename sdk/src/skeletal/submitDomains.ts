// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skeletal/submitDomains.ts
 * @brief   Where a skeletal runtime submits its posed meshes: the cameras, and the screen overlay.
 *
 * @details A skeleton under a screen-space Canvas is UI: the screen overlay draws it, in
 *          its place in the Canvas' tree, and no camera does (the core partitions the two
 *          collects the same way — RenderFrame::submitSkeletalBatch). So each runtime
 *          submits twice a frame, each time only what that pass owns: the cameras get the
 *          world's skeletons, the overlay the screen's. Asking first keeps a skeleton from
 *          being posed into the heap for a pass that would drop it.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import type { CppRegistry } from '../wasm';
import { worldEngineApi, type EngineApi } from '../ecs/bridge/engineApi';

/** Submits one pass's skeletons; `include` says which entities this pass owns. */
export type SkeletalDomainSubmit = (core: EngineApi, registry: CppRegistry, include: (entity: Entity) => boolean) => void;

/**
 * Register `submit` for the cameras and for the screen overlay. A core that cannot
 * say what the screen owns has partitioned nothing, so everything goes to the cameras.
 */
export function addSkeletalSubmit(
    app: App, manager: () => { readonly bindingRevision: number } | null, submit: SkeletalDomainSubmit,
): (() => void) | null {
    const pipeline = app.pipeline;
    if (!pipeline) return null;
    const world = app.world;
    const camera = pipeline.addPreFlushCallback(({ _cpp }) => {
        const core = worldEngineApi(world);
        if (core) submit(core, _cpp, e => world.isEntityActive(e) && !core.ui_isScreenDomain?.(_cpp, e));
    }, app);
    // A previously empty pass can gain a skeleton when its side module finishes loading, with no ECS write.
    let drewScreen = true;
    let previous: ReturnType<typeof manager> = null;
    let bindingRevision = -1, activityEpoch = -1;
    const screen = pipeline.addScreenOverlayCallback(({ _cpp }) => {
        previous = manager();
        bindingRevision = previous?.bindingRevision ?? 0;
        activityEpoch = _cpp.activityEpoch?.() ?? 0;
        drewScreen = false;
        const core = worldEngineApi(world);
        if (!core?.ui_isScreenDomain) return;
        submit(core, _cpp, e => {
            const include = world.isEntityActive(e) && core.ui_isScreenDomain!(_cpp, e);
            if (include) drewScreen = true;
            return include;
        });
    }, ({ _cpp }) => {
        const current = manager();
        return !drewScreen && previous === current && bindingRevision === (current?.bindingRevision ?? 0)
            && activityEpoch === (_cpp.activityEpoch?.() ?? 0);
    }, app);
    return () => { camera(); screen(); };
}
