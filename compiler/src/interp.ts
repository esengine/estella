// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    interp.ts
 * @brief   A reference interpreter for EIR-high.
 *
 * @details Written before any code generation, for two reasons. It proves the IR
 *          means something on its own, and it is the third implementation a
 *          differential test needs: when compiled output and node disagree, an
 *          oracle that is neither says which one is wrong.
 *
 *          Deliberately dumb — a tree walk with no caching. Its job is to be
 *          obviously correct, not fast; anything clever here would be a second
 *          place for a bug to hide from the backend it exists to check.
 */
import { exact } from '../../sdk/src/math/exact';
import type { EirFn, EirSystem, Expr, Place, QueryArg, Stmt } from './eir';

/** The module's pure functions, threaded rather than held in a module global. */
export type Fns = ReadonlyMap<string, EirFn>;

/** One component instance, nested exactly as a system reads it. */
export type Row = Record<string, unknown>;

/**
 * How a system reaches the world. Two implementations: the JS-object host below,
 * and the ABI host (abi.ts) that reads flat memory through a SysCtx. One
 * interpreter over both is what proves the ABI is sufficient — a second
 * evaluator would only prove the two evaluators agree.
 */
export interface EirHost {
    /** Rows the query matches, each binding one opaque base per component. */
    rows(args: readonly QueryArg[]): Iterable<{ entity: number; binds: readonly unknown[] }>;
    readField(base: unknown, comp: string, path: readonly string[]): number | boolean;
    writeField(base: unknown, comp: string, path: readonly string[], v: number | boolean): void;
    /** An opaque base for a resource, addressed by field like a component. */
    resource(name: string): unknown;
    /**
     * `resource.method(key)`. The two hosts answer it differently and that is
     * the point: one calls the live object, the other reads the bit a host
     * mirrored the answer into. Agreeing is what the differential proves.
     */
    service(resource: string, method: string, key: string | number): boolean;
    /** `channel` is the parameter appended to: the command queue, or one
     *  event's writer. Two queues, and a record means nothing without it. */
    emit(channel: string, record: string, args: readonly (number | boolean)[]): void;
    /** Called once after the body, where the SDK's runner flushes. */
    flush(): void;
}

export interface EirWorld {
    /** Entity ids in the order a query walks them. Mutable: a flush removes from it. */
    entities: number[];
    /** component name -> entity -> its row. An absent entity simply has none. */
    readonly comps: ReadonlyMap<string, Map<number, Row>>;
    readonly resources: ReadonlyMap<string, Row>;
    /** event name -> this frame's payloads, which is what a reader walks. */
    readonly events?: ReadonlyMap<string, readonly Row[]>;
    /** event name -> what systems SENT, in field order. Written by a flush. */
    sent?: Map<string, unknown[]>;
}

/** One appended record, waiting for the flush at system end. */
interface Command {
    readonly channel: string;
    readonly record: string;
    readonly args: readonly unknown[];
}

class Frame {
    private readonly slots = new Map<number, unknown>();
    set(id: number, v: unknown): void { this.slots.set(id, v); }
    get(id: number): unknown {
        if (!this.slots.has(id)) throw new Error(`EIR: local %${id} read before it was bound`);
        return this.slots.get(id);
    }
}

function walk(root: unknown, path: readonly string[]): { owner: Record<string, unknown>; key: string } {
    let cur = root as Record<string, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
        const next = cur[path[i]!];
        if (next === null || typeof next !== 'object') {
            throw new Error(`EIR: '${path.slice(0, i + 1).join('.')}' is not a value with fields`);
        }
        cur = next as Record<string, unknown>;
    }
    return { owner: cur, key: path[path.length - 1]! };
}

/** The component or resource a local holds, for the host to resolve fields on. */
type Owners = ReadonlyMap<number, string>;

function readPlace(p: Place, frame: Frame, host: EirHost, owners: Owners): unknown {
    if (p.p === 'local') return frame.get(p.id);
    const base = readPlace(p.base, frame, host, owners);
    const id = p.base.p === 'local' ? p.base.id : -1;
    return host.readField(base, owners.get(id) ?? '', p.path);
}

function writePlace(p: Place, frame: Frame, host: EirHost, owners: Owners, value: unknown): void {
    if (p.p === 'local') { frame.set(p.id, value); return; }
    const base = readPlace(p.base, frame, host, owners);
    const id = p.base.p === 'local' ? p.base.id : -1;
    host.writeField(base, owners.get(id) ?? '', p.path, value as number | boolean);
}

