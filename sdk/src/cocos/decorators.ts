// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/decorators.ts
 * @brief   `@ccclass`, `@property` and the rest of Cocos's `_decorator` namespace.
 *
 * The scripts are written with TypeScript's legacy (experimental) decorators, which run when the class is defined: each
 * `@property` records a field on the class, and `@ccclass` — which runs last — declares the class (host.ts). Everything else in
 * the namespace configures the Cocos editor and is accepted and ignored, because a script that names it must still load.
 */
import { Component } from './component';
import { Color, Vec2, Vec3 } from './math';
import { Node } from './node';
import { isAssetClass } from './assets';
import { declareClass, type RawPropertySpec } from './host';
import type { PropertyKind } from './registry';

/** The numeric and string marker types Cocos offers for `@property({ type: ... })`. */
export class CCInteger {}
export class CCFloat {}
export class CCString {}
export class CCBoolean {}

const ENUM_TAG = Symbol('cocos.enum');

/** An enum object, tagged so a `@property({ type: MyEnum })` is known to be a number. TypeScript's own `enum` works unchanged. */
export function Enum<T extends object>(obj: T): T {
    Object.defineProperty(obj, ENUM_TAG, { value: true, enumerable: false });
    return obj;
}

/** What a `@property` type argument names. Undefined when it is not one this layer recognises, so the field's value decides. */
function kindOfType(type: unknown): PropertyKind | undefined {
    if (type === undefined || type === null) return undefined;
    if (type === Node) return 'node';
    if (type === Number || type === CCInteger || type === CCFloat) return 'number';
    if (type === String || type === CCString) return 'string';
    if (type === Boolean || type === CCBoolean) return 'boolean';
    if (type === Vec2) return 'vec2';
    if (type === Vec3) return 'vec3';
    if (type === Color) return 'color';
    if (isAssetClass(type)) return 'asset';
    if (typeof type === 'function' && (type === Component || type.prototype instanceof Component)) return 'component';
    if (typeof type === 'object' && (type as Record<symbol, unknown>)[ENUM_TAG]) return 'number';
    // A TypeScript enum that was not wrapped: an object whose values are numbers.
    if (typeof type === 'object') return 'number';
    return 'json';
}

const recorded = new WeakMap<Function, Map<string, RawPropertySpec>>();

function record(ctor: Function, spec: RawPropertySpec): void {
    let fields = recorded.get(ctor);
    if (!fields) recorded.set(ctor, (fields = new Map()));
    fields.set(spec.name, spec);
}

/** The properties of a class, base classes first, a subclass's declaration of a name replacing its base's. */
function propertiesOf(ctor: Function): RawPropertySpec[] {
    const chain: Function[] = [];
    for (let c: Function | null = ctor; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) chain.unshift(c);
    const merged = new Map<string, RawPropertySpec>();
    for (const c of chain) for (const [name, spec] of recorded.get(c) ?? []) merged.set(name, spec);
    return [...merged.values()];
}

interface PropertyOptions {
    type?: unknown;
    visible?: unknown;
    displayName?: string;
    tooltip?: string;
    [key: string]: unknown;
}

function specFor(name: string, options: PropertyOptions | unknown[] | Function | undefined): RawPropertySpec {
    let type: unknown;
    let array = false;
    if (Array.isArray(options)) { type = options[0]; array = true; }
    else if (typeof options === 'function') type = options;
    else if (options && typeof options === 'object') {
        const t = (options as PropertyOptions).type;
        if (Array.isArray(t)) { type = t[0]; array = true; } else type = t;
    }
    const kind = kindOfType(type);
    return { name, ...(kind ? { kind } : {}), ...(type !== undefined ? { type } : {}), ...(array ? { array } : {}) };
}

/**
 * `@property`, in every form a script writes it: bare, with a type (`@property(Node)`), with options (`@property({ type: Label })`),
 * or with a list (`@property([Node])`).
 */
export function property(...args: unknown[]): any {
    // Bare: `@property` is the decorator itself, called with (prototype, key).
    if (args.length >= 2 && typeof args[1] === 'string' && args[0] && typeof args[0] === 'object') {
        record((args[0] as object).constructor, specFor(args[1], undefined));
        return undefined;
    }
    const options = args[0] as PropertyOptions | unknown[] | Function | undefined;
    return (target: object, key: string): void => { record(target.constructor, specFor(key, options)); };
}

/** `@ccclass('Name')` or bare `@ccclass`: declare the class, under its own name if none is given. */
export function ccclass(arg?: string | Function): any {
    const declare = (ctor: Function, name?: string): void => {
        declareClass(ctor as never, name || ctor.name, propertiesOf(ctor));
    };
    if (typeof arg === 'function') { declare(arg); return undefined; }
    return (ctor: Function): void => declare(ctor, arg);
}

/** The editor-only decorators: accepted so a script that uses them loads, and otherwise without effect here. */
function inert(..._args: unknown[]): any {
    return (..._inner: unknown[]): void => {};
}

/** A decorator that is applied bare (`@executeInEditMode`) or as a call (`@menu('x')`), and does nothing either way. */
function inertEither(...args: unknown[]): any {
    if (args.length >= 1 && typeof args[0] === 'function' && args.length === 1) return undefined;
    return inert();
}

export const requireComponent = inert;
export const executionOrder = inert;
export const menu = inert;
export const help = inert;
export const icon = inert;
export const inspector = inert;
export const playOnFocus = inertEither;
export const executeInEditMode = inertEither;
export const disallowMultiple = inertEither;
export const type = (t: unknown) => (target: object, key: string): void => { record(target.constructor, specFor(key, { type: t })); };
export const integer = (target: object, key: string): void => { record(target.constructor, { name: key, kind: 'number' }); };
export const float = integer;
export const string = (target: object, key: string): void => { record(target.constructor, { name: key, kind: 'string' }); };
export const boolean = (target: object, key: string): void => { record(target.constructor, { name: key, kind: 'boolean' }); };

/** Cocos exposes these under `_decorator`; scripts import the namespace and write `@_decorator.ccclass`, or destructure it. */
export const _decorator = {
    ccclass, property, requireComponent, executionOrder, menu, help, icon, inspector, playOnFocus, executeInEditMode, disallowMultiple,
    type, integer, float, string, boolean,
};
