// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/misc.ts
 * @brief   Small parts of `cc` that need no engine behind them: `ccenum`, the `js` helpers and `NodePool`.
 */
import type { Component } from './component';
import type { Node } from './node';
import { classInfoNamed, classInfoOf } from './registry';

/** `ccenum(MyEnum)`: Cocos marks an enum so its inspector shows a dropdown. The layer's `@property` reads a TypeScript enum as it is. */
export function ccenum<T extends object>(enumObject: T): T {
    return enumObject;
}

/** The parts of `cc.js` scripts call: class names and lookup, and the property helpers. */
export const js = {
    /** The name a class or an instance's class goes by: the `@ccclass` name when it has one, else its own. */
    getClassName(objOrCtor: unknown): string {
        if (objOrCtor === null || objOrCtor === undefined) return '';
        const ctor = typeof objOrCtor === 'function' ? objOrCtor : (objOrCtor as { constructor?: Function }).constructor;
        if (!ctor) return '';
        return classInfoOf(ctor)?.name ?? ctor.name ?? '';
    },
    /** A script class by the name it was declared under. */
    getClassByName(name: string): Function | undefined {
        return classInfoNamed(name)?.ctor;
    },
    getSuper(ctor: Function): Function | undefined {
        const proto = Object.getPrototypeOf(ctor.prototype);
        return proto && proto.constructor !== Object ? proto.constructor : undefined;
    },
    isChildClassOf(subclass: Function | undefined, superclass: Function | undefined): boolean {
        if (!subclass || !superclass) return false;
        if (subclass === superclass) return true;
        for (let c: Function | undefined = js.getSuper(subclass); c; c = js.getSuper(c)) if (c === superclass) return true;
        return false;
    },
    /** Copy the properties of the sources onto the target, replacing what it has. */
    mixin<T extends object>(target: T, ...sources: object[]): T {
        for (const source of sources) for (const key of Object.getOwnPropertyNames(source)) {
            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            if (descriptor) Object.defineProperty(target, key, descriptor);
        }
        return target;
    },
    /** Copy the properties of the sources the target does not have. */
    addon<T extends object>(target: T, ...sources: object[]): T {
        for (const source of sources) for (const key of Object.getOwnPropertyNames(source)) {
            if (key in target) continue;
            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            if (descriptor) Object.defineProperty(target, key, descriptor);
        }
        return target;
    },
    value(object: object, name: string, value: unknown, writable = false, enumerable = false): void {
        Object.defineProperty(object, name, { value, writable, enumerable, configurable: true });
    },
    get(object: object, name: string, getter: () => unknown, enumerable = false): void {
        Object.defineProperty(object, name, { get: getter, enumerable, configurable: true });
    },
    getset(object: object, name: string, getter: () => unknown, setter?: (value: unknown) => void, enumerable = false): void {
        Object.defineProperty(object, name, { get: getter, set: setter, enumerable, configurable: true });
    },
};

/**
 * `NodePool`: nodes kept to be used again. `put` takes a node out of the scene and keeps it; `get` hands one back (or null when none is
 * kept). A node whose pool names a handler component is told `unuse()` as it goes in and `reuse(...args)` as it comes out.
 */
export class NodePool {
    private readonly nodes_: Node[] = [];

    constructor(private readonly handler_?: string | (abstract new () => Component)) {}

    size(): number {
        return this.nodes_.length;
    }

    clear(): void {
        for (const node of this.nodes_.splice(0)) node.destroy();
    }

    put(node: Node): void {
        if (!node || this.nodes_.includes(node)) return;
        node.removeFromParent();
        this.handler(node)?.unuse?.();
        this.nodes_.push(node);
    }

    get(...args: unknown[]): Node | null {
        const node = this.nodes_.pop() ?? null;
        if (node) this.handler(node)?.reuse?.(args);
        return node;
    }

    private handler(node: Node): { unuse?(): void; reuse?(args: unknown[]): void } | null {
        if (!this.handler_) return null;
        return node.getComponent(this.handler_ as never) as unknown as { unuse?(): void; reuse?(args: unknown[]): void } | null;
    }
}

/**
 * `profiler`: the engine's on-screen statistics panel. Showing it is the editor's profiler and the host's overlay here, not a node a script
 * owns, so the calls are accepted and the state is only remembered for `isShowingStats`.
 */
let showingStats = false;
export const profiler = {
    showStats(): void { showingStats = true; },
    hideStats(): void { showingStats = false; },
    isShowingStats(): boolean { return showingStats; },
    generateNode(): void { /* the panel is not a node here */ },
};
