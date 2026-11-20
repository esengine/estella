// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ScriptGraphRunner.ts
 * @brief   The script-graph interpreter — pure, generic, unit-testable.
 *
 * `compileScriptGraph` indexes a graph once per loaded asset; `stepScriptGraph`
 * advances one instance one tick. Semantics:
 *
 *   · EXEC is pushed. An occasion lights an entry node and the white wire is
 *     walked depth-first, so a `flow.sequence` finishes pin 0's whole chain
 *     before pin 1 starts — the order the picture promises.
 *   · DATA is pulled. An input's value is fetched when the node reading it runs,
 *     by evaluating backwards up the wire.
 *   · A pure node is evaluated AT MOST ONCE per activation of the node reading
 *     it, so one wire feeding two pins of the same node is one value. Across
 *     activations it re-evaluates, which is what makes a `flow.while` condition
 *     able to become false.
 *   · Every activation costs a step, and an instance has a budget per tick. A
 *     graph that loops forever stops, names the node, and stays stopped — the
 *     editor runs the play realm in its own process, so "the author will not
 *     draw that" is not a safety story.
 *   · A `graph.call` runs another graph to completion, synchronously, inside
 *     the caller's step. The callee keeps its OWN frame per call site, spends
 *     the CALLER's budget, and is bounded by a call depth — a graph reached
 *     through a cycle stops rather than taking the stack down with it.
 */

import type { AiOutputs, AiParams, AiParamValue, AiRegistry } from '../ai/fsm/registry';
import { invokeAction } from '../ai/fsm/registry';
import type { Blackboard } from '../ai/fsm/Blackboard';
import { spawnPrepared, type PreparedPrefab } from '../prefab/preparedPrefab';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import {
    describeNode, graphCallRef, isCallableGraph, sequenceCount, spawnPrefabRef, THEN,
    type ScriptNodeShape, type ScriptVerbCatalog,
} from './nodes';
import {
    coerceValue, defaultForType,
    type ScriptGraph, type ScriptGraphNode, type ScriptValue, type ScriptValueType,
} from './types';

/** Node activations one instance may spend in one tick before it is stopped. */
export const DEFAULT_STEP_BUDGET = 4096;

/** How deep `graph.call` may nest. A JS stack frame per level, so this is what
 *  stops a graph that calls itself before the engine's own stack does. */
export const MAX_CALL_DEPTH = 16;

/** A graph indexed for ticking: pins resolved, wires turned into lookups. */
export interface CompiledScriptGraph {
    graph: ScriptGraph;
    nodes: Map<string, ScriptGraphNode>;
    shapes: Map<string, ScriptNodeShape>;
    /** `${nodeId}\0${execPin}` → the node that pin runs. */
    execTargets: Map<string, string>;
    /** `${nodeId}\0${inputPort}` → the output feeding it. */
    dataSources: Map<string, { node: string; port: string }>;
    /** Nodes an input wire reaches for and this build could not make. */
    starvedInputs: Map<string, string[]>;
    starts: string[];
    updates: string[];
    destroys: string[];
    /** Event type → the `event.on` nodes listening for it. */
    events: Map<string, string[]>;
    /** What the graph asked for and this build could not give it. */
    problems: string[];
    /**
     * The prefabs its `entity.spawn` nodes may spawn, by ref. Filled by whoever
     * LOADED the graph — spawning is synchronous, so the loading happened then
     * or it did not happen at all.
     */
    prefabs: Map<string, PreparedPrefab>;
    /** The node a call arrives at, when this graph is one a call can enter. */
    inputNode?: string;
    /** The node a call returns from, where the graph names one. */
    outputNode?: string;
}

const key = (node: string, port: string): string => `${node}\0${port}`;

