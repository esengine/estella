// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-graph-runner.test.ts
 * @brief   The script-graph interpreter's promises, each pinned on its own.
 *
 * These are the claims an author reads off the picture: pin 0 runs before pin 1,
 * one wire is one value, a loop can end, and a loop that cannot end stops the
 * instance instead of the frame.
 */
import { describe, it, expect } from 'vitest';
import { AiRegistry } from '../src/ai/fsm/registry';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import {
    compileScriptGraph, createScriptRunState, stepScriptGraph, destroyScriptGraph,
    fireScriptGraphEvent, type ScriptTickContext,
} from '../src/logic/ScriptGraphRunner';
import { SCRIPT_GRAPH_VERSION, type ScriptGraph, type ScriptGraphEdge, type ScriptGraphNode } from '../src/logic/types';

interface TestCtx { log: string[]; }

/** A registry of verbs whose every effect is visible in `ctx.log`. */
function registry(): { reg: AiRegistry<TestCtx>; evaluations: { n: number } } {
    const reg = new AiRegistry<TestCtx>();
    const evaluations = { n: 0 };

    reg.registerAction('test.say', {
        params: [{ name: 'text', type: 'string' }],
        run: (ctx, _bb, _arg, params) => { ctx.log.push(String(params?.text ?? '')); },
    });
    reg.registerAction('test.spawn', {
        outputs: [{ name: 'entity', type: 'entity' }],
        run: (ctx, _bb, _arg, _params, out) => {
            ctx.log.push('spawn');
            if (out) out.entity = 40 + ctx.log.length;
        },
    });
    reg.registerValue('test.tick', {
        outputs: [{ name: 'n', type: 'number' }],
        evaluate: (_ctx, _bb, _params, out) => { out.n = ++evaluations.n; },
    });
    reg.registerValue('test.add', {
        params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
        outputs: [{ name: 'sum', type: 'number' }],
        evaluate: (_ctx, _bb, params, out) => { out.sum = Number(params.a ?? 0) + Number(params.b ?? 0); },
    });
    reg.registerValue('test.lessThan', {
        params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
        outputs: [{ name: 'result', type: 'bool' }],
        evaluate: (_ctx, _bb, params, out) => { out.result = Number(params.a ?? 0) < Number(params.b ?? 0); },
    });
    return { reg, evaluations };
}

const node = (id: string, kind: string, extra: Partial<ScriptGraphNode> = {}): ScriptGraphNode =>
    ({ id, kind, ...extra });
const edge = (from: string, fromPort: string, to: string, toPort: string): ScriptGraphEdge =>
    ({ id: `${from}.${fromPort}->${to}.${toPort}`, from, fromPort, to, toPort });

function graphOf(nodes: ScriptGraphNode[], edges: ScriptGraphEdge[], variables?: ScriptGraph['variables']): ScriptGraph {
    return { version: SCRIPT_GRAPH_VERSION, nodes, edges, ...(variables ? { variables } : {}) };
}

interface Run {
    log: string[];
    problems: string[];
    tick(dt?: number): void;
    destroy(): void;
    fire(type: string, target?: number, other?: number): void;
    halted(): boolean;
}

function run(graph: ScriptGraph, reg: AiRegistry<TestCtx>, budget?: number): Run {
    const compiled = compileScriptGraph(graph, reg);
    const state = createScriptRunState(compiled);
    const ctx: TestCtx = { log: [] };
    const problems: string[] = [...compiled.problems];
    const tickCtx = (dt: number): ScriptTickContext<TestCtx> => ({
        ctx, bb: new Blackboard(), registry: reg, dt,
        onProblem: (m) => problems.push(m),
        ...(budget === undefined ? {} : { budget }),
    });
    return {
        log: ctx.log,
        problems,
        tick: (dt = 1 / 60) => stepScriptGraph(compiled, state, tickCtx(dt)),
        destroy: () => destroyScriptGraph(compiled, state, tickCtx(0)),
        fire: (type, target = 7, other = 0) => fireScriptGraphEvent(compiled, state, tickCtx(0), type, target, other),
        halted: () => state.halted,
    };
}

