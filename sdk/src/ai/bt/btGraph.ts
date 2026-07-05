// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    btGraph.ts
 * @brief   Immutable tree operations on a BtDefinition — the editor's model.
 *
 * Pure functions returning new definitions (never mutating), so the tree editor
 * drives them through AssetDocument.edit for free undo, mirroring fsmGraph. Nodes
 * carry an editor-only `id` (the interpreter ignores it); a `.esbt` IS the runtime
 * definition, so there is no compile step. Composite/decorator/leaf capacities are
 * enforced so the graph can only form a valid tree.
 */

import type { BtDefinition, BtNode, BtNodeType } from './types';

export interface BtEdge {
    /** Stable id `from->to`. */
    id: string;
    from: string;
    to: string;
}

const COMPOSITES = new Set<BtNodeType>(['sequence', 'selector', 'parallel']);
const DECORATORS = new Set<BtNodeType>(['inverter', 'succeeder', 'repeater']);

/** Max children a node type accepts: composites unbounded, decorators one, leaves none. */
export function maxChildren(type: BtNodeType): number {
    if (COMPOSITES.has(type)) return Infinity;
    if (DECORATORS.has(type)) return 1;
    return 0; // action, condition, wait
}

export function canHaveChildren(type: BtNodeType): boolean {
    return maxChildren(type) > 0;
}

function clone(def: BtDefinition): BtDefinition {
    return JSON.parse(JSON.stringify(def)) as BtDefinition;
}

function walk(node: BtNode, fn: (n: BtNode) => void): void {
    fn(node);
    for (const c of node.children ?? []) walk(c, fn);
}

function find(node: BtNode, id: string): BtNode | null {
    if (node.id === id) return node;
    for (const c of node.children ?? []) {
        const r = find(c, id);
        if (r) return r;
    }
    return null;
}

function findParent(node: BtNode, id: string): BtNode | null {
    for (const c of node.children ?? []) {
        if (c.id === id) return node;
        const r = findParent(c, id);
        if (r) return r;
    }
    return null;
}

function freshId(def: BtDefinition): string {
    const used = new Set<string>();
    walk(def.root, n => { if (n.id) used.add(n.id); });
    let i = 0;
    let id: string;
    do { id = `n${i++}`; } while (used.has(id));
    return id;
}

/** Assign ids to any node missing one (e.g. a hand-written `.esbt`). Mutates + returns the def. */
export function ensureBtIds(def: BtDefinition): BtDefinition {
    const used = new Set<string>();
    walk(def.root, n => { if (n.id) used.add(n.id); });
    let i = 0;
    const nextId = () => {
        let id: string;
        do { id = `n${i++}`; } while (used.has(id));
        used.add(id);
        return id;
    };
    walk(def.root, n => { if (!n.id) n.id = nextId(); });
    return def;
}

/** A blank tree: a Selector root. */
export function emptyBt(): BtDefinition {
    return { root: { type: 'selector', id: 'n0', x: 60, y: 80, children: [] } };
}

/** All nodes flattened (for the canvas). */
export function btNodes(def: BtDefinition): BtNode[] {
    const out: BtNode[] = [];
    walk(def.root, n => out.push(n));
    return out;
}

/** Parent -> child edges. */
export function btEdges(def: BtDefinition): BtEdge[] {
    const edges: BtEdge[] = [];
    walk(def.root, n => {
        for (const c of n.children ?? []) {
            if (n.id && c.id) edges.push({ id: `${n.id}->${c.id}`, from: n.id, to: c.id });
        }
    });
    return edges;
}

export function addBtChild(def: BtDefinition, parentId: string, type: BtNodeType, x = 0, y = 0): BtDefinition {
    const next = clone(def);
    const parent = find(next.root, parentId);
    if (!parent || (parent.children?.length ?? 0) >= maxChildren(parent.type)) return def;
    const child: BtNode = { type, id: freshId(next), x, y };
    (parent.children ??= []).push(child);
    return next;
}

export function removeBtNode(def: BtDefinition, id: string): BtDefinition {
    if (def.root.id === id) return def; // the root can't be removed
    const next = clone(def);
    const parent = findParent(next.root, id);
    if (!parent?.children) return def;
    parent.children = parent.children.filter(c => c.id !== id);
    return next;
}

export function moveBtNode(def: BtDefinition, id: string, x: number, y: number): BtDefinition {
    const next = clone(def);
    const n = find(next.root, id);
    if (!n) return def;
    n.x = x;
    n.y = y;
    return next;
}

/** Patch a node's fields (type/name/count/policy/seconds). Changing type clamps children to the new capacity. */
export function setBtNodeField(def: BtDefinition, id: string, patch: Partial<BtNode>): BtDefinition {
    const next = clone(def);
    const n = find(next.root, id);
    if (!n) return def;
    Object.assign(n, patch);
    if (patch.type) {
        const max = maxChildren(patch.type);
        if (max === 0) delete n.children;
        else if (n.children && n.children.length > max) n.children = n.children.slice(0, max);
    }
    return next;
}

/**
 * Reparent a subtree under a new parent (canvas drag-to-connect). No-ops on a
 * cycle (new parent is a descendant), a full parent, or the root itself.
 */
export function reparentBtNode(def: BtDefinition, id: string, newParentId: string): BtDefinition {
    if (id === newParentId || def.root.id === id) return def;
    const next = clone(def);
    const node = find(next.root, id);
    const newParent = find(next.root, newParentId);
    if (!node || !newParent) return def;
    if (find(node, newParentId)) return def; // would create a cycle
    if ((newParent.children?.length ?? 0) >= maxChildren(newParent.type)) return def;
    const oldParent = findParent(next.root, id);
    if (oldParent?.children) oldParent.children = oldParent.children.filter(c => c.id !== id);
    (newParent.children ??= []).push(node);
    return next;
}
