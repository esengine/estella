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
import { engineApi } from '../ecs/bridge/engineApi';

/** Submits one pass's skeletons; `include` says which entities this pass owns. */
export type SkeletalDomainSubmit = (registry: { _cpp: CppRegistry }, include: (entity: Entity) => boolean) => void;

/**
 * Register `submit` for the cameras and for the screen overlay. A core that cannot
 * say what the screen owns has partitioned nothing, so everything goes to the cameras.
 */
export function addSkeletalSubmit(app: App, submit: SkeletalDomainSubmit, isActive: (entity: Entity) => boolean): void {
    const api = engineApi(app) as { ui_isScreenDomain?(registry: unknown, entity: number): boolean } | null;
    const isScreen = (registry: { _cpp: CppRegistry }, entity: Entity): boolean =>
        api?.ui_isScreenDomain?.(registry._cpp, entity) ?? false;
    app.pipeline?.addPreFlushCallback((registry) =>
        submit(registry, (e) => isActive(e) && !isScreen(registry, e)));
    if (!api?.ui_isScreenDomain) return;
    app.pipeline?.addScreenOverlayCallback((registry) =>
        submit(registry, (e) => isActive(e) && isScreen(registry, e)));
}