export function compileScriptGraph(graph: ScriptGraph, catalog: ScriptVerbCatalog): CompiledScriptGraph {
    const nodes = new Map<string, ScriptGraphNode>();
    const shapes = new Map<string, ScriptNodeShape>();
    const problems: string[] = [];
    const starts: string[] = [];
    const updates: string[] = [];
    const destroys: string[] = [];
    const events = new Map<string, string[]>();
    const callable = isCallableGraph(graph);
    let inputNode: string | undefined;
    let outputNode: string | undefined;

    for (const node of graph.nodes) {
        // Two nodes under one id are one node to every lookup here, so the
        // second silently replaces the first and the wires drawn to either land
        // on whichever won. Reported rather than resolved: which one the author
        // meant is not something this can know.
        if (nodes.has(node.id)) {
            problems.push(`node ${node.id}: a second node carries this id`);
            continue;
        }
        nodes.set(node.id, node);
        // A called graph runs inside its caller's step, so no later tick exists
        // for a timer to expire on: waiting is something only a graph an
        // occasion lights can do.
        if (callable && node.kind === 'flow.delay') {
            problems.push(`node ${node.id}: a graph a call enters cannot wait — flow.delay needs a tick of its own`);
            continue;
        }
        // One way in and one way out. A second of either is an ambiguity the
        // caller would have to guess at, so it is a node this build cannot make.
        if (node.kind === 'graph.input' || node.kind === 'graph.output') {
            const taken = node.kind === 'graph.input' ? inputNode : outputNode;
            if (taken) {
                problems.push(`node ${node.id}: a second ${node.kind} — a call has one way in and one way out`);
                continue;
            }
            if (node.kind === 'graph.input') inputNode = node.id; else outputNode = node.id;
        }
        const shape = describeNode(node, graph, catalog);
        if (!shape) {
            problems.push(node.kind === 'call'
                ? `node ${node.id}: no registered name "${node.ref ?? ''}"`
                : node.kind === 'graph.call'
                    ? `node ${node.id}: no graph "${graphCallRef(node)}"`
                    : `node ${node.id}: unknown kind "${node.kind}"`);
            if (node.kind === 'graph.input') inputNode = undefined;
            if (node.kind === 'graph.output') outputNode = undefined;
            continue;
        }
        shapes.set(node.id, shape);
        switch (shape.entry) {
            case 'start': starts.push(node.id); break;
            case 'update': updates.push(node.id); break;
            case 'destroy': destroys.push(node.id); break;
            case 'event': {
                const type = String(node.literals?.type ?? '');
                if (!type) { problems.push(`node ${node.id}: event.on has no type`); break; }
                const list = events.get(type);
                if (list) list.push(node.id); else events.set(type, [node.id]);
                break;
            }
        }
    }

    const execTargets = new Map<string, string>();
    const dataSources = new Map<string, { node: string; port: string }>();
    const starvedInputs = new Map<string, string[]>();
    for (const edge of graph.edges) {
        const from = shapes.get(edge.from);
        const to = shapes.get(edge.to);
        // An input whose source this build could not make is STARVED, not
        // empty: the port's zero is a value nobody authored, and handing it on
        // is how a graph with one unresolved name writes nonsense everywhere
        // downstream instead of stopping at the hole.
        if (!from && to && edge.toPort !== '') {
            const ports = starvedInputs.get(edge.to);
            if (ports) ports.push(edge.toPort); else starvedInputs.set(edge.to, [edge.toPort]);
        }
        if (!from || !to) continue; // the missing node already reported
        if (from.execOut.includes(edge.fromPort)) {
            if (!to.execIn) { problems.push(`edge ${edge.id}: ${edge.to} takes no exec wire`); continue; }
            execTargets.set(key(edge.from, edge.fromPort), edge.to);
            continue;
        }
        const out = from.outputs.find((p) => p.name === edge.fromPort);
        const inp = to.inputs.find((p) => p.name === edge.toPort);
        if (!out || !inp) { problems.push(`edge ${edge.id}: no such port`); continue; }
        dataSources.set(key(edge.to, edge.toPort), { node: edge.from, port: edge.fromPort });
    }

    return {
        graph, nodes, shapes, execTargets, dataSources, starvedInputs,
        starts, updates, destroys, events, problems, prefabs: new Map(),
        ...(inputNode ? { inputNode } : {}),
        ...(outputNode ? { outputNode } : {}),
    };
}

