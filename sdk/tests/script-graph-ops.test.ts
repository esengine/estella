// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-graph-ops.test.ts
 * @brief   The editor's edits, and the wire rules they enforce.
 *
 * The rules are here rather than in the panel because a hand-written file has to
 * meet the same ones: an input takes one value, an exec pin hands control to one
 * node, and a wire's ends have to agree on what they carry.
 */
import { describe, it, expect } from 'vitest';
import { AiRegistry } from '../src/ai/fsm/registry';
import {
    addScriptNode, moveScriptNode, removeScriptNode, setScriptNodeLiteral,
    canConnectPorts, connectScriptNodes, disconnectScriptInput, removeScriptEdge,
    addScriptVariable, removeScriptVariable, renameScriptVariable,
} from '../src/logic/graphOps';
import { emptyScriptGraph, type ScriptGraph } from '../src/logic/types';
import { describeNode } from '../src/logic/nodes';

function catalog(): AiRegistry<unknown> {
    const reg = new AiRegistry<unknown>();
    reg.registerAction('demo.say', {
        params: [{ name: 'text', type: 'string' }],
        run: () => {},
    });
    reg.registerValue('demo.count', {
        outputs: [{ name: 'n', type: 'number' }],
        evaluate: (_c, _b, _p, out) => { out.n = 1; },
    });
    reg.registerValue('demo.flag', {
        outputs: [{ name: 'on', type: 'bool' }],
        evaluate: (_c, _b, _p, out) => { out.on = true; },
    });
    return reg;
}

/** start → say, with a count feeding the text. */
function scene(): { graph: ScriptGraph; reg: AiRegistry<unknown> } {
    const reg = catalog();
    let graph = emptyScriptGraph('demo');
    graph = addScriptNode(graph, 'event.start', 0, 0).graph;
    graph = addScriptNode(graph, 'call', 200, 0, 'demo.say').graph;
    graph = addScriptNode(graph, 'call', 60, 120, 'demo.count').graph;
    return { graph, reg };
}

describe('adding and removing', () => {
    it('gives each node an id nothing else has', () => {
        let graph = emptyScriptGraph();
        const a = addScriptNode(graph, 'flow.branch', 0, 0);
        graph = a.graph;
        const b = addScriptNode(graph, 'flow.branch', 0, 0);
        expect(b.id).not.toBe(a.id);
        expect(b.graph.nodes).toHaveLength(2);
    });

    it('takes every wire that touched a removed node with it', () => {
        const { graph: g0, reg } = scene();
        let graph = connectScriptNodes(g0, reg, 'event_start_1', 'then', 'demo_say_1', '');
        graph = connectScriptNodes(graph, reg, 'demo_count_1', 'n', 'demo_say_1', 'text');
        expect(graph.edges).toHaveLength(2);

        graph = removeScriptNode(graph, 'demo_say_1');
        expect(graph.edges).toEqual([]);
    });

    it('never mutates the graph it was handed', () => {
        const { graph, reg } = scene();
        const before = JSON.stringify(graph);
        connectScriptNodes(graph, reg, 'event_start_1', 'then', 'demo_say_1', '');
        moveScriptNode(graph, 'demo_say_1', 9, 9);
        removeScriptNode(graph, 'demo_say_1');
        setScriptNodeLiteral(graph, 'demo_say_1', 'text', 'hi');
        expect(JSON.stringify(graph)).toBe(before);
    });
});