describe('exec flows depth-first', () => {
    it('finishes pin 0s whole chain before pin 1 starts', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('seq', 'flow.sequence', { literals: { count: 2 } }),
            node('a1', 'call', { ref: 'test.say', literals: { text: 'a1' } }),
            node('a2', 'call', { ref: 'test.say', literals: { text: 'a2' } }),
            node('b1', 'call', { ref: 'test.say', literals: { text: 'b1' } }),
        ], [
            edge('start', 'then', 'seq', ''),
            edge('seq', '0', 'a1', ''),
            edge('a1', 'then', 'a2', ''),
            edge('seq', '1', 'b1', ''),
        ]);
        const r = run(g, reg);
        r.tick();
        expect(r.log).toEqual(['a1', 'a2', 'b1']);
    });

    it('branches on the value its condition wire carries', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('lt', 'call', { ref: 'test.lessThan', literals: { a: 1, b: 2 } }),
            node('br', 'flow.branch'),
            node('yes', 'call', { ref: 'test.say', literals: { text: 'yes' } }),
            node('no', 'call', { ref: 'test.say', literals: { text: 'no' } }),
        ], [
            edge('start', 'then', 'br', ''),
            edge('lt', 'result', 'br', 'cond'),
            edge('br', 'true', 'yes', ''),
            edge('br', 'false', 'no', ''),
        ]);
        expect(runOnce(g, reg)).toEqual(['yes']);
    });

    it('runs event.start once and event.update every tick', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('upd', 'event.update'),
            node('s', 'call', { ref: 'test.say', literals: { text: 'start' } }),
            node('u', 'call', { ref: 'test.say', literals: { text: 'update' } }),
        ], [edge('start', 'then', 's', ''), edge('upd', 'then', 'u', '')]);
        const r = run(g, reg);
        r.tick();
        r.tick();
        expect(r.log).toEqual(['start', 'update', 'update']);
    });

    it('publishes the frame delta on the update entry', () => {
        const { reg } = registry();
        const g = graphOf([
            node('upd', 'event.update'),
            node('scale', 'call', { ref: 'test.add', literals: { b: 0 } }),
            node('say', 'call', { ref: 'test.say' }),
        ], [
            edge('upd', 'then', 'say', ''),
            edge('upd', 'dt', 'scale', 'a'),
            edge('scale', 'sum', 'say', 'text'),
        ]);
        const r = run(g, reg);
        r.tick(0.25);
        // Not 0: an entry that declares a port and produces nothing is a graph
        // whose every node runs and whose world never moves.
        expect(r.log).toEqual(['0.25']);
    });

    it('runs event.destroy only on teardown', () => {
        const { reg } = registry();
        const g = graphOf([
            node('bye', 'event.destroy'),
            node('s', 'call', { ref: 'test.say', literals: { text: 'bye' } }),
        ], [edge('bye', 'then', 's', '')]);
        const r = run(g, reg);
        r.tick();
        expect(r.log).toEqual([]);
        r.destroy();
        expect(r.log).toEqual(['bye']);
    });
});

