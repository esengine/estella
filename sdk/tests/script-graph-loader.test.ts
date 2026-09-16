// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-graph-loader.test.ts
 * @brief   What loading a `.esgraph` has to do before it is runnable: acquire
 *          the graphs it calls, and compile its call nodes against what THEY
 *          declare.
 *
 *          A caller's pins are the callee's declaration, so the two facts have
 *          to arrive together. Reading the callee's file a second time is not
 *          the same thing — one door resolves a ref that the other cannot, and
 *          the shape of that failure is a game where nothing moves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScriptGraphAssetLoader } from '../src/asset/loaders/ScriptGraphAssetLoader';
import type { LoadContext, ScriptGraphResult } from '../src/asset/AssetLoader';
import type { CompiledScriptGraph } from '../src/logic/ScriptGraphRunner';
import type { AssetLease } from '../src/asset/AssetLease';
import { aiRegistry } from '../src/ai/fsm/AiContext';
import { signatureOf } from '../src/logic/nodes';
import { SCRIPT_GRAPH_VERSION, type ScriptGraph } from '../src/logic/types';

const CALLEE: ScriptGraph = {
    version: SCRIPT_GRAPH_VERSION,
    name: 'Callee',
    inputs: [{ name: 'speed', type: 'number' }],
    outputs: [{ name: 'ok', type: 'bool' }],
    nodes: [{ id: 'in', kind: 'graph.input' }, { id: 'out', kind: 'graph.output' }],
    edges: [{ id: 'e', from: 'in', fromPort: 'then', to: 'out', toPort: '' }],
};

const CALLER: ScriptGraph = {
    version: SCRIPT_GRAPH_VERSION,
    name: 'Caller',
    nodes: [
        { id: 'upd', kind: 'event.update' },
        { id: 'call', kind: 'graph.call', literals: { graph: 'lib/callee.esgraph' } },
    ],
    edges: [{ id: 'e', from: 'upd', fromPort: 'then', to: 'call', toPort: '' }],
};

/** A lease over a value, with the ledger parts a loader never looks at. */
function lease<T>(value: T): AssetLease<T> {
    return { key: 'k', generation: 1, value, release: () => {}, split: () => null } as unknown as AssetLease<T>;
}

function context(acquire: (type: string, ref: string) => Promise<AssetLease<unknown>>): LoadContext {
    return {
        catalog: { getBuildPath: (p: string) => p },
        loadText: async () => JSON.stringify(CALLER),
        acquireAsset: acquire,
        preparePrefab: async () => lease({}),
    } as unknown as LoadContext;
}

/** The era a prepare publishes, with `published` named for what it is. */
async function prepare(path: string, ctx: LoadContext) {
    const era = await new ScriptGraphAssetLoader().registry.prepare(path, ctx);
    return { published: era.published as CompiledScriptGraph, value: era.value };
}

beforeEach(() => {
    aiRegistry.clear();
});

describe('loading a graph that calls another', () => {
    it('takes the callee signature off the acquisition, and compiles the call against it', async () => {
        const acquire = vi.fn(async (_type: string, _ref: string) =>
            lease<ScriptGraphResult>({ graphId: 'lib/callee.esgraph', signature: signatureOf(CALLEE) }));

        const era = await prepare('logic/caller.esgraph', context(acquire));

        // The callee is OWNED by this era, not merely read: the graph a call
        // enters has to still be there when the call runs.
        expect(acquire).toHaveBeenCalledWith('scriptgraph', 'lib/callee.esgraph');
        expect(era.published.problems).toEqual([]);
        const shape = era.published.shapes.get('call');
        expect(shape?.inputs).toEqual([{ name: 'speed', type: 'number', label: undefined }]);
        expect(shape?.outputs).toEqual([{ name: 'ok', type: 'bool', label: undefined }]);
    });

    it('publishes its own signature, which is what a caller of IT will read', async () => {
        const acquire = vi.fn(async () => lease<ScriptGraphResult>({ graphId: 'x' }));
        const ctx = context(acquire);
        (ctx as unknown as { loadText: () => Promise<string> }).loadText = async () => JSON.stringify(CALLEE);

        const era = await prepare('lib/callee.esgraph', ctx);

        expect(era.value.signature).toEqual(signatureOf(CALLEE));
    });

    it('leaves one unloadable call unmakeable and the rest of the graph intact', async () => {
        const acquire = vi.fn(async () => { throw new Error('404'); });

        const era = await prepare('logic/caller.esgraph', context(acquire));

        // The entry still compiled; only the node naming a graph this build
        // could not get is missing, and it says so.
        expect(era.published.updates).toEqual(['upd']);
        expect(era.published.shapes.has('call')).toBe(false);
        expect(era.published.problems.join('\n')).toMatch(/no graph "lib\/callee\.esgraph"/);
    });
});