/** A pure function cannot see the world, so calling one needs only its own frame. */
function evalExpr(e: Expr, frame: Frame, fns: Fns, host: EirHost, owners: Owners): number | boolean {
    switch (e.e) {
        case 'const': return e.value;
        case 'read': return readPlace(e.place, frame, host, owners) as number | boolean;
        case 'neg': return -(evalExpr(e.v, frame, fns, host, owners) as number);
        case 'not': return !(evalExpr(e.v, frame, fns, host, owners) as boolean);
        case 'select':
            return evalExpr(e.cond, frame, fns, host, owners) ? evalExpr(e.then, frame, fns, host, owners) : evalExpr(e.otherwise, frame, fns, host, owners);
        case 'svc': {
            const owner = owners.get((e.base as { id: number }).id);
            if (!owner) throw new Error(`EIR: '${e.method}' called on an unbound receiver`);
            return host.service(owner, e.method, e.key);
        }
        case 'call': {
            const a = e.args.map((x) => evalExpr(x, frame, fns, host, owners));
            if (e.target.k === 'math') {
                // The engine's own for the ones ECMAScript leaves open, and the
                // host's Math for the rest — which is the same split the C side
                // makes, and the reason the two agree.
                const own = (exact as unknown as Record<string, ((x: number) => number) | undefined>)[e.target.fn];
                if (own) return own(a[0] as number);
                const fn = (Math as unknown as Record<string, (...xs: number[]) => number>)[e.target.fn]!;
                return fn(...(a as number[]));
            }
            const def = fns.get(e.target.name);
            if (!def) throw new Error(`EIR: no function '${e.target.name}'`);
            const inner = new Frame();
            def.params.forEach((p, i) => inner.set(p.id, a[i]));
            const out = exec(def.body, inner, fns, host, owners);
            // A module function's body is one `return <expr>`; the control-flow
            // exits belong to a system and cannot reach here.
            if (typeof out !== 'number' && typeof out !== 'boolean') {
                throw new Error(`EIR: '${def.name}' returned nothing`);
            }
            return out;
        }
        case 'logic': {
            // Short-circuit, which is why this is not a `bin`: `a && b(…)` must
            // not evaluate b when a is false.
            const l = evalExpr(e.l, frame, fns, host, owners) as boolean;
            if (e.op === '&&') return l ? (evalExpr(e.r, frame, fns, host, owners) as boolean) : false;
            return l ? true : (evalExpr(e.r, frame, fns, host, owners) as boolean);
        }
        case 'bin': {
            const l = evalExpr(e.l, frame, fns, host, owners) as number;
            const r = evalExpr(e.r, frame, fns, host, owners) as number;
            switch (e.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return l / r;
                case '%': return l % r;
                case '<': return l < r;
                case '<=': return l <= r;
                case '>': return l > r;
                case '>=': return l >= r;
                case '==': return l === r;
                case '!=': return l !== r;
            }
        }
    }
}

/** Entities carrying every component the query names, in world order. */
/** Rows the query matches, from the host. */
/**
 * How a block ended. A value is a module function returning one; the three
 * symbols are control flow, and only a row loop consumes two of them — anything
 * else passes them up, which is what makes `continue` inside an `if` work.
 */
const LEFT = Symbol('return');
const NEXT_ROW = Symbol('continue');
const NO_MORE_ROWS = Symbol('break');

type Exit = number | boolean | undefined | typeof LEFT | typeof NEXT_ROW | typeof NO_MORE_ROWS;

function exec(
    stmts: readonly Stmt[], frame: Frame, fns: Fns, host: EirHost, owners: Owners,
): Exit {
    for (const s of stmts) {
        switch (s.s) {
            case 'return':
                return s.value === null ? LEFT : evalExpr(s.value, frame, fns, host, owners);
            case 'continue': return NEXT_ROW;
            case 'break': return NO_MORE_ROWS;
            case 'let':
                frame.set(s.id, evalExpr(s.value, frame, fns, host, owners));
                break;
            case 'assign':
                writePlace(s.target, frame, host, owners, evalExpr(s.value, frame, fns, host, owners));
                break;
            case 'emit': {
                const channel = owners.get((s.channel as { id: number }).id);
                if (!channel) throw new Error('EIR: emit to an unbound channel');
                host.emit(channel, s.record, s.args.map((a) => evalExpr(a, frame, fns, host, owners)));
                break;
            }
            case 'if': {
                const out = evalExpr(s.cond, frame, fns, host, owners)
                    ? exec(s.then, frame, fns, host, owners)
                    : exec(s.otherwise, frame, fns, host, owners);
                if (out !== undefined) return out;
                break;
            }
            case 'rowLoop': {
                const q = readPlace(s.query, frame, host, owners) as { args: readonly QueryArg[] };
                for (const row of host.rows(q.args)) {
                    if (s.entity !== null) frame.set(s.entity, row.entity);
                    s.binds.forEach((id, i) => frame.set(id, row.binds[i]));
                    const out = exec(s.body, frame, fns, host, owners);
                    if (out === NEXT_ROW || out === undefined) continue;
                    if (out === NO_MORE_ROWS) break;
                    return out;
                }
                break;
            }
        }
    }
    return undefined;
}

