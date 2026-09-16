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
 *
 * It also PREPARES what the graph may spawn. A spawn node hands the new entity
 * to the next node on the wire, so it cannot wait for a load; the wait belongs
 * here, where the graph itself is being loaded. Acquired through the context, so
 * the prefab is owned by this era and given back when it retires.
 *
 * The graphs it CALLS are acquired the same way, and the acquisition IS where
 * their signature comes from: a caller's pins are the callee's declaration, so
 * one door hands back both the ownership and the shape.
 */
import type { AssetLoader, LoadContext, RegistryAssetLoader, ScriptGraphResult } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { compileAgainstRegistry } from '../../logic/ScriptGraphAgent';
import {
    scriptGraphCallRefs, scriptGraphPrefabRefs, signatureOf, type ScriptGraphSignature,
} from '../../logic/nodes';
import type { ScriptGraph } from '../../logic/types';
import { log } from '../../util/logger';

export class ScriptGraphAssetLoader implements AssetLoader<ScriptGraphResult> {
    readonly type = 'scriptgraph';
    readonly extensions = ['.esgraph'];

    readonly registry: RegistryAssetLoader<ScriptGraphResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<ScriptGraphResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const graph = JSON.parse(text) as ScriptGraph;
            const signatures = new Map<string, ScriptGraphSignature>();
            for (const ref of scriptGraphCallRefs(graph)) {
                try {
                    const called = await ctx.acquireAsset<ScriptGraphResult>(this.type, ref);
                    if (called.value.signature) signatures.set(ref, called.value.signature);
                } catch (e) {
                    // Reported, not thrown: a graph that will not load leaves its
                    // call sites unmakeable and every other node still running.
                    log.warn('logic', `${path}: graph "${ref}" did not load: ${String(e)}`);
                }
            }
            const compiled = compileAgainstRegistry(graph, signatures);
            for (const ref of scriptGraphPrefabRefs(graph)) {
                try {
                    compiled.prefabs.set(ref, (await ctx.preparePrefab!(ref)).value);
                } catch (e) {
                    // Reported, not thrown: one unspawnable prefab must not take
                    // the whole graph — every other node in it still runs.
                    log.warn('logic', `${path}: prefab "${ref}" did not prepare: ${String(e)}`);
                }
            }
            return { published: compiled, value: { graphId: path, signature: signatureOf(graph) } };
        },
    };
}
