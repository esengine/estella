// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registryLookup.ts
 * @brief   What THIS app's realm publishes for a ref-bound asset.
 *
 * @details The Assets instance is the realm: its slot table holds the current
 *          era of everything it loaded, and nothing else can see it. A subsystem
 *          that keeps asset publications in a module-global map instead answers
 *          with whichever app loaded last — and an editor world beside a play
 *          world in one process is two apps.
 *
 *          Code registrations stay where they are. `registerFsm('patrol', def)`
 *          is not an asset and has no realm; a domain registry holding those and
 *          only those is a single source of truth, not a mirror.
 */
import type { App } from '../app/app';
import { Assets } from './AssetPlugin';

/** The current era of one ref-bound asset in `app`'s realm. */
export function appRegistryAsset<T>(app: App, type: string, ref: string): T | undefined {
    return app.hasResource(Assets)
        ? app.getResource(Assets).resolveRegistryAsset<T>(type, ref)
        : undefined;
}

/** Every ref-bound asset of one type this realm publishes — what a schedule
 *  analysis reads, so it sees the graphs THIS app loaded and no others. */
export function appRegistryAssets<T>(app: App, type: string): T[] {
    return app.hasResource(Assets) ? app.getResource(Assets).publishedRegistryAssets<T>(type) : [];
}
