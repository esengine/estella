// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry.ts
 * @brief   The single source of truth mapping an optional native module to its
 *          shipped artifacts and emscripten glue convention.
 *
 * @details Estella's optional native subsystems (physics, the per-version spine
 *          runtimes, …) ship as standalone emscripten modules — a `<file>.js`
 *          glue plus a `<file>.wasm`. They are acquired uniformly through a
 *          {@link SideModuleHost}; only the *transport* (fetch / inlined base64 /
 *          WeChat factory) differs per realm. This table is what every transport
 *          and the exporters agree on, so a module can never be referenced by one
 *          and shipped under a different name by another.
 */

/** Spine skeleton format versions Estella ships a dedicated runtime for. */
export type SpineVersion = '3.8' | '4.1' | '4.2';

/** Identifies an optional native module across every realm and transport. */
export type SideModuleId = 'physics' | `spine:${SpineVersion}`;

export interface SideModuleDescriptor {
    /** Artifact base name: the glue is `<file>.js`, the binary `<file>.wasm`. */
    file: string;
    /**
     * Global the emscripten glue assigns its factory to (`MODULARIZE` +
     * `EXPORT_NAME`). When absent the glue is an ES6 module whose `default`
     * export IS the factory. This is the only thing that varies between the
     * physics glue (ES6 default) and the spine glue (named global) loaders.
     */
    globalName?: string;
}

export const SIDE_MODULES: Record<SideModuleId, SideModuleDescriptor> = {
    physics: { file: 'physics' },
    'spine:3.8': { file: 'spine38', globalName: 'ESSpineModule' },
    'spine:4.1': { file: 'spine41', globalName: 'ESSpineModule' },
    'spine:4.2': { file: 'spine42', globalName: 'ESSpineModule' },
};

export const SPINE_VERSIONS: readonly SpineVersion[] = ['3.8', '4.1', '4.2'];

/** The {@link SideModuleId} carrying a given spine skeleton version. */
export function spineModuleId(version: SpineVersion): SideModuleId {
    return `spine:${version}`;
}
