// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  procGraph.ts — a rules graph as a node editor changes it: wires, nodes, order.
 *
 *        A source written by hand leaves most inputs out (a node works on the one before it). A canvas draws wires, so
 *        before one is shown every node is given an id and every left-out input is written out; after that a wire is
 *        a field and nothing depends on where a node sits in the list. A node whose wire was taken off has `input: null`
 *        (nothing feeds it, which the run refuses) rather than no input at all (which would mean the node before it).
 *        Wiring a node into one written before it reorders the list so every node still comes after what it reads, and
 *        a wire that would close a loop is refused. Everything here is pure: each call answers a new list.
 */
import { PROC_OPS, ProcBuildError, type ProcNode } from './procSource';

const isSource = (op: string): boolean => Boolean(PROC_OPS[op]?.source);
const isMany = (op: string): boolean => Boolean(PROC_OPS[op]?.many);

/** The ids a node reads, in order (a node wired to nothing reads none). */
export function procInputsOf(node: ProcNode): string[] {
    if (isMany(node.op)) return (node.inputs ?? []).filter((x): x is string => typeof x === 'string');
    return typeof node.input === 'string' ? [node.input] : [];
}

/** A short id for a new node of @p op that no node in @p nodes has. */
export function freshProcId(nodes: readonly ProcNode[], op: string): string {
    const taken = new Set(nodes.map((n) => n.id));
    for (let k = 1; ; k++) if (!taken.has(`${op}${k}`)) return `${op}${k}`;
}

/**
 * Every node with an id and every input written out: what a canvas can draw. In a component the first node's left-out
 * input is the component's own plot, "in".
 */
export function explicitProc(nodes: readonly ProcNode[], inComponent = false): ProcNode[] {
    const out: ProcNode[] = [];
    for (const raw of nodes) {
        const node: ProcNode = { ...raw };
        if (!node.id) node.id = freshProcId([...nodes, ...out], node.op);
        if (!isSource(node.op) && !isMany(node.op) && node.input === undefined) {
            const prev = out[out.length - 1];
            node.input = prev ? prev.id! : inComponent ? 'in' : null as unknown as string;
        }
        if (node.op === 'repeat' && Array.isArray(node.chain)) node.chain = explicitProc(node.chain as ProcNode[], true);
        out.push(node);
    }
    return out;
}

/**
 * The same nodes in an order where each comes after every node it reads, as close to the order given as that allows.
 * Throws when the wires make a loop.
 */
export function sortProc(nodes: readonly ProcNode[], outside: ReadonlySet<string> = new Set(['in'])): ProcNode[] {
    const byId = new Map(nodes.map((n) => [n.id!, n]));
    const done = new Set<string>(), visiting = new Set<string>(), out: ProcNode[] = [];
    const visit = (n: ProcNode): void => {
        if (done.has(n.id!)) return;
        if (visiting.has(n.id!)) throw new ProcBuildError(`the wires make a loop through "${n.id}"`, n.id ?? null, n.op);
        visiting.add(n.id!);
        for (const ref of procInputsOf(n)) {
            const dep = byId.get(ref);
            if (dep) visit(dep);
            else if (!outside.has(ref)) continue;
        }
        visiting.delete(n.id!);
        done.add(n.id!);
        out.push(n);
    };
    for (const n of nodes) visit(n);
    return out;
}

/**
 * Wires @p from into @p to: its single input, or slot @p slot of a node that takes several (a slot past the last adds
 * one). Answers the reordered list; throws when the wire would close a loop or the node takes no input.
 */
export function connectProc(nodes: readonly ProcNode[], from: string, to: string, slot = 0): ProcNode[] {
    if (from === to) throw new ProcBuildError('a node cannot read itself', to);
    const next = nodes.map((n) => (n.id === to ? { ...n } : n));
    const node = next.find((n) => n.id === to);
    if (!node) throw new ProcBuildError(`there is no node "${to}"`, to);
    if (isSource(node.op)) throw new ProcBuildError(`${node.op} makes plots of its own and takes no input`, to, node.op);
    if (isMany(node.op)) {
        const list = [...(node.inputs ?? [])];
        if (slot >= list.length) list.push(from); else list[slot] = from;
        node.inputs = list.filter((v, i) => list.indexOf(v) === i);
    } else {
        node.input = from;
    }
    return sortProc(next);
}

/** Takes the wire off input @p slot of @p to (a many-input node loses that slot; a single input is left `null`). */
export function disconnectProc(nodes: readonly ProcNode[], to: string, slot = 0): ProcNode[] {
    return nodes.map((n) => {
        if (n.id !== to) return n;
        if (isMany(n.op)) return { ...n, inputs: (n.inputs ?? []).filter((_, i) => i !== slot) };
        return { ...n, input: null as unknown as string };
    });
}

/** Removes @p id; every wire out of it is taken off what it fed. */
export function removeProcNode(nodes: readonly ProcNode[], id: string): ProcNode[] {
    return nodes.filter((n) => n.id !== id).map((n) => {
        if (isMany(n.op) && (n.inputs ?? []).includes(id)) return { ...n, inputs: n.inputs!.filter((x) => x !== id) };
        if (n.input === id) return { ...n, input: null as unknown as string };
        return n;
    });
}

/** The fields a new node of @p op starts with: enough to run, so it shows something as soon as it is wired. */
export const PROC_NODE_DEFAULTS: Record<string, Record<string, unknown>> = {
    rect: { at: [0, 0], size: [100, 100] },
    plots: { items: [{ at: [0, 0], size: [20, 20] }] },
    ring: { at: [0, 0], radius: 100, count: 8, size: [10, 10] },
    line: { points: [[0, 0], [100, 0]], width: 10 },
    grid: { cols: 3, rows: 3, gap: 4 },
    split: { axis: 'x', count: 2 },
    inset: { by: 2 },
    quarter: { street: 6 },
    subdivide: { max: 30, gap: 2 },
    edges: { thick: 4 },
    scatter: { count: 5, size: [4, 4] },
    move: { by: [0, 0] },
    resize: {},
    lift: { by: 1 },
    ground: { mode: 'min' },
    attr: { set: {} },
    retag: { add: [] },
    filter: {},
    merge: { inputs: [] },
    repeat: { count: 2, chain: [] },
    use: { component: '' },
    box: { height: 4, color: '#cccccc' },
    roof: { pitch: 28, overhang: 1, color: '#45464c' },
    part: { at: [0, 0, 0], size: [1, 1, 1], color: '#cccccc' },
    beam: { from: [0, 0, 0], to: [0, 10, 0], thick: 1, color: '#cccccc' },
    output: { inputs: [] },
};

/** A new node of @p op at (@p x, @p y), unwired: what the add menu puts down. */
export function addProcNode(nodes: readonly ProcNode[], op: string, x: number, y: number): { nodes: ProcNode[]; id: string } {
    if (!PROC_OPS[op]) throw new ProcBuildError(`there is no op "${op}"`);
    const id = freshProcId(nodes, op);
    const node: ProcNode = { id, op, ...JSON.parse(JSON.stringify(PROC_NODE_DEFAULTS[op] ?? {})), x: Math.round(x), y: Math.round(y) };
    if (!isSource(op) && !isMany(op)) node.input = null as unknown as string;
    return { nodes: [...nodes, node], id };
}