/**
 * One GRAPH's state inside one instance. The entity's own graph has one; so does
 * each `graph.call` site, for the graph it calls — which is what makes a called
 * graph's variables local to the call rather than shared with its caller.
 */
export interface ScriptFrame {
    /** Graph variables, by name. */
    vars: Map<string, ScriptValue>;
    /** `flow.delay` node id → seconds still to wait. */
    timers: Map<string, number>;
    /** What an impure node last handed back, so a wire off it reads that. */
    produced: Map<string, Record<string, ScriptValue>>;
    /** `graph.call` node id → the frame of the graph that call enters. */
    calls: Map<string, ScriptFrame>;
}

/** Per-instance runtime. The component stays serializable; this lives beside it. */
export interface ScriptRunState extends ScriptFrame {
    started: boolean;
    /** Set when the budget blew: the instance is done until something reloads it. */
    halted: boolean;
    /** Problems already reported, so a bad graph does not reprint every frame. */
    reported: Set<string>;
}

/** A frame with this graph's variables at their declared defaults. */
function createFrame(compiled: CompiledScriptGraph): ScriptFrame {
    const vars = new Map<string, ScriptValue>();
    for (const v of compiled.graph.variables ?? []) {
        vars.set(v.name, v.default ?? defaultForType(v.type));
    }
    return { vars, timers: new Map(), produced: new Map(), calls: new Map() };
}

export function createScriptRunState(compiled: CompiledScriptGraph): ScriptRunState {
    return { ...createFrame(compiled), started: false, halted: false, reported: new Set() };
}

/** Everything one tick needs that is not the graph or the instance. */
export interface ScriptTickContext<Ctx> {
    ctx: Ctx;
    bb: Blackboard;
    registry: AiRegistry<Ctx>;
    dt: number;
    /** Reported once per distinct message per instance. */
    onProblem?: (message: string) => void;
    budget?: number;
    /**
     * The world `entity.spawn` spawns into. The runner is generic over its
     * context so the core stays wasm-free; whoever knows the world hands it in.
     */
    world?: World;
    /**
     * The graph a `graph.call` names, resolved when the call runs rather than
     * held on the compiled caller: a graph belongs to the realm that loaded it,
     * and reloading one must not oblige every graph calling it to rebuild.
     */
    resolveGraph?: (ref: string) => CompiledScriptGraph | undefined;
}

/** One walk of the exec wire: the stack of nodes still to activate. */
interface Walk {
    stack: string[];
    /** Shared down a call chain, so a callee spends the caller's budget. */
    spend: { steps: number };
    /** How many calls deep this walk is. */
    depth: number;
}

function newWalk(): Walk {
    return { stack: [], spend: { steps: 0 }, depth: 0 };
}

/**
 * Advance one instance one tick: expire delays, then light `event.update`.
 * `event.start` fires on the first tick, before update, so a graph can seed its
 * variables in the same frame it first runs.
 */
export function stepScriptGraph<Ctx>(
    compiled: CompiledScriptGraph,
    run: ScriptRunState,
    tick: ScriptTickContext<Ctx>,
): void {
    if (run.halted) return;
    const walk = newWalk();

    if (!run.started) {
        run.started = true;
        for (const id of compiled.starts) ignite(compiled, run, run, tick, walk, id);
    }
    resumeDelays(compiled, run, run, tick, walk);
    for (const id of compiled.updates) {
        // The entry PUBLISHES its frame: an output port nothing produces reads
        // as the port's zero, and a graph stepping by a delta of zero never
        // moves while every node in it runs.
        run.produced.set(id, { dt: tick.dt });
        ignite(compiled, run, run, tick, walk, id);
    }
}

/** Run the `event.destroy` entries — the instance's last tick. */
export function destroyScriptGraph<Ctx>(
    compiled: CompiledScriptGraph,
    run: ScriptRunState,
    tick: ScriptTickContext<Ctx>,
): void {
    if (run.halted) return;
    const walk = newWalk();
    for (const id of compiled.destroys) ignite(compiled, run, run, tick, walk, id);
}

