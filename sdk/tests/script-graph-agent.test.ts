// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-graph-agent.test.ts
 * @brief   A graph attached to an entity: it ticks, it reaches the world through
 *          the shared context, it tears down when the entity leaves, and the
 *          schedule can be told what it touches before it has run.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Entity } from '../src/types';
import type { CommandsInstance } from '../src/ecs/commands';
import { aiRegistry, registerAction } from '../src/ai/fsm/AiContext';
import { defineComponent } from '../src/ecs/component';
import {
    ScriptGraphAgent, registerScriptGraph, clearScriptGraphStore,
} from '../src/logic/ScriptGraphAgent';
import {
    stepScriptGraphs, scriptGraphLeaves, ScriptGraphs, type ScriptGraphWorldView,
} from '../src/logic/ScriptGraphPlugin';
import { ensureBuiltinScriptNodes } from '../src/logic/builtinNodes';
import { SCRIPT_GRAPH_VERSION, type ScriptGraph } from '../src/logic/types';
import { scriptCatalog } from '../src/logic/nodes';
import { compileScriptGraph } from '../src/logic/ScriptGraphRunner';

interface HealthData { value: number }
const Health = defineComponent<HealthData>('TestHealth', { value: 0 });

/** Minimal in-memory world satisfying what stepScriptGraphs calls. */
class FakeWorld implements ScriptGraphWorldView {
    private store = new Map<string, unknown>();
    private next = 1;
    private entities: Entity[] = [];

