// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ScriptGraphAssetLoader.ts
 * @brief   Loads a `.esgraph` and publishes the compiled graph on its slot, so a
 *          ScriptGraphAgent naming it resolves at runtime.
 *
 * The payload IS the runtime definition — the compile here only indexes it (pins
 * resolved, wires turned into lookups), which is why it happens once per era and
 * not once per name.
 */
import type { AssetLoader, LoadContext, RegistryAssetLoader, ScriptGraphResult } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { compileAgainstRegistry } from '../../logic/ScriptGraphAgent';
import type { ScriptGraph } from '../../logic/types';

export class ScriptGraphAssetLoader implements AssetLoader<ScriptGraphResult> {
    readonly type = 'scriptgraph';
    readonly extensions = ['.esgraph'];

    readonly registry: RegistryAssetLoader<ScriptGraphResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<ScriptGraphResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const graph = JSON.parse(text) as ScriptGraph;
            return { published: compileAgainstRegistry(graph), value: { graphId: path } };
        },
    };
}
