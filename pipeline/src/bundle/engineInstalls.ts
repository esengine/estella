// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which engine modules a package installs — the one answer both exports use.
 *
 * A lean entry carries no optional subsystem; a package gets each one back by
 * importing its subpath. What a project needs is evidence, collected from four
 * places because a subsystem leaves its trace in whichever of them fits it:
 * a component in a scene, an asset extension, a wasm side module, or an import
 * the game's own scripts wrote.
 *
 * The mini-game export and the web export ask the same question and must not
 * answer it differently — a subsystem installed on one target and silently
 * missing on the other is the packaging bug that only a boot reveals.
 *
 * Node-free: the web export calls it mid-bundle and the mini-game export before
 * one, and neither wants a second copy of this table.
 */
import { SUBSYSTEM_INSTALL, type Subsystem } from '../project/targetSupport';
import { ESENGINE_SUBPATHS } from './esengineResolve';

/** A subsystem a document names by ASSET rather than by component: nothing in a
 *  scene says "script graph", the `.esgraph` it references does. */
const ASSET_SUBPATH: Readonly<Record<string, string>> = {
    '.esgraph': 'esengine/logic',
    '.esfsm': 'esengine/ai',
    '.esbt': 'esengine/ai',
};

/** …and the ones whose evidence is the wasm they pull in. Spine is keyed by
 *  prefix because its module id carries the runtime version. */
const SIDE_MODULE_SUBPATH: Readonly<Record<string, string>> = {
    physics: 'esengine/physics',
    physics3d: 'esengine/physics3d',
    dragonbones: 'esengine/dragonbones',
};

/** What a project's content and code say it needs. Each field is one kind of
 *  evidence; an export passes the ones it can see. */
export interface EngineInstallEvidence {
    /** Subsystems the cooked scenes and prefabs put in use. */
    subsystems?: Iterable<Subsystem>;
    /** Project-relative paths the cook included, read for their extensions. */
    assetPaths?: Iterable<string>;
    /** Side-module ids the wasm scan found. */
    sideModuleIds?: Iterable<string>;
    /** Bare `esengine/*` specifiers the game's own bundles import. */
    scriptImports?: Iterable<string>;
}

/** What a package installs, and whether a lean entry can carry it. */
export interface EngineInstallPlan {
    /** True when every subsystem in use has a subpath that installs it. */
    lean: boolean;
    /** The subpaths to import, sorted. Empty when nothing optional is in use. */
    subpaths: readonly string[];
}

function extensionOf(p: string): string {
    const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const dot = p.lastIndexOf('.');
    return dot > slash ? p.slice(dot).toLowerCase() : '';
}

/**
 * The engine modules this package installs. `lean` is false when something in
 * use has no subpath to install it (video today): that project takes the whole
 * entry, which carries everything, so the subpath list stops mattering.
 */
export function engineInstalls(evidence: EngineInstallEvidence): EngineInstallPlan {
    const subpaths = new Set<string>();
    let lean = true;
    for (const subsystem of evidence.subsystems ?? []) {
        const install = SUBSYSTEM_INSTALL[subsystem];
        if (install === 'base') continue;
        if (install === 'whole-entry') { lean = false; continue; }
        subpaths.add(install);
    }
    for (const p of evidence.assetPaths ?? []) {
        const subpath = ASSET_SUBPATH[extensionOf(p)];
        if (subpath) subpaths.add(subpath);
    }
    for (const id of evidence.sideModuleIds ?? []) {
        // Spine's module id names the runtime version it was built for.
        const subpath = id.startsWith('spine:') ? 'esengine/spine' : SIDE_MODULE_SUBPATH[id];
        if (subpath) subpaths.add(subpath);
    }
    for (const specifier of evidence.scriptImports ?? []) {
        // A script may import a subpath no content mentions — the game opens a
        // socket itself, or builds a tilemap in code. Its word is evidence too,
        // and only the ones the SDK publishes are ours to stage.
        if (specifier in ESENGINE_SUBPATHS) subpaths.add(specifier);
    }
    return { lean, subpaths: [...subpaths].sort() };
}
