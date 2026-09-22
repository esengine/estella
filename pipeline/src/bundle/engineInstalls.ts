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
import type { ModuleChoice, ProjectFeatures } from '../project/format';
import { ESENGINE_SUBPATHS } from './engineSubpaths';

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

/**
 * Side-module ids a project FORCED in, from the same table the evidence reads.
 *
 * A module reached only from a script leaves no trace for the wasm scan either,
 * so `include` has to reach it: shipping the JS without the binary fails at the
 * first spawn rather than at build time.
 */
export function forcedSideModules(
    choices: Readonly<Record<string, ModuleChoice>>,
): readonly string[] {
    return Object.entries(SIDE_MODULE_SUBPATH)
        .filter(([, subpath]) => choices[subpath] === 'include')
        .map(([id]) => id);
}

/**
 * What a project SAYS, against what the build detects. Keyed by the subpath the
 * module is installed from, and absorbing the older `features.physics.enabled`,
 * which was this for one module: a way to name what only a script reaches.
 */
export function moduleChoices(
    features: ProjectFeatures | undefined,
    /** Per-target overrides, laid over the project's own — one target's limits
     *  are not another's. Omit for the project-wide answer. */
    perPlatform?: Readonly<Record<string, ModuleChoice>>,
): Readonly<Record<string, ModuleChoice>> {
    const out: Record<string, ModuleChoice> = { ...(features?.modules ?? {}) };
    // The old field, and only where the new one is silent: a project that says
    // both means the one it was last edited with.
    if (features?.physics?.enabled && out['esengine/physics'] === undefined) {
        out['esengine/physics'] = 'include';
    }
    return { ...out, ...(perPlatform ?? {}) };
}

/** A module the project refused that its own content uses. */
export interface ExcludedInUse {
    /** The subpath specifier, as `features.modules` names it. */
    specifier: string;
    /** What said the project uses it, for a message someone can act on. */
    evidence: string;
}

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
    /** What the project said, from {@link moduleChoices}. */
    choices?: Readonly<Record<string, ModuleChoice>>;
}

/** What a package installs, and whether a lean entry can carry it. */
export interface EngineInstallPlan {
    /** True when every subsystem in use has a subpath that installs it. */
    lean: boolean;
    /** The subpaths to import, sorted. Empty when nothing optional is in use. */
    subpaths: readonly string[];
    /** Modules the project excluded that its content uses anyway. An export with
     *  any of these must fail: the alternative is a package missing half a scene
     *  and nothing saying which half. */
    refused: readonly ExcludedInUse[];
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
    /** Subpath → the first thing that said this project uses it. Kept so a
     *  refusal can name what it is arguing with, rather than the module. */
    const why = new Map<string, string>();
    const saw = (subpath: string, evidenceOf: string): void => {
        if (!why.has(subpath)) why.set(subpath, evidenceOf);
    };
    let lean = true;
    for (const subsystem of evidence.subsystems ?? []) {
        const install = SUBSYSTEM_INSTALL[subsystem];
        if (install === 'base') continue;
        if (install === 'whole-entry') { lean = false; continue; }
        saw(install, `a ${subsystem} component in the content`);
    }
    for (const p of evidence.assetPaths ?? []) {
        const subpath = ASSET_SUBPATH[extensionOf(p)];
        if (subpath) saw(subpath, p);
    }
    for (const id of evidence.sideModuleIds ?? []) {
        // Spine's module id names the runtime version it was built for.
        const subpath = id.startsWith('spine:') ? 'esengine/spine' : SIDE_MODULE_SUBPATH[id];
        if (subpath) saw(subpath, `the "${id}" side module`);
    }
    for (const specifier of evidence.scriptImports ?? []) {
        // A script may import a subpath no content mentions — the game opens a
        // socket itself, or builds a tilemap in code. Its word is evidence too,
        // and only the ones the SDK publishes are ours to stage.
        if (specifier in ESENGINE_SUBPATHS) saw(specifier, `a project script imports "${specifier}"`);
    }

    const choices = evidence.choices ?? {};
    const refused: ExcludedInUse[] = [];
    const subpaths = new Set<string>();
    for (const [specifier, evidenceOf] of why) {
        if (choices[specifier] === 'exclude') refused.push({ specifier, evidence: evidenceOf });
        else subpaths.add(specifier);
    }
    // `include` is for what no evidence can reach — a module a script loads by a
    // name no bundler resolves. Only for a subpath the SDK publishes, so a typo
    // is not a module nobody can stage.
    for (const [specifier, choice] of Object.entries(choices)) {
        if (choice === 'include' && specifier in ESENGINE_SUBPATHS) subpaths.add(specifier);
    }
    return { lean, subpaths: [...subpaths].sort(), refused };
}
