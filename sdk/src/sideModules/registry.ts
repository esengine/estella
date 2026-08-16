// SPDX-License-Identifier: Apache-2.0
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
import { log } from '../util/logger';

/** Spine skeleton format versions Estella ships a dedicated runtime for. */
export type SpineVersion = '2.1' | '3.8' | '4.1' | '4.2' | '4.3';

/** The modules the engine itself builds and ships. */
export type BuiltinSideModuleId =
    'physics' | 'physics3d' | 'basis' | 'videodec' | 'dragonbones' | `spine:${SpineVersion}`;

/**
 * Identifies an optional native module across every realm and transport.
 *
 * OPEN, like `ExportPlatform` and `MiniGameVendor`: the built-ins are named for
 * completion, but a project can drop its own module in `.esengine/modules/<id>/`
 * and that id flows through acquisition, the export and every transport exactly
 * like a built-in one. Nothing here branches on the value — it is identity.
 *
 * This is what lets a third-party runtime (a vector-animation player, another
 * physics engine) be a MODULE rather than something a game has to fetch and
 * instantiate for itself. Doing it by hand works on the web and falls apart
 * everywhere else: a mini-game has no `fetch` and needs its binary staged into
 * the package, and a playable needs it inlined as base64. Those are the
 * transports below, and they are the whole reason to be in this table.
 */
export type SideModuleId = BuiltinSideModuleId | (string & {});

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

export const SIDE_MODULES: Record<BuiltinSideModuleId, SideModuleDescriptor> = {
    physics: { file: 'physics' },
    // The 3D world (Jolt). A separate module from the 2D one on purpose: the two
    // never share a solver, and a 2D project should not carry a 3D one's weight.
    physics3d: { file: 'physics3d', globalName: 'ESPhysics3DModule' },
    // Basis Universal KTX2 transcoder — compressed textures decode to a
    // GPU format on demand. MODULARIZE glue with a named EXPORT_NAME, like spine.
    basis: { file: 'basis', globalName: 'ESBasisModule' },
    // MPEG-1 software video decoder (pl_mpeg) — the engine-owned decode path
    // behind the wasm video backend on runtimes without a reliable native decoder.
    videodec: { file: 'videodec', globalName: 'ESVideoModule' },
    // One entry, not one per version: the DragonBones format is frozen, so there
    // is no second runtime for a version suffix to tell apart.
    dragonbones: { file: 'dragonbones', globalName: 'ESDragonBonesModule' },
    'spine:2.1': { file: 'spine21', globalName: 'ESSpineModule' },
    'spine:3.8': { file: 'spine38', globalName: 'ESSpineModule' },
    'spine:4.1': { file: 'spine41', globalName: 'ESSpineModule' },
    'spine:4.2': { file: 'spine42', globalName: 'ESSpineModule' },
    'spine:4.3': { file: 'spine43', globalName: 'ESSpineModule' },
};

export const SPINE_VERSIONS: readonly SpineVersion[] = ['2.1', '3.8', '4.1', '4.2', '4.3'];

/** The {@link SideModuleId} carrying a given spine skeleton version. */
export function spineModuleId(version: SpineVersion): SideModuleId {
    return `spine:${version}`;
}

/** Modules a project supplied, keyed by id. Separate from the built-in table so
 *  a project can never redefine `physics` out from under the engine. */
const projectModules = new Map<string, SideModuleDescriptor>();

/**
 * Declare a module the engine did not build.
 *
 * Called by the runtime from the packaged game's config (which the export writes
 * from `.esengine/modules/`), so a game never registers by hand — but it is
 * public, because a host embedding the engine may know its modules some other
 * way. Registering an id the engine owns is refused: `physics` meaning two
 * different binaries depending on load order is not a capability.
 */
export function registerSideModule(id: string, descriptor: SideModuleDescriptor): void {
    if (id in SIDE_MODULES) {
        log.warn('sidemodule', `ignoring a project module named "${id}" — that id belongs to the engine`);
        return;
    }
    projectModules.set(id, descriptor);
}

/** How every transport and the exporters resolve an id. Built-ins win. */
export function sideModuleDescriptor(id: SideModuleId): SideModuleDescriptor | undefined {
    return SIDE_MODULES[id as BuiltinSideModuleId] ?? projectModules.get(id);
}

/** The ids a project declared — what an editor or a diagnostic lists. */
export function projectSideModuleIds(): string[] {
    return [...projectModules.keys()];
}

/** Drop every project-declared module. Realm teardown: a reloaded play session
 *  must not inherit the previous project's modules. */
export function clearProjectSideModules(): void {
    projectModules.clear();
}
