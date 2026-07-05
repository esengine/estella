// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    btGraph.ts
 * @brief   Immutable tree operations on a BtDefinition — the editor's model.
 *
 * Pure functions returning new definitions (never mutating), so the tree editor
 * drives them through AssetDocument.edit for free undo, mirroring fsmGraph. The
 * editor model is a forest: the run tree (`root`) plus `orphans` — unconnected
 * nodes/subtrees the interpreter ignores. Dragging a parent's handle to an
 * orphan reparents it into the tree. Nodes carry an editor-only `id`/`x`/`y`
 * that the interpreter ignores; a `.esbt` IS the runtime definition (no compile).
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

/** All top-level trees: the run root plus every orphan. */
function roots(def: BtDefinition): BtNode[] {
    return def.orphans ? [def.root, ...def.orphans] : [def.root];
}

function walkNode(node: BtNode, fn: (n: BtNode) => void): void {
    fn(node);
    for (const c of node.children ?? []) walkNode(c, fn);
}

function walk(def: BtDefinition, fn: (n: BtNode) => void): void {
    for (const r of roots(def)) walkNode(r, fn);
}

/** Find a node anywhere in the forest. */
function find(def: BtDefinition, id: string): BtNode | null {
    for (const r of roots(def)) {
        const hit = findInSubtree(r, id);
        if (hit) return hit;
    }
    return null;
}

function findInSubtree(node: BtNode, id: string): BtNode | null {
    if (node.id === id) return node;
    for (const c of node.children ?? []) {
        const hit = findInSubtree(c, id);
        if (hit) return hit;
    }
    return null;
}

/** Find a node's parent, or null if it is a top-level root (run root or an orphan root). */
function findParent(def: BtDefinition, id: string): BtNode | null {
    for (const r of roots(def)) {
        const p = findParentInSubtree(r, id);
        if (p) return p;
    }
    return null;
}

function findParentInSubtree(node: BtNode, id: string): BtNode | null {
    for (const c of node.children ?? []) {
        if (c.id === id) return node;
        const p = findParentInSubtree(c, id);
        if (p) return p;
    }
    return null;
}

function isOrphanRoot(def: BtDefinition, id: string): boolean {
    return def.orphans?.some(o => o.id === id) ?? false;
}

function freshId(def: BtDefinition): string {
    const used = new Set<string>();
    walk(def, n => { if (n.id) used.add(n.id); });
    let i = 0;
    let id: string;
    do { id = `n${i++}`; } while (used.has(id));
    return id;
}

/** Assign ids to any node missing one (e.g. a hand-written `.esbt`). Mutates + returns the def. */
export function ensureBtIds(def: BtDefinition): BtDefinition {
    const used = new Set<string>();
    walk(def, n => { if (n.id) used.add(n.id); });
    let i = 0;
    const nextId = () => {
        let id: string;
        do { id = `n${i++}`; } while (used.has(id));
        used.add(id);
        return id;
    };
    walk(def, n => { if (!n.id) n.id = nextId(); });
    return def;
}

/** A blank tree: a Selector root. */
export function emptyBt(): BtDefinition {
    return { root: { type: 'selector', id: 'n0', x: 60, y: 80, children: [] } };
}

/** All nodes flattened (run tree + orphans), for the canvas. */
export function btNodes(def: BtDefinition): BtNode[] {
    const out: BtNode[] = [];
    walk(def, n => out.push(n));
    return out;
}

/** Parent -> child edges across the run tree and every orphan subtree. */
export function btEdges(def: BtDefinition): BtEdge[] {
    const edges: BtEdge[] = [];
    walk(def, n => {
        for (const c of n.children ?? []) {
            if (n.id && c.id) edges.push({ id: `${n.id}->${c.id}`, from: n.id, to: c.id });
        }
    });
    return edges;
}

export function addBtChild(def: BtDefinition, parentId: string, type: BtNodeType, x = 0, y = 0): BtDefinition {
    const next = clone(def);
    const parent = find(next, parentId);
    if (!parent || (parent.children?.length ?? 0) >= maxChildren(parent.type)) return def;
    const child: BtNode = { type, id: freshId(next), x, y };
    (parent.children ??= []).push(child);
    return next;
}

/** Add an unconnected node to the editor's orphan pool (not ticked until wired under root). */
export function addBtOrphan(def: BtDefinition, type: BtNodeType, x = 0, y = 0): BtDefinition {
    const next = clone(def);
    const node: BtNode = { type, id: freshId(next), x, y };
    (next.orphans ??= []).push(node);
    return next;
}

export function removeBtNode(def: BtDefinition, id: string): BtDefinition {
    if (def.root.id === id) return def; // the run root can't be removed
    const next = clone(def);
    if (isOrphanRoot(next, id)) {
        // Set to undefined (not `delete`) so an Object.assign apply in the editor
        // overwrites a stale orphans array instead of leaving it in place.
        const rest = (next.orphans ?? []).filter(o => o.id !== id);
        next.orphans = rest.length ? rest : undefined;
        return next;
    }
    const parent = findParent(next, id);
    if (!parent?.children) return def;
    parent.children = parent.children.filter(c => c.id !== id);
    return next;
}

export function moveBtNode(def: BtDefinition, id: string, x: number, y: number): BtDefinition {
    const next = clone(def);
    const n = find(next, id);
    if (!n) return def;
    n.x = x;
    n.y = y;
    return next;
}

/** Patch a node's fields (type/name/count/policy/seconds). Changing type clamps children to the new capacity. */
export function setBtNodeField(def: BtDefinition, id: string, patch: Partial<BtNode>): BtDefinition {
    const next = clone(def);
    const n = find(next, id);
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
 * Reparent a subtree under a new parent (canvas drag-to-connect) — moves it out
 * of the orphan pool or from its current parent. No-ops on a cycle (new parent
 * is a descendant), a full parent, or the run root itself.
 */
export function reparentBtNode(def: BtDefinition, id: string, newParentId: string): BtDefinition {
    if (id === newParentId || def.root.id === id) return def;
    const next = clone(def);
    const node = find(next, id);
    const newParent = find(next, newParentId);
    if (!node || !newParent) return def;
    if (findInSubtree(node, newParentId)) return def; // would create a cycle
    if ((newParent.children?.length ?? 0) >= maxChildren(newParent.type)) return def;

    // Detach from wherever it currently lives. Set orphans to undefined (not
    // `delete`) when emptied so an Object.assign apply overwrites the stale array.
    if (isOrphanRoot(next, id)) {
        const rest = (next.orphans ?? []).filter(o => o.id !== id);
        next.orphans = rest.length ? rest : undefined;
    } else {
        const oldParent = findParent(next, id);
        if (!oldParent?.children) return def;
        oldParent.children = oldParent.children.filter(c => c.id !== id);
    }
    (newParent.children ??= []).push(node);
    return next;
}
