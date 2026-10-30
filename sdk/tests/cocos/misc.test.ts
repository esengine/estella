// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { NodePool, ccenum, js, profiler } from '../../src/cocos/misc';
import type { Node } from '../../src/cocos/node';
import { Graphics, Label, Quat, Sprite, UIRenderer, Vec3 } from '../../src/cocos';

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

describe('profiler', () => {
    it('takes show and hide, and remembers which', () => {
        expect(profiler.isShowingStats()).toBe(false);
        profiler.showStats();
        expect(profiler.isShowingStats()).toBe(true);
        profiler.hideStats();
        expect(profiler.isShowingStats()).toBe(false);
    });
});

describe('UIRenderer', () => {
    it('is the base of what draws a 2D element, and takes the rebuild requests that scripts send', () => {
        for (const type of [Sprite, Label, Graphics]) {
            expect(type.prototype).toBeInstanceOf(UIRenderer);
            expect(typeof type.prototype.markForUpdateRenderData).toBe('function');
        }
        const probe = Object.create(Sprite.prototype) as Sprite;
        expect(() => { probe.markForUpdateRenderData(); probe.markForUpdateRenderData(false); probe.setVertsDirty(); }).not.toThrow();
    });
});

describe('Vec3.transformQuat', () => {
    it('keeps a vector under the identity and turns it by a quarter about Y', () => {
        const forward = new Vec3(0, 0, -1);
        expect(Vec3.transformQuat(new Vec3(), forward, new Quat(0, 0, 0, 1))).toMatchObject({ x: 0, y: 0, z: -1 });
        const s = Math.SQRT1_2;
        const turned = Vec3.transformQuat(new Vec3(), forward, new Quat(0, s, 0, s));
        expect(turned.x).toBeCloseTo(-1, 6);
        expect(turned.y).toBeCloseTo(0, 6);
        expect(turned.z).toBeCloseTo(0, 6);
    });
});
