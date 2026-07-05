// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    emptyBt, ensureBtIds, btNodes, btEdges, maxChildren, canHaveChildren,
    addBtChild, removeBtNode, moveBtNode, setBtNodeField, reparentBtNode,
} from '../src/ai/bt/btGraph';
import type { BtDefinition } from '../src/ai/bt/types';

describe('btGraph', () => {
    it('reports child capacity per node type', () => {
        expect(maxChildren('selector')).toBe(Infinity);
        expect(maxChildren('inverter')).toBe(1);
        expect(maxChildren('action')).toBe(0);
        expect(canHaveChildren('sequence')).toBe(true);
        expect(canHaveChildren('wait')).toBe(false);
    });

    it('assigns ids to a hand-written tree', () => {
        const def: BtDefinition = { root: { type: 'sequence', children: [{ type: 'action', name: 'go' }] } };
        ensureBtIds(def);
        const ids = btNodes(def).map(n => n.id);
        expect(ids.every(Boolean)).toBe(true);
        expect(new Set(ids).size).toBe(2); // unique
    });

    it('adds children up to capacity, not mutating the input', () => {
        const a = emptyBt();
        const b = addBtChild(a, 'n0', 'action', 100, 40);
        expect(a.root.children).toHaveLength(0); // input untouched
        expect(b.root.children).toHaveLength(1);
        // A decorator accepts one child, then no more.
        let d = addBtChild(emptyBt(), 'n0', 'inverter');
        const invId = d.root.children![0].id!;
        d = addBtChild(d, invId, 'action');
        expect(find(d, invId)?.children).toHaveLength(1);
        const blocked = addBtChild(d, invId, 'condition');
        expect(blocked).toBe(d); // full decorator → no-op (same ref)
    });

    it('removes a subtree but never the root', () => {
        let def = emptyBt();
        def = addBtChild(def, 'n0', 'sequence');
        const seqId = def.root.children![0].id!;
        def = addBtChild(def, seqId, 'action');
        def = removeBtNode(def, seqId);
        expect(def.root.children).toHaveLength(0);
        expect(removeBtNode(def, 'n0')).toBe(def); // root remove → no-op
    });

    it('moves a node', () => {
        const def = moveBtNode(emptyBt(), 'n0', 250, 120);
        expect(def.root).toMatchObject({ x: 250, y: 120 });
    });

    it('patches fields and clamps children when the type loses capacity', () => {
        let def = emptyBt(); // selector root
        def = addBtChild(def, 'n0', 'action');
        def = addBtChild(def, 'n0', 'action');
        expect(def.root.children).toHaveLength(2);
        // selector -> inverter (max 1) truncates to one child
        def = setBtNodeField(def, 'n0', { type: 'inverter' });
        expect(def.root.children).toHaveLength(1);
        // -> action (leaf) drops children entirely
        def = setBtNodeField(def, 'n0', { type: 'action', name: 'x' });
        expect(def.root.children).toBeUndefined();
        expect(def.root.name).toBe('x');
    });

    it('reparentBtNodes a subtree, rejecting cycles and full parents', () => {
        let def = emptyBt();
        def = addBtChild(def, 'n0', 'sequence'); // n0 -> seq
        const seqId = def.root.children![0].id!;
        def = addBtChild(def, 'n0', 'inverter'); // n0 -> inv
        const invId = def.root.children![1].id!;

        // Move seq under inv.
        def = reparentBtNode(def, seqId, invId);
        expect(btEdges(def).map(e => e.id).sort()).toEqual([`${invId}->${seqId}`, `n0->${invId}`].sort());

        // Cycle: making n0 a child of its descendant seq is rejected.
        expect(reparentBtNode(def, 'n0', seqId)).toBe(def);
        // inv is full (already has seq) → another reparentBtNode into it is a no-op.
        def = addBtChild(def, seqId, 'action');
        const actId = find(def, seqId)!.children![0].id!;
        expect(reparentBtNode(def, actId, invId)).toBe(def);
    });

    it('flattens edges as parent->child', () => {
        let def = emptyBt();
        def = addBtChild(def, 'n0', 'action');
        def = addBtChild(def, 'n0', 'condition');
        const edges = btEdges(def);
        expect(edges).toHaveLength(2);
        expect(edges.every(e => e.from === 'n0')).toBe(true);
    });
});

// Local helper mirroring btGraph's private find, for assertions.
function find(def: BtDefinition, id: string): import('../src/ai/bt/types').BtNode | null {
    const stack = [def.root];
    while (stack.length) {
        const n = stack.pop()!;
        if (n.id === id) return n;
        for (const c of n.children ?? []) stack.push(c);
    }
    return null;
}