    spawn(graph: string, health = 0): Entity {
        const e = this.next++ as Entity;
        this.store.set(`${e}:ScriptGraphAgent`, ScriptGraphAgent.create({ graph }));
        this.store.set(`${e}:TestHealth`, Health.create({ value: health }));
        this.entities.push(e);
        return e;
    }
    despawn(entity: Entity): void {
        this.entities = this.entities.filter((e) => e !== entity);
    }
    getEntitiesWithComponents(): Entity[] { return this.entities; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(entity: Entity, component: { _name: string }): any {
        return this.store.get(`${entity}:${component._name}`);
    }
    set(entity: Entity, component: { _name: string }, data: unknown): void {
        this.store.set(`${entity}:${component._name}`, data);
    }
    has(entity: Entity, component: { _name: string }): boolean {
        return this.store.has(`${entity}:${component._name}`);
    }
}

const NO_COMMANDS = {} as CommandsInstance;

const graph = (nodes: ScriptGraph['nodes'], edges: ScriptGraph['edges'], variables?: ScriptGraph['variables']): ScriptGraph =>
    ({ version: SCRIPT_GRAPH_VERSION, nodes, edges, ...(variables ? { variables } : {}) });

const wire = (from: string, fromPort: string, to: string, toPort: string) =>
    ({ id: `${from}.${fromPort}->${to}.${toPort}`, from, fromPort, to, toPort });

describe('a graph on an entity', () => {
    let log: string[];

    beforeEach(() => {
        aiRegistry.clear();
        clearScriptGraphStore();
        ensureBuiltinScriptNodes();
        log = [];
        registerAction('test.note', {
            params: [{ name: 'text', type: 'string' }],
            touches: { reads: ['TestHealth'] },
            run: (ctx, _bb, _arg, params) => { log.push(`${params?.text}:${ctx.entity}`); },
        });
    });

    it('ticks each agent with its own entity in the context', () => {
        registerScriptGraph('note', graph(
            [
                { id: 'u', kind: 'event.update' },
                { id: 'n', kind: 'call', ref: 'test.note', literals: { text: 'hi' } },
            ],
            [wire('u', 'then', 'n', '')],
        ));
        const world = new FakeWorld();
        const a = world.spawn('note');
        const b = world.spawn('note');

        stepScriptGraphs(world, NO_COMMANDS, 0.1, new Map());
        expect(log).toEqual([`hi:${a}`, `hi:${b}`]);
    });

    it('reads the entity it is attached to, through the shared context', () => {
        registerScriptGraph('read', graph(
            [
                { id: 'u', kind: 'event.update' },
                { id: 'p', kind: 'call', ref: 'property.get', literals: { path: 'TestHealth.value' } },
                { id: 'n', kind: 'call', ref: 'test.note' },
            ],
            [wire('u', 'then', 'n', ''), wire('p', 'value', 'n', 'text')],
        ));
        const world = new FakeWorld();
        const e = world.spawn('read', 42);

        stepScriptGraphs(world, NO_COMMANDS, 0.1, new Map());
        expect(log).toEqual([`42:${e}`]);
    });

    it('keeps one instance of state per entity', () => {
        registerScriptGraph('count', graph(
            [
                { id: 'u', kind: 'event.update' },
                { id: 'g', kind: 'var.get', literals: { name: 'n' } },
                { id: 'a', kind: 'call', ref: 'math.add', literals: { b: 1 } },
                { id: 's', kind: 'var.set', literals: { name: 'n' } },
                { id: 'note', kind: 'call', ref: 'test.note' },
            ],
            [
                wire('u', 'then', 's', ''),
                wire('g', 'value', 'a', 'a'),
                wire('a', 'result', 's', 'value'),
                wire('s', 'then', 'note', ''),
                wire('g', 'value', 'note', 'text'),
            ],
            [{ name: 'n', type: 'number', default: 0 }],
        ));
        const world = new FakeWorld();
        const a = world.spawn('count');
        const b = world.spawn('count');
        const states = new Map();

        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        expect(log).toEqual([`1:${a}`, `1:${b}`, `2:${a}`, `2:${b}`]);
    });

    it('runs event.destroy the tick the entity drops out of the query', () => {
        registerScriptGraph('bye', graph(
            [
                { id: 'd', kind: 'event.destroy' },
                { id: 'n', kind: 'call', ref: 'test.note', literals: { text: 'bye' } },
            ],
            [wire('d', 'then', 'n', '')],
        ));
        const world = new FakeWorld();
        const e = world.spawn('bye');
        const states = new Map();

        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        expect(log).toEqual([]);

        world.despawn(e);
        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        expect(log).toEqual([`bye:${e}`]);
        expect(states.size).toBe(0);

        // …and only once: the state is gone, so a later tick has nothing to end.
        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        expect(log).toEqual([`bye:${e}`]);
    });

    it('rebuilds the instance when the agent is pointed at another graph', () => {
        registerScriptGraph('one', graph(
            [{ id: 'u', kind: 'event.start' }, { id: 'n', kind: 'call', ref: 'test.note', literals: { text: 'one' } }],
            [wire('u', 'then', 'n', '')],
        ));
        registerScriptGraph('two', graph(
            [{ id: 'u', kind: 'event.start' }, { id: 'n', kind: 'call', ref: 'test.note', literals: { text: 'two' } }],
            [wire('u', 'then', 'n', '')],
        ));
        const world = new FakeWorld();
        const e = world.spawn('one');
        const states = new Map();

        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        world.set(e, ScriptGraphAgent, { graph: 'two' });
        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        expect(log).toEqual([`one:${e}`, `two:${e}`]);
    });

    it('reports a graph that names something unregistered, once', () => {
        registerScriptGraph('broken', graph(
            [{ id: 'u', kind: 'event.update' }, { id: 'n', kind: 'call', ref: 'nope.missing' }],
            [wire('u', 'then', 'n', '')],
        ));
        const world = new FakeWorld();
        world.spawn('broken');
        const problems: string[] = [];
        const states = new Map();

        stepScriptGraphs(world, NO_COMMANDS, 0.1, states, undefined, (_e, m) => problems.push(m));
        stepScriptGraphs(world, NO_COMMANDS, 0.1, states, undefined, (_e, m) => problems.push(m));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('nope.missing');
    });
});

describe('what the system reaches for comes from the graphs, not the system', () => {
    beforeEach(() => {
        aiRegistry.clear();
        clearScriptGraphStore();
        registerAction('test.hit', { touches: { writes: ['TestHealth'] }, run: () => {} });
    });

    it('names one leaf per call node', () => {
        const compiled = compileScriptGraph(graph(
            [
                { id: 'u', kind: 'event.update' },
                { id: 'a', kind: 'call', ref: 'test.hit' },
                { id: 'b', kind: 'flow.branch' },
            ],
            [],
        ), scriptCatalog(aiRegistry));
        expect([...scriptGraphLeaves(compiled)]).toEqual([{ kind: 'action', name: 'test.hit' }]);
    });
});

describe('the ScriptGraphs resource', () => {
    beforeEach(() => {
        aiRegistry.clear();
        clearScriptGraphStore();
        ensureBuiltinScriptNodes();
    });

    it('hands a running graph its input and reads a variable back', () => {
        registerScriptGraph('vars', graph(
            [
                { id: 'u', kind: 'event.update' },
                { id: 'g', kind: 'var.get', literals: { name: 'in' } },
                { id: 's', kind: 'var.set', literals: { name: 'out' } },
            ],
            [wire('u', 'then', 's', ''), wire('g', 'value', 's', 'value')],
            [{ name: 'in', type: 'number', default: 1 }, { name: 'out', type: 'number', default: 0 }],
        ));
        const world = new FakeWorld();
        const e = world.spawn('vars');
        const states = new Map();
        const api = new ScriptGraphs(states);

        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        expect(api.variable(e, 'out')).toBe(1);

        api.setVariable(e, 'in', 9);
        stepScriptGraphs(world, NO_COMMANDS, 0.1, states);
        expect(api.variable(e, 'out')).toBe(9);
        expect(api.halted(e)).toBe(false);
    });
});