describe('the wire rules', () => {
    it('refuses a data wire whose ends disagree', () => {
        const { graph: g0, reg } = scene();
        let graph = addScriptNode(g0, 'call', 60, 240, 'demo.flag').graph;
        graph = addScriptNode(graph, 'flow.branch', 320, 0).graph;

        // A bool into a branch condition is the wire it is for.
        expect(canConnectPorts(graph, reg, 'demo_flag_1', 'on', 'flow_branch_1', 'cond')).toBe(true);
        // A number widens to a bool, a string does not.
        expect(canConnectPorts(graph, reg, 'demo_count_1', 'n', 'flow_branch_1', 'cond')).toBe(true);
        // And an exec pin never meets a data pin.
        expect(canConnectPorts(graph, reg, 'event_start_1', 'then', 'flow_branch_1', 'cond')).toBe(false);
    });

    it('refuses a wire to a port that does not exist', () => {
        const { graph, reg } = scene();
        expect(canConnectPorts(graph, reg, 'demo_count_1', 'nope', 'demo_say_1', 'text')).toBe(false);
        expect(connectScriptNodes(graph, reg, 'demo_count_1', 'nope', 'demo_say_1', 'text').edges).toEqual([]);
    });

    it('refuses a node wired to itself', () => {
        const { graph, reg } = scene();
        expect(canConnectPorts(graph, reg, 'demo_say_1', 'then', 'demo_say_1', '')).toBe(false);
    });

    it('replaces the wire on an input rather than stacking a second one', () => {
        const { graph: g0, reg } = scene();
        let graph = addScriptNode(g0, 'call', 60, 240, 'demo.flag').graph;
        graph = connectScriptNodes(graph, reg, 'demo_count_1', 'n', 'demo_say_1', 'text');
        graph = connectScriptNodes(graph, reg, 'demo_flag_1', 'on', 'demo_say_1', 'text');
        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0].from).toBe('demo_flag_1');
    });

    it('replaces the target of an exec pin rather than forking it', () => {
        const { graph: g0, reg } = scene();
        let graph = addScriptNode(g0, 'flow.branch', 320, 0).graph;
        graph = connectScriptNodes(graph, reg, 'event_start_1', 'then', 'demo_say_1', '');
        graph = connectScriptNodes(graph, reg, 'event_start_1', 'then', 'flow_branch_1', '');
        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0].to).toBe('flow_branch_1');
    });

    it('lets one exec pin per node keep its own target', () => {
        const { graph: g0, reg } = scene();
        let graph = addScriptNode(g0, 'flow.branch', 320, 0).graph;
        graph = addScriptNode(graph, 'call', 500, 120, 'demo.say').graph;
        graph = connectScriptNodes(graph, reg, 'flow_branch_1', 'true', 'demo_say_1', '');
        graph = connectScriptNodes(graph, reg, 'flow_branch_1', 'false', 'demo_say_2', '');
        expect(graph.edges).toHaveLength(2);
    });

    it('cuts one wire without disturbing the rest', () => {
        const { graph: g0, reg } = scene();
        let graph = connectScriptNodes(g0, reg, 'event_start_1', 'then', 'demo_say_1', '');
        graph = connectScriptNodes(graph, reg, 'demo_count_1', 'n', 'demo_say_1', 'text');
        graph = disconnectScriptInput(graph, 'demo_say_1', 'text');
        expect(graph.edges).toHaveLength(1);
        graph = removeScriptEdge(graph, graph.edges[0].id);
        expect(graph.edges).toEqual([]);
    });
});

describe('variables', () => {
    it('renames every node that names it, and refuses a name already taken', () => {
        const reg = catalog();
        let graph = addScriptVariable(emptyScriptGraph(), { name: 'hp', type: 'number', default: 3 });
        graph = addScriptVariable(graph, { name: 'shield', type: 'number' });
        graph = addScriptNode(graph, 'var.get', 0, 0).graph;
        graph = setScriptNodeLiteral(graph, 'var_get_1', 'name', 'hp');

        graph = renameScriptVariable(graph, 'hp', 'health');
        expect(graph.variables?.[0].name).toBe('health');
        expect(graph.nodes[0].literals?.name).toBe('health');
        expect(describeNode(graph.nodes[0], graph, reg)?.outputs[0].type).toBe('number');

        // A collision leaves the graph exactly as it was.
        expect(renameScriptVariable(graph, 'health', 'shield')).toBe(graph);
    });

    it('leaves the nodes behind when the variable goes, typed `any`', () => {
        const reg = catalog();
        let graph = addScriptVariable(emptyScriptGraph(), { name: 'hp', type: 'number' });
        graph = addScriptNode(graph, 'var.get', 0, 0).graph;
        graph = setScriptNodeLiteral(graph, 'var_get_1', 'name', 'hp');

        graph = removeScriptVariable(graph, 'hp');
        expect(graph.nodes).toHaveLength(1);
        expect(describeNode(graph.nodes[0], graph, reg)?.outputs[0].type).toBe('any');
    });
});