/** Which component or resource each local names, so the host can resolve fields. */
function ownersOf(sys: EirSystem): Map<number, string> {
    const out = new Map<number, string>();
    for (const l of [...sys.params, ...sys.locals]) {
        // Channels and readers are named too: an emit says WHICH queue, and a
        // reader's rows come from the event it names.
        if (l.type.k === 'comp' || l.type.k === 'res' || l.type.k === 'channel'
            || l.type.k === 'events') out.set(l.id, l.type.name);
    }
    return out;
}

/**
 * Run `sys` against `host`. Parameters are bound from their declared types, the
 * two things the SDK's runner also resolves, and the host flushes at the end
 * because that is where flushSystem_ does.
 */
export function runSystemOn(sys: EirSystem, host: EirHost, fns: Fns = new Map()): void {
    const frame = new Frame();
    const owners = ownersOf(sys);
    for (const p of sys.params) {
        if (p.type.k === 'query') frame.set(p.id, { args: p.type.args });
        else if (p.type.k === 'res') frame.set(p.id, host.resource(p.type.name));
        else if (p.type.k === 'channel') frame.set(p.id, null);
        // A reader is walked exactly like a one-component query, and the host
        // decides whether those rows come from entities or from a queue.
        else if (p.type.k === 'events') {
            frame.set(p.id, { args: [{ comp: p.type.name, mut: false }] });
        }
        else throw new Error(`EIR: '${p.name}' has no parameter binding for ${p.type.k}`);
    }
    exec(sys.body, frame, fns, host, owners);
    host.flush();
}

/**
 * The JS-object host: components are nested records, as a test builds them.
 * Kept because it is what makes the differential readable; the ABI host in
 * abi.ts is the one that proves the contract.
 */
export function jsHost(world: EirWorld): EirHost {
    const queued: Command[] = [];
    return {
        *rows(args) {
            // An event reader is one "component" that is an EVENT: its rows are
            // this frame's payloads, and no entity carries them.
            const only = args.length === 1 ? args[0]!.comp : null;
            const payloads = only === null ? undefined : world.events?.get(only);
            if (payloads) {
                for (const p of payloads) yield { entity: 0, binds: [p] };
                return;
            }
            for (const e of world.entities) {
                if (!args.every((a) => world.comps.get(a.comp)?.has(e))) continue;
                yield { entity: e, binds: args.map((a) => world.comps.get(a.comp)!.get(e)!) };
            }
        },
        readField(base, _comp, path) {
            const { owner, key } = walk(base, path);
            return owner[key] as number | boolean;
        },
        writeField(base, _comp, path, v) {
            const { owner, key } = walk(base, path);
            owner[key] = v;
        },
        resource(name) {
            const row = world.resources.get(name);
            if (!row) throw new Error(`EIR: no resource '${name}' in the world`);
            return row;
        },
        service(name, method, key) {
            // Over live objects there is nothing to mirror: ask the service.
            const row = world.resources.get(name) as Record<string, unknown> | undefined;
            const fn = row?.[method];
            if (typeof fn !== 'function') throw new Error(`EIR: resource '${name}' has no method '${method}'`);
            return (fn as (k: unknown) => unknown).call(row, key) === true;
        },
        emit(channel, record, args) {
            queued.push({ channel, record, args });
        },
        flush() {
            for (const c of queued) {
                if (c.record === 'send') {
                    // Delivered where a reader would find them NEXT frame, which
                    // is what the SDK's double-buffered bus does.
                    const out = world.sent ?? new Map<string, unknown[]>();
                    if (!world.sent) (world as { sent?: Map<string, unknown[]> }).sent = out;
                    const list = out.get(c.channel) ?? [];
                    list.push(c.args);
                    out.set(c.channel, list);
                    continue;
                }
                if (c.record !== 'despawn') throw new Error(`EIR: no flush for '${c.record}'`);
                const e = c.args[0] as number;
                const at = world.entities.indexOf(e);
                if (at >= 0) world.entities.splice(at, 1);
                for (const rows of world.comps.values()) rows.delete(e);
            }
            queued.length = 0;
        },
    };
}

/** Run against a JS-object world. Shorthand for runSystemOn(sys, jsHost(world)). */
export function runSystem(sys: EirSystem, world: EirWorld, fns: Fns = new Map()): void {
    runSystemOn(sys, jsHost(world), fns);
}
