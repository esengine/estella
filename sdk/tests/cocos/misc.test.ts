// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { NodePool, ccenum, js } from '../../src/cocos/misc';
import type { Node } from '../../src/cocos/node';

/** The parts of a node a pool touches. */
function fakeNode(handler?: { unuse(): void; reuse(args: unknown[]): void }) {
    const log: string[] = [];
    const node = {
        removeFromParent: () => log.push('removed'),
        destroy: () => { log.push('destroyed'); return true; },
        getComponent: () => handler ?? null,
    };
    return { node: node as unknown as Node, log };
}

describe('NodePool', () => {
    it('keeps what is put in, hands it back newest first, and says null when empty', () => {
        const pool = new NodePool();
        const a = fakeNode(), b = fakeNode();
        pool.put(a.node);
        pool.put(b.node);
        pool.put(b.node);   // the same node is not kept twice
        expect(pool.size()).toBe(2);
        expect(a.log).toEqual(['removed']);
        expect(pool.get()).toBe(b.node);
        expect(pool.get()).toBe(a.node);
        expect(pool.get()).toBeNull();
    });

    it('tells a handler component it is put away and brought back', () => {
        const calls: string[] = [];
        const handler = { unuse: () => calls.push('unuse'), reuse: (args: unknown[]) => calls.push(`reuse ${args.join(',')}`) };
        const pool = new NodePool('Bullet');
        pool.put(fakeNode(handler).node);
        pool.get(1, 2);
        expect(calls).toEqual(['unuse', 'reuse 1,2']);
    });

    it('destroys what it holds when cleared', () => {
        const pool = new NodePool();
        const a = fakeNode();
        pool.put(a.node);
        pool.clear();
        expect(pool.size()).toBe(0);
        expect(a.log).toContain('destroyed');
    });
});

describe('js and ccenum', () => {
    it('names a class and its instances, and knows a subclass', () => {
        class Base { }
        class Child extends Base { }
        expect(js.getClassName(Child)).toBe('Child');
        expect(js.getClassName(new Child())).toBe('Child');
        expect(js.getClassName(null)).toBe('');
        expect(js.isChildClassOf(Child, Base)).toBe(true);
        expect(js.isChildClassOf(Base, Child)).toBe(false);
        expect(js.getSuper(Child)).toBe(Base);
    });

    it('mixes in everything, or only what is missing', () => {
        expect(js.mixin({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 2, b: 3 });
        expect(js.addon({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 1, b: 3 });
    });

    it('hands an enum back as it is', () => {
        enum Mode { A, B }
        expect(ccenum(Mode)).toBe(Mode);
    });
});