/**
 * Light the `event.on` nodes listening for `type`. `target` and `other` are
 * published on the entry's ports, so a wire can carry who the event came from
 * and who else it named; so is each payload field a node declares, read from
 * `payload` and turned to the type it declares (its zero where the event has
 * no such field, or one that is not a plain value).
 */
export function fireScriptGraphEvent<Ctx>(
    compiled: CompiledScriptGraph,
    run: ScriptRunState,
    tick: ScriptTickContext<Ctx>,
    type: string,
    target: number,
    other = 0,
    payload?: Readonly<Record<string, unknown>>,
): void {
    if (run.halted) return;
    const listeners = compiled.events.get(type);
    if (!listeners) return;
    const walk = newWalk();
    for (const id of listeners) {
        const produced: Record<string, ScriptValue> = {};
        for (const port of compiled.shapes.get(id)?.outputs ?? []) {
            const raw = payload?.[port.name];
            const plain = typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string';
            produced[port.name] = plain ? coerceValue(raw, port.type) : defaultForType(port.type);
        }
        produced.target = target;
        produced.other = other;
        run.produced.set(id, produced);
        ignite(compiled, run, run, tick, walk, id);
    }
}

function resumeDelays<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, walk: Walk,
): void {
    if (frame.timers.size === 0) return;
    let due: string[] | null = null;
    for (const [id, left] of frame.timers) {
        const rest = left - tick.dt;
        if (rest > 0) { frame.timers.set(id, rest); continue; }
        (due ??= []).push(id);
    }
    if (!due) return;
    for (const id of due) frame.timers.delete(id);
    for (const id of due) {
        const next = compiled.execTargets.get(key(id, THEN));
        if (next) walkFrom(compiled, frame, run, tick, walk, next);
    }
}

/** Run the chain hanging off an entry node's single exec pin. */
function ignite<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, walk: Walk, entryId: string,
): void {
    const next = compiled.execTargets.get(key(entryId, THEN));
    if (next) walkFrom(compiled, frame, run, tick, walk, next);
}

function walkFrom<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, walk: Walk, first: string,
): void {
    const budget = tick.budget ?? DEFAULT_STEP_BUDGET;
    walk.stack.push(first);
    while (walk.stack.length > 0) {
        if (++walk.spend.steps > budget) {
            run.halted = true;
            problem(run, tick, `step budget (${budget}) exhausted at node ${walk.stack[walk.stack.length - 1]} — stopped`);
            walk.stack.length = 0;
            return;
        }
        const id = walk.stack.pop()!;
        activate(compiled, frame, run, tick, walk, id);
        if (run.halted) { walk.stack.length = 0; return; }
    }
}