describe('data is pulled', () => {
    it('takes the literal when no wire arrives, the wire when one does', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('sum', 'call', { ref: 'test.add', literals: { a: 2, b: 3 } }),
            node('say', 'call', { ref: 'test.say' }),
        ], [edge('start', 'then', 'say', ''), edge('sum', 'sum', 'say', 'text')]);
        expect(runOnce(g, reg)).toEqual(['5']);
    });

    it('evaluates a pure node once per activation of the node reading it', () => {
        const { reg, evaluations } = registry();
        // One `test.tick` feeding BOTH inputs of one add: the author sees one
        // wire leaving it, so both pins must see the same number.
        const g = graphOf([
            node('start', 'event.start'),
            node('t', 'call', { ref: 'test.tick' }),
            node('sum', 'call', { ref: 'test.add' }),
            node('say', 'call', { ref: 'test.say' }),
        ], [
            edge('start', 'then', 'say', ''),
            edge('t', 'n', 'sum', 'a'),
            edge('t', 'n', 'sum', 'b'),
            edge('sum', 'sum', 'say', 'text'),
        ]);
        const r = run(g, reg);
        r.tick();
        expect(evaluations.n).toBe(1);
        expect(r.log).toEqual(['2']);
    });

    it('re-evaluates a pure node on the next activation', () => {
        const { reg, evaluations } = registry();
        const g = graphOf([
            node('upd', 'event.update'),
            node('t', 'call', { ref: 'test.tick' }),
            node('say', 'call', { ref: 'test.say' }),
        ], [edge('upd', 'then', 'say', ''), edge('t', 'n', 'say', 'text')]);
        const r = run(g, reg);
        r.tick();
        r.tick();
        expect(evaluations.n).toBe(2);
        expect(r.log).toEqual(['1', '2']);
    });

    it('reads what an effectful node last handed back', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('sp', 'call', { ref: 'test.spawn' }),
            node('say', 'call', { ref: 'test.say' }),
        ], [
            edge('start', 'then', 'sp', ''),
            edge('sp', 'then', 'say', ''),
            edge('sp', 'entity', 'say', 'text'),
        ]);
        expect(runOnce(g, reg)).toEqual(['spawn', '41']);
    });

    it('publishes who else the event named, so a graph can act on them', () => {
        const { reg } = registry();
        const g = graphOf([
            node('on', 'event.on', { literals: { type: 'trigger_enter' } }),
            node('say', 'call', { ref: 'test.say' }),
        ], [edge('on', 'then', 'say', ''), edge('on', 'other', 'say', 'text')]);
        const r = run(g, reg);
        r.fire('trigger_enter', 3, 99);
        expect(r.log).toEqual(['99']);
    });

    it('publishes the event target on the entry that heard it', () => {
        const { reg } = registry();
        const g = graphOf([
            node('on', 'event.on', { literals: { type: 'click' } }),
            node('say', 'call', { ref: 'test.say' }),
        ], [edge('on', 'then', 'say', ''), edge('on', 'target', 'say', 'text')]);
        const r = run(g, reg);
        r.fire('other');
        expect(r.log).toEqual([]);
        r.fire('click', 12);
        expect(r.log).toEqual(['12']);
    });
});

describe('variables belong to the instance', () => {
    it('starts at the declared default and keeps what was written', () => {
        const { reg } = registry();
        const g = graphOf([
            node('upd', 'event.update'),
            node('get', 'var.get', { literals: { name: 'count' } }),
            node('inc', 'call', { ref: 'test.add', literals: { b: 1 } }),
            node('set', 'var.set', { literals: { name: 'count' } }),
            node('say', 'call', { ref: 'test.say' }),
        ], [
            edge('upd', 'then', 'set', ''),
            edge('get', 'value', 'inc', 'a'),
            edge('inc', 'sum', 'set', 'value'),
            edge('set', 'then', 'say', ''),
            edge('get', 'value', 'say', 'text'),
        ], [{ name: 'count', type: 'number', default: 10 }]);
        const r = run(g, reg);
        r.tick();
        r.tick();
        // `say` reads the variable on its OWN activation, after `set` wrote it.
        expect(r.log).toEqual(['11', '12']);
    });
});

