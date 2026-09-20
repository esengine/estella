// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  support.ts — what a build that ships Spine tells the core about it.
 *
 * A CALL rather than this module's own side effect. The registration used to sit
 * at the top of `spine/index.ts` and was reached by `import '../spine'` — and a
 * bare side-effect import is invisible to a bundler unless every layer is told
 * the file is impure. Neither layer was: the SDK's own tree-shake declares every
 * non-entry module pure, and the package's `sideEffects` names only the entry
 * files, not the chunks they are built into. So the editor's play realm shipped
 * the code and never ran it, and a scene with 3D physics loaded without a solver.
 *
 * A function that someone calls is a value dependency, which no tree-shake in any
 * layer may drop.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { setSceneOptionals } from '../runtime/sceneOptionals';
import { SpinePlugin as SpinePluginCtor } from './SpinePlugin';
import { loadSpineAssets, applySpineEntities } from './loadSpineScene';

/** Idempotent: both the `esengine/spine` subpath and an entry that ships
 *  everything call it, and a host may evaluate the bundle more than once. */
export function registerSpineSupport(): void {
    addEntryPlugin(() => new SpinePluginCtor());
    setSceneOptionals({
        spine: {
            manager: (app) => app.getPlugin(SpinePluginCtor)?.spineManager ?? null,
            load: loadSpineAssets,
            apply: applySpineEntities,
        },
    });
}