/** Run one exec node, pushing whatever it hands control to. */
function activate<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, walk: Walk, id: string,
): void {
    const node = compiled.nodes.get(id);
    const shape = compiled.shapes.get(id);
    if (!node || !shape) return;
    // A node an author wired to something this build could not make does not
    // run at all, and control stops here: whatever it was going to do, it was
    // going to do it with a value nobody wrote.
    const starved = compiled.starvedInputs.get(id);
    if (starved) {
        problem(run, tick, `node ${id}: input "${starved[0]}" has no source — not run`);
        return;
    }
    // One memo per activation: two pins of THIS node fed by one wire see one
    // value; the next activation asks again, which is how a loop condition moves.
    const memo = new Map<string, ScriptValue>();
    const pull = (port: string): ScriptValue =>
        input(compiled, frame, run, tick, node, shape, port, memo, new Set());

    switch (node.kind) {
        case 'flow.branch': {
            const pin = pull('cond') ? 'true' : 'false';
            push(compiled, walk, id, pin);
            return;
        }
        case 'flow.sequence': {
            // Pushed in reverse so pin 0 pops first and its whole chain runs
            // before pin 1 — depth-first is the promise the picture makes.
            for (let i = sequenceCount(node) - 1; i >= 0; i--) push(compiled, walk, id, String(i));
            return;
        }
        case 'flow.while': {
            if (!pull('cond')) { push(compiled, walk, id, 'done'); return; }
            // Self first so it re-tests after the body's chain has run.
            walk.stack.push(id);
            push(compiled, walk, id, 'body');
            return;
        }
        case 'flow.delay': {
            // Re-entering a delay that is already counting leaves it alone: a
            // restart would be a timer that never expires under a fast caller.
            if (frame.timers.has(id)) return;
            const seconds = Number(pull('seconds')) || 0;
            if (seconds > 0) { frame.timers.set(id, seconds); return; }
            push(compiled, walk, id, THEN);
            return;
        }
        case 'var.set': {
            const name = String(node.literals?.name ?? '');
            if (name) frame.vars.set(name, pull('value'));
            push(compiled, walk, id, THEN);
            return;
        }
        case 'entity.spawn': {
            const ref = spawnPrefabRef(node);
            const prepared = compiled.prefabs.get(ref);
            if (!prepared || !tick.world) {
                problem(run, tick, `node ${id}: prefab "${ref}" was not prepared — nothing spawned`);
                push(compiled, walk, id, THEN);
                return;
            }
            const parent = Number(pull('parent')) || undefined;
            const { root } = spawnPrepared(tick.world, prepared, {
                ...(parent === undefined ? {} : { parent: parent as Entity }),
                position: { x: Number(pull('x')) || 0, y: Number(pull('y')) || 0 },
            });
            frame.produced.set(id, { entity: root as number });
            push(compiled, walk, id, THEN);
            return;
        }
        case 'graph.output': {
            // The values the caller reads. Control stops: what runs next is the
            // caller's next node, and the call site is what pushes it.
            const out: Record<string, ScriptValue> = {};
            for (const port of shape.inputs) out[port.name] = pull(port.name);
            frame.produced.set(id, out);
            return;
        }
        case 'graph.call': {
            callGraph(compiled, frame, run, tick, walk, id, shape, pull);
            return;
        }
        case 'call': {
            const ref = node.ref!;
            const params: Record<string, AiParamValue> = {};
            for (const port of shape.inputs) {
                params[port.name] = pull(port.name) as AiParamValue;
            }
            const out: AiOutputs = {};
            invokeAction(tick.registry, ref, tick.ctx, tick.bb, { params: params as AiParams }, out);
            if (shape.outputs.length > 0) frame.produced.set(id, out as Record<string, ScriptValue>);
            push(compiled, walk, id, THEN);
            return;
        }
    }
    // Any other exec node just passes control on.
    push(compiled, walk, id, THEN);
}

/**
 * Run the graph a call names, to completion, inside this step. The callee gets
 * its own frame (kept per call site, so its variables survive between calls the
 * way an entity's graph does) and spends the caller's budget.
 */
function callGraph<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, walk: Walk, id: string,
    shape: ScriptNodeShape, pull: (port: string) => ScriptValue,
): void {
    const ref = graphCallRef(compiled.nodes.get(id)!);
    const callee = tick.resolveGraph?.(ref);
    // Control stops rather than passing on: the next node was going to read
    // outputs nothing produced.
    if (!callee) {
        problem(run, tick, `node ${id}: graph "${ref}" is not loaded — not called`);
        return;
    }
    if (callee.inputNode === undefined) {
        problem(run, tick, `node ${id}: graph "${ref}" has no graph.input — nothing to call`);
        return;
    }
    if (walk.depth >= MAX_CALL_DEPTH) {
        run.halted = true;
        problem(run, tick, `node ${id}: calls nested deeper than ${MAX_CALL_DEPTH} — stopped`);
        return;
    }

    let callee_frame = frame.calls.get(id);
    if (!callee_frame) frame.calls.set(id, (callee_frame = createFrame(callee)));

    // The arguments arrive the way an entry's payload does: published on the
    // node the caller enters at, read back off its ports by whatever is wired.
    const args: Record<string, ScriptValue> = {};
    for (const port of shape.inputs) args[port.name] = pull(port.name);
    callee_frame.produced.set(callee.inputNode, args);

    const inner: Walk = { stack: [], spend: walk.spend, depth: walk.depth + 1 };
    ignite(callee, callee_frame, run, tick, inner, callee.inputNode);
    if (run.halted) return;

    frame.produced.set(id, callee.outputNode === undefined
        ? {}
        : { ...(callee_frame.produced.get(callee.outputNode) ?? {}) });
    push(compiled, walk, id, THEN);
}

