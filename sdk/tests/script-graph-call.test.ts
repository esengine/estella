// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-graph-call.test.ts
 * @brief   One graph calling another: the signature, the frame, and the two
 *          ways a call has to stop rather than take the process with it.
 *
 *          A call runs the callee to completion inside the caller's step, so
 *          what is held here is that arguments arrive, results come back, the
 *          callee's variables belong to the CALL SITE, and a graph that calls
 *          itself is stopped by a depth rather than by the JS stack.
 */
import { describe, it, expect } from 'vitest';
import { AiRegistry } from '../src/ai/fsm/registry';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import {
    compileScriptGraph, createScriptRunState, stepScriptGraph, MAX_CALL_DEPTH,
    type CompiledScriptGraph, type ScriptTickContext,
} from '../src/logic/ScriptGraphRunner';
import { scriptCatalog, signatureOf, type ScriptGraphSignature } from '../src/logic/nodes';
import {
    SCRIPT_GRAPH_VERSION,
    type ScriptGraph, type ScriptGraphEdge, type ScriptGraphNode, type ScriptGraphPort,
} from '../src/logic/types';

interface TestCtx { log: string[]; }

function registry(): AiRegistry<TestCtx> {
    const reg = new AiRegistry<TestCtx>();
    reg.registerAction('test.say', {
        params: [{ name: 'text', type: 'string' }],
        run: (ctx, _bb, _arg, params) => { ctx.log.push(String(params?.text ?? '')); },
    });
    reg.registerValue('test.add', {
        params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
        outputs: [{ name: 'sum', type: 'number' }],
        evaluate: (_ctx, _bb, params, out) => { out.sum = Number(params.a ?? 0) + Number(params.b ?? 0); },
    });
    return reg;
}

const node = (id: string, kind: string, extra: Partial<ScriptGraphNode> = {}): ScriptGraphNode =>
    ({ id, kind, ...extra });
const edge = (from: string, fromPort: string, to: string, toPort: string): ScriptGraphEdge =>
    ({ id: `${from}.${fromPort}->${to}.${toPort}`, from, fromPort, to, toPort });

function graphOf(
    nodes: ScriptGraphNode[],
    edges: ScriptGraphEdge[],
    extra: Partial<Pick<ScriptGraph, 'inputs' | 'outputs' | 'variables'>> = {},
): ScriptGraph {
    return { version: SCRIPT_GRAPH_VERSION, nodes, edges, ...extra };
}

interface Suite {
    log: string[];
    problems: string[];
    tick(dt?: number): void;
    halted(): boolean;
}

/**
 * Compile a whole set of graphs against each other, the way a loader does: each
 * one's signature is available to whoever calls it, and a call resolves by name
 * at run time.
 */
function suite(
    graphs: Record<string, ScriptGraph>,
    entry: string,
    opts: { budget?: number; unloaded?: readonly string[] } = {},
): Suite {
    const reg = registry();
    const signatures = new Map<string, ScriptGraphSignature>();
    for (const [key, g] of Object.entries(graphs)) signatures.set(key, signatureOf(g));

    const compiled = new Map<string, CompiledScriptGraph>();
    const problems: string[] = [];
    for (const [key, g] of Object.entries(graphs)) {
        const c = compileScriptGraph(g, scriptCatalog(reg, signatures));
        compiled.set(key, c);
        problems.push(...c.problems);
    }

    const root = compiled.get(entry)!;
    // A graph whose SIGNATURE this build knew at compile time but which is not
    // there to run — an asset the realm no longer holds.
    for (const key of opts.unloaded ?? []) compiled.delete(key);
    const state = createScriptRunState(root);
    const ctx: TestCtx = { log: [] };
    const tickCtx = (dt: number): ScriptTickContext<TestCtx> => ({
        ctx, bb: new Blackboard(), registry: reg, dt,
        onProblem: (m) => problems.push(m),
        resolveGraph: (ref) => compiled.get(ref),
        ...(opts.budget === undefined ? {} : { budget: opts.budget }),
    });
    return {
        log: ctx.log,
        problems,
        tick: (dt = 1 / 60) => stepScriptGraph(root, state, tickCtx(dt)),
        halted: () => state.halted,
    };
}

const NUM = (name: string): ScriptGraphPort => ({ name, type: 'number' });

/** A callable graph: `sum = a + b`, and it says so in the log. */
function adder(): ScriptGraph {
    return graphOf([
        node('in', 'graph.input'),
        node('say', 'call', { ref: 'test.say', literals: { text: 'added' } }),
        node('add', 'call', { ref: 'test.add' }),
        node('out', 'graph.output'),
    ], [
        edge('in', 'then', 'say', ''),
        edge('say', 'then', 'out', ''),
        edge('in', 'a', 'add', 'a'),
        edge('in', 'b', 'add', 'b'),
        edge('add', 'sum', 'out', 'sum'),
    ], { inputs: [NUM('a'), NUM('b')], outputs: [NUM('sum')] });
}