describe('a loop can end, and one that cannot is stopped', () => {
    it('leaves flow.while when its condition goes false', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('i', 'var.get', { literals: { name: 'i' } }),
            node('lt', 'call', { ref: 'test.lessThan', literals: { b: 3 } }),
            node('w', 'flow.while'),
            node('inc', 'call', { ref: 'test.add', literals: { b: 1 } }),
            node('set', 'var.set', { literals: { name: 'i' } }),
            node('body', 'call', { ref: 'test.say', literals: { text: 'x' } }),
            node('done', 'call', { ref: 'test.say', literals: { text: 'done' } }),
        ], [
            edge('start', 'then', 'w', ''),
            edge('i', 'value', 'lt', 'a'),
            edge('lt', 'result', 'w', 'cond'),
            edge('w', 'body', 'body', ''),
            edge('body', 'then', 'set', ''),
            edge('i', 'value', 'inc', 'a'),
            edge('inc', 'sum', 'set', 'value'),
            edge('w', 'done', 'done', ''),
        ], [{ name: 'i', type: 'number', default: 0 }]);
        const r = run(g, reg);
        r.tick();
        expect(r.log).toEqual(['x', 'x', 'x', 'done']);
        expect(r.halted()).toBe(false);
    });

    it('stops the instance at the budget, names the node, and says so once', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('w', 'flow.while', { literals: { cond: true } }),
            node('body', 'call', { ref: 'test.say', literals: { text: 'x' } }),
        ], [
            edge('start', 'then', 'w', ''),
            edge('w', 'body', 'body', ''),
            edge('body', 'then', 'w', ''),
        ]);
        const r = run(g, reg, 20);
        r.tick();
        expect(r.halted()).toBe(true);
        expect(r.problems).toHaveLength(1);
        expect(r.problems[0]).toContain('step budget');
        const after = r.log.length;
        r.tick();
        expect(r.log).toHaveLength(after);
        expect(r.problems).toHaveLength(1);
    });
});

describe('flow.delay waits without blocking the frame', () => {
    it('continues on the tick its time is up', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('d', 'flow.delay', { literals: { seconds: 0.1 } }),
            node('say', 'call', { ref: 'test.say', literals: { text: 'late' } }),
        ], [edge('start', 'then', 'd', ''), edge('d', 'then', 'say', '')]);
        const r = run(g, reg);
        r.tick(0.06);
        expect(r.log).toEqual([]);
        r.tick(0.06);
        expect(r.log).toEqual(['late']);
        r.tick(0.06);
        expect(r.log).toEqual(['late']);
    });
});

describe('a graph that asks for what is not there says so', () => {
    it('reports an unregistered name at compile rather than running past it', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('nope', 'call', { ref: 'test.missing' }),
        ], [edge('start', 'then', 'nope', '')]);
        const r = run(g, reg);
        expect(r.problems.some((p) => p.includes('test.missing'))).toBe(true);
    });

    it('does not run a node whose input wire has no source', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('gone', 'call', { ref: 'test.missing' }),
            node('say', 'call', { ref: 'test.say', literals: { text: 'fallback' } }),
            node('after', 'call', { ref: 'test.say', literals: { text: 'after' } }),
        ], [
            edge('start', 'then', 'say', ''),
            edge('gone', 'n', 'say', 'text'),
            edge('say', 'then', 'after', ''),
        ]);
        const r = run(g, reg);
        r.tick();
        // Not `fallback`: the port's zero is a value nobody authored, and a node
        // that runs on one writes nonsense downstream instead of stopping here.
        expect(r.log).toEqual([]);
        expect(r.problems.some((p) => p.includes('no source'))).toBe(true);
    });

    it('reports a data cycle instead of recursing forever', () => {
        const { reg } = registry();
        const g = graphOf([
            node('start', 'event.start'),
            node('a', 'call', { ref: 'test.add' }),
            node('say', 'call', { ref: 'test.say' }),
        ], [
            edge('start', 'then', 'say', ''),
            edge('a', 'sum', 'a', 'a'),
            edge('a', 'sum', 'say', 'text'),
        ]);
        const r = run(g, reg);
        r.tick();
        expect(r.problems.some((p) => p.includes('cycle'))).toBe(true);
    });
});

function runOnce(g: ScriptGraph, reg: AiRegistry<TestCtx>): string[] {
    const r = run(g, reg);
    r.tick();
    return r.log;
}