function push(compiled: CompiledScriptGraph, walk: Walk, from: string, pin: string): void {
    const next = compiled.execTargets.get(key(from, pin));
    if (next) walk.stack.push(next);
}

/** The value arriving at one input port: the wire if there is one, else the literal. */
function input<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, node: ScriptGraphNode, shape: ScriptNodeShape, port: string,
    memo: Map<string, ScriptValue>, pulling: Set<string>,
): ScriptValue {
    const type = shape.inputs.find((p) => p.name === port)?.type ?? 'any';
    const source = compiled.dataSources.get(key(node.id, port));
    if (!source) {
        const literal = node.literals?.[port];
        return literal === undefined ? defaultForType(type) : coerceValue(literal, type);
    }
    return coerceValue(output(compiled, frame, run, tick, source.node, source.port, memo, pulling), type);
}

/** The value on one output port, evaluating the pure node behind it if needed. */
function output<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, id: string, port: string,
    memo: Map<string, ScriptValue>, pulling: Set<string>,
): ScriptValue {
    const node = compiled.nodes.get(id);
    const shape = compiled.shapes.get(id);
    if (!node || !shape) return null;
    const type: ScriptValueType = shape.outputs.find((p) => p.name === port)?.type ?? 'any';

    if (!shape.pure) {
        // An entry or an effectful node: read what it last handed back. Before it
        // has run there is nothing, and the port's zero is the honest answer.
        const produced = frame.produced.get(id);
        const value = produced?.[port];
        return value === undefined ? defaultForType(type) : value;
    }

    const cell = key(id, port);
    const seen = memo.get(cell);
    if (seen !== undefined) return seen;
    if (pulling.has(id)) {
        problem(run, tick, `node ${id}: data wires form a cycle`);
        return defaultForType(type);
    }
    pulling.add(id);
    const value = evaluatePure(compiled, frame, run, tick, node, shape, memo, pulling);
    pulling.delete(id);
    // Every output of the node is memoised, not just the one asked for: they came
    // out of one evaluation and must not disagree.
    for (const p of shape.outputs) memo.set(key(id, p.name), value[p.name] ?? defaultForType(p.type));
    return memo.get(cell) ?? defaultForType(type);
}

function evaluatePure<Ctx>(
    compiled: CompiledScriptGraph, frame: ScriptFrame, run: ScriptRunState,
    tick: ScriptTickContext<Ctx>, node: ScriptGraphNode, shape: ScriptNodeShape,
    memo: Map<string, ScriptValue>, pulling: Set<string>,
): Record<string, ScriptValue> {
    switch (node.kind) {
        case 'var.get': {
            const name = String(node.literals?.name ?? '');
            const value = frame.vars.get(name);
            return { value: value === undefined ? defaultForType(shape.outputs[0]?.type ?? 'any') : value };
        }
        case 'lit.number':
        case 'lit.bool':
        case 'lit.string': {
            const type = shape.outputs[0]?.type ?? 'any';
            const raw = node.literals?.value;
            return { value: raw === undefined ? defaultForType(type) : coerceValue(raw, type) };
        }
        case 'call': {
            const params: Record<string, AiParamValue> = {};
            for (const port of shape.inputs) {
                params[port.name] = input(
                    compiled, frame, run, tick, node, shape, port.name, memo, pulling,
                ) as AiParamValue;
            }
            const out: AiOutputs = {};
            invokeAction(tick.registry, node.ref!, tick.ctx, tick.bb, { params: params as AiParams }, out);
            return out as Record<string, ScriptValue>;
        }
    }
    return {};
}

function problem<Ctx>(run: ScriptRunState, tick: ScriptTickContext<Ctx>, message: string): void {
    if (run.reported.has(message)) return;
    run.reported.add(message);
    tick.onProblem?.(message);
}