describe('a graph calling another graph', () => {
    it('hands the arguments in and reads the results back', () => {
        const s = suite({
            adder: adder(),
            main: graphOf([
                node('start', 'event.start'),
                node('call', 'graph.call', { literals: { graph: 'adder', a: 2, b: 5 } }),
                node('say', 'call', { ref: 'test.say' }),
            ], [
                edge('start', 'then', 'call', ''),
                edge('call', 'then', 'say', ''),
                edge('call', 'sum', 'say', 'text'),
            ]),
        }, 'main');

        s.tick();

        expect(s.problems).toEqual([]);
        // The callee ran, and its result came back up the wire as a value the
        // caller could use.
        expect(s.log).toEqual(['added', '7']);
    });

    it('gives each call site its own variables', () => {
        // A counter graph: bump its own variable and report it back. Two call
        // sites must not be counting the same thing — a callee's state belongs
        // to the call site, the way an entity's graph belongs to the entity.
        const counter = graphOf([
            node('in', 'graph.input'),
            node('bump', 'var.set', { literals: { name: 'n' } }),
            node('add', 'call', { ref: 'test.add', literals: { b: 1 } }),
            node('get', 'var.get', { literals: { name: 'n' } }),
            node('out', 'graph.output'),
        ], [
            edge('in', 'then', 'bump', ''),
            edge('get', 'value', 'add', 'a'),
            edge('add', 'sum', 'bump', 'value'),
            edge('bump', 'then', 'out', ''),
            edge('get', 'value', 'out', 'n'),
        ], { outputs: [NUM('n')], variables: [{ name: 'n', type: 'number', default: 0 }] });

        const s = suite({
            counter,
            main: graphOf([
                node('upd', 'event.update'),
                node('c1', 'graph.call', { literals: { graph: 'counter' } }),
                node('s1', 'call', { ref: 'test.say' }),
                node('c2', 'graph.call', { literals: { graph: 'counter' } }),
                node('s2', 'call', { ref: 'test.say' }),
            ], [
                edge('upd', 'then', 'c1', ''),
                edge('c1', 'then', 's1', ''),
                edge('c1', 'n', 's1', 'text'),
                edge('s1', 'then', 'c2', ''),
                edge('c2', 'then', 's2', ''),
                edge('c2', 'n', 's2', 'text'),
            ]),
        }, 'main');

        s.tick();
        s.tick();

        expect(s.problems).toEqual([]);
        // Each site counts 1 then 2: its own variable, kept between calls the
        // way an entity's graph keeps its own. One shared variable would count
        // 1, 2, 3, 4.
        expect(s.log).toEqual(['1', '1', '2', '2']);
    });

    it('refuses to compile a call naming a graph nothing declares', () => {
        const s = suite({
            main: graphOf([
                node('start', 'event.start'),
                node('call', 'graph.call', { literals: { graph: 'missing' } }),
                node('after', 'call', { ref: 'test.say', literals: { text: 'after' } }),
            ], [
                edge('start', 'then', 'call', ''),
                edge('call', 'then', 'after', ''),
            ]),
        }, 'main');

        s.tick();

        // No signature, no pins — the node is one this build cannot make, so
        // control never reaches what was wired after it.
        expect(s.log).toEqual([]);
        expect(s.problems.join('\n')).toMatch(/no graph "missing"/);
    });

    it('stops at a call whose graph is declared but not loaded', () => {
        // The other half: the signature was there when this compiled, and the
        // asset is not there to run. Control still stops — the next node was
        // going to read results nothing produced.
        const s = suite({
            adder: adder(),
            main: graphOf([
                node('start', 'event.start'),
                node('call', 'graph.call', { literals: { graph: 'adder', a: 1, b: 1 } }),
                node('after', 'call', { ref: 'test.say', literals: { text: 'after' } }),
            ], [
                edge('start', 'then', 'call', ''),
                edge('call', 'then', 'after', ''),
            ]),
        }, 'main', { unloaded: ['adder'] });

        s.tick();

        expect(s.log).toEqual([]);
        expect(s.problems.join('\n')).toMatch(/is not loaded/);
    });

    it('stops at a graph with no way in', () => {
        const s = suite({
            noEntry: graphOf([node('say', 'call', { ref: 'test.say', literals: { text: 'x' } })], []),
            main: graphOf([
                node('start', 'event.start'),
                node('call', 'graph.call', { literals: { graph: 'noEntry' } }),
                node('after', 'call', { ref: 'test.say', literals: { text: 'after' } }),
            ], [
                edge('start', 'then', 'call', ''),
                edge('call', 'then', 'after', ''),
            ]),
        }, 'main');

        s.tick();

        expect(s.log).toEqual([]);
        expect(s.problems.join('\n')).toMatch(/no graph\.input/);
    });

    it('stops a graph that calls itself, at a depth rather than on the stack', () => {
        const s = suite({
            loop: graphOf([
                node('in', 'graph.input'),
                node('again', 'graph.call', { literals: { graph: 'loop' } }),
            ], [edge('in', 'then', 'again', '')]),
            main: graphOf([
                node('start', 'event.start'),
                node('call', 'graph.call', { literals: { graph: 'loop' } }),
            ], [edge('start', 'then', 'call', '')]),
        }, 'main');

        expect(() => s.tick()).not.toThrow();
        expect(s.halted()).toBe(true);
        expect(s.problems.join('\n')).toMatch(new RegExp(`deeper than ${MAX_CALL_DEPTH}`));
    });

    it('spends the callers budget, so a runaway callee stops the instance', () => {
        // The callee loops forever. The budget belongs to the INSTANCE, not to
        // each graph, or a caller could buy an unbounded amount of work by
        // calling one that never returns.
        const s = suite({
            spin: graphOf([
                node('in', 'graph.input'),
                node('loop', 'flow.while', { literals: { cond: true } }),
                node('body', 'call', { ref: 'test.say', literals: { text: '.' } }),
            ], [
                edge('in', 'then', 'loop', ''),
                edge('loop', 'body', 'body', ''),
            ]),
            main: graphOf([
                node('start', 'event.start'),
                node('call', 'graph.call', { literals: { graph: 'spin' } }),
            ], [edge('start', 'then', 'call', '')]),
        }, 'main', { budget: 50 });

        s.tick();

        expect(s.halted()).toBe(true);
        expect(s.log.length).toBeLessThanOrEqual(50);
        expect(s.problems.join('\n')).toMatch(/step budget/);
    });

    it('charges every call to the same budget', () => {
        // Two calls of a graph that costs 5 steps, against a budget of 10. One
        // budget per INSTANCE: a fresh one per callee would buy unbounded work
        // by calling often instead of looping.
        const work = graphOf([
            node('in', 'graph.input'),
            node('seq', 'flow.sequence', { literals: { count: 4 } }),
            node('a', 'call', { ref: 'test.say', literals: { text: 'a' } }),
            node('b', 'call', { ref: 'test.say', literals: { text: 'b' } }),
            node('c', 'call', { ref: 'test.say', literals: { text: 'c' } }),
            node('d', 'call', { ref: 'test.say', literals: { text: 'd' } }),
        ], [
            edge('in', 'then', 'seq', ''),
            edge('seq', '0', 'a', ''), edge('seq', '1', 'b', ''),
            edge('seq', '2', 'c', ''), edge('seq', '3', 'd', ''),
        ]);
        const s = suite({
            work,
            main: graphOf([
                node('start', 'event.start'),
                node('c1', 'graph.call', { literals: { graph: 'work' } }),
                node('c2', 'graph.call', { literals: { graph: 'work' } }),
            ], [
                edge('start', 'then', 'c1', ''),
                edge('c1', 'then', 'c2', ''),
            ]),
        }, 'main', { budget: 10 });

        s.tick();

        expect(s.halted()).toBe(true);
        expect(s.log.length).toBeLessThan(8);
        expect(s.problems.join('\n')).toMatch(/step budget/);
    });

    it('refuses a wait inside a graph a call enters', () => {
        const s = suite({
            waiter: graphOf([
                node('in', 'graph.input'),
                node('wait', 'flow.delay', { literals: { seconds: 1 } }),
                node('say', 'call', { ref: 'test.say', literals: { text: 'late' } }),
            ], [
                edge('in', 'then', 'wait', ''),
                edge('wait', 'then', 'say', ''),
            ]),
            main: graphOf([
                node('start', 'event.start'),
                node('call', 'graph.call', { literals: { graph: 'waiter' } }),
            ], [edge('start', 'then', 'call', '')]),
        }, 'main');

        s.tick();

        // There is no later tick for the timer to expire on: the call returns
        // within its caller's step. So the node is one this build cannot make.
        expect(s.problems.join('\n')).toMatch(/cannot wait/);
        expect(s.log).toEqual([]);
    });

    it('refuses a second way in', () => {
        const s = suite({
            two: graphOf([node('in', 'graph.input'), node('in2', 'graph.input')], []),
            main: graphOf([], []),
        }, 'main');

        expect(s.problems.join('\n')).toMatch(/a second graph\.input/);
    });
});
