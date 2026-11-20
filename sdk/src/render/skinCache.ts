// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skinCache.ts
 * @brief   The project's compute skin cache settings: no imports, so the build pipeline reads them without the runtime.
 */
/**
 * The compute skin cache: a compute pass that poses each skinned mesh once a frame, so the shadow, depth and colour passes all draw the
 * posed vertices instead of each posing them again. A device without compute (WebGL2) poses in each draw's vertex stage either way.
 * @experimental
 */
export interface SkinCacheConfig {
    /** Off poses every skinned mesh in each draw's vertex stage. */
    enabled: boolean;
    /** Which meshes it poses when their MeshSkin says Auto: every one (`inclusive`), or only those that say Enabled (`exclusive`). */
    behavior: 'inclusive' | 'exclusive';
    /** The memory it may hold per world, in megabytes; a mesh that would take it past this is posed in the vertex stage. */
    maxMegabytes: number;
}

/** @experimental */
export const SKIN_CACHE_DEFAULTS: Readonly<SkinCacheConfig> = { enabled: true, behavior: 'inclusive', maxMegabytes: 128 };

/** Whether a skin cache config is the one a project that says nothing gets. @experimental */
export function isDefaultSkinCache(config: SkinCacheConfig | undefined): boolean {
    return !config || (config.enabled === SKIN_CACHE_DEFAULTS.enabled && config.behavior === SKIN_CACHE_DEFAULTS.behavior
        && config.maxMegabytes === SKIN_CACHE_DEFAULTS.maxMegabytes);
}
