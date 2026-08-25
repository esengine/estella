// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    abi.ts
 * @brief   The Estella ABI, as an EirHost (docs/REARCH_AOT_ABI.md).
 *
 * @details Runs a system with nothing but what SysCtx provides: a packed row
 *          array, resource pointers, a command buffer, and shared linear memory
 *          at EHT offsets. It calls the engine ZERO times, because the contract
 *          has no calls to make.
 *
 *          Its job is not speed — it is proof. Running the SAME interpreter over
 *          this host and over the JS-object one, and requiring both to match
 *          node, is what shows the contract is SUFFICIENT. A system that cannot
 *          run here names something SysCtx is missing, and that is the only
 *          legitimate reason to add a field to it.
 *
 *          Field offsets come from PTR_LAYOUTS via builtins.ts — the same EHT
 *          table the engine and the SDK's accessors already agree on.
 */
import { ehtStamp } from './builtins';
import type { CompShape, EirSystem, EirType, QueryArg } from './eir';
import { runSystemOn, type EirHost, type Fns } from './interp';

/** One command record: 16 bytes, four u32 (docs/REARCH_AOT_ABI.md §2.3). */
export const CMD_WORDS = 4;
export const CMD_DESPAWN = 1;
export const CMD_REMOVE = 2;

/**
 * Words in `SysCtx` and in `QueryRows` (docs/REARCH_AOT_ABI.md §2.1, §2.2).
 * Exported because three things count them — this host, the code generator and
 * the handshake hash — and a field count with three authors is the drift this
 * file prevents. §6.3 makes the first a number that needs a reason to grow.
 */
export const SYSCTX_WORDS = 6;
export const QUERYROWS_WORDS = 2;

/**
 * Where a field lives, and HOW WIDE it is. Component bytes are f32 because EHT
 * says the C++ structs are; a resource is a host-side record and `Time.delta` is
 * an f64 — packing it as f32 makes one side multiply by a rounded 1/30 and the
 * two drift apart. Width is part of the contract, not an implementation detail.
 */
export interface Leaf {
    readonly byteOffset: number;
    readonly bits: 32 | 64;
    readonly type: EirType;
}

export interface FieldOffsets {
    /** `position.x` -> its leaf. */
    readonly leaves: ReadonlyMap<string, Leaf>;
    /** Bytes per row. */
    readonly stride: number;
}

export interface AbiLayout {
    readonly comps: ReadonlyMap<string, FieldOffsets>;
    readonly resources: ReadonlyMap<string, FieldOffsets>;
}

/**
 * A flat image of a world, laid out the way the host would lay it out. Test
 * scaffolding: the real host is C++, and this stands in for it so the contract
 * can be exercised before the engine implements it.
 */
export class AbiMemory {
    readonly buffer: ArrayBuffer;
    readonly f32: Float32Array;
    readonly f64: Float64Array;
    readonly u32: Uint32Array;
    private next = 64;
    private readonly compBase = new Map<string, Map<number, number>>();
    private readonly resBase = new Map<string, number>();
    /** Entities in world order, as the host would materialise them. */
    readonly entities: number[] = [];
    readonly cmdBuf: number;
    readonly cmdCap = 256;
    /** The per-call arena's high-water mark; see `beginCall`. */
    private scratchNext: number;

    constructor(private readonly layout: AbiLayout, bytes = 1 << 20) {
        this.buffer = new ArrayBuffer(bytes);
        this.f32 = new Float32Array(this.buffer);
        this.f64 = new Float64Array(this.buffer);
        this.u32 = new Uint32Array(this.buffer);
        this.scratchNext = bytes;
        this.cmdBuf = this.alloc(this.cmdCap * CMD_WORDS * 4);
    }

    private alloc(size: number): number {
        const at = this.next;
        this.next += (size + 15) & ~15;
        if (this.next > this.scratchNext) throw new Error('ABI image out of memory');
        return at;
    }

    /**
     * Reset the arena the host refills each call. §2.2 gives row arrays and the
     * SysCtx a one-call lifetime, and a region thrown away each time ENFORCES
     * that rather than restating it. It grows down from the end of the image
     * while world data grows up, so an overlap is caught by `alloc`, not silent.
     */
    beginCall(): void {
        this.scratchNext = this.buffer.byteLength;
    }

    /** One block of the per-call arena. */
    scratch(size: number): number {
        this.scratchNext -= (size + 15) & ~15;
        if (this.scratchNext < this.next) throw new Error('ABI image out of memory');
        return this.scratchNext;
    }

    /** Give `entity` a row of `comp`, returning its base address. */
    addComponent(comp: string, entity: number, fields: Record<string, number | boolean>): number {
        const shape = this.layout.comps.get(comp);
        if (!shape) throw new Error(`ABI: no layout for component '${comp}'`);
        if (!this.entities.includes(entity)) this.entities.push(entity);
        const base = this.alloc(shape.stride);
        let rows = this.compBase.get(comp);
        if (!rows) { rows = new Map(); this.compBase.set(comp, rows); }
        rows.set(entity, base);
        for (const [path, v] of Object.entries(fields)) this.writeLeaf(shape, base, path, v);
        return base;
    }

    addResource(name: string, fields: Record<string, number | boolean>): number {
        const shape = this.layout.resources.get(name);
        if (!shape) throw new Error(`ABI: no layout for resource '${name}'`);
        const base = this.alloc(shape.stride);
        this.resBase.set(name, base);
        for (const [path, v] of Object.entries(fields)) this.writeLeaf(shape, base, path, v);
        return base;
    }

    private writeLeaf(shape: FieldOffsets, base: number, path: string, v: number | boolean): void {
        const leaf = shape.leaves.get(path);
        if (!leaf) throw new Error(`ABI: no field '${path}'`);
        store(this, base + leaf.byteOffset, leaf.bits, v);
    }

    baseOf(comp: string, entity: number): number | undefined {
        return this.compBase.get(comp)?.get(entity);
    }

    resourceBase(name: string): number {
        const at = this.resBase.get(name);
        if (at === undefined) throw new Error(`ABI: no resource '${name}'`);
        return at;
    }

    /** Read a leaf back, for a test to check what the run produced. */
    read(comp: string, entity: number, path: string): number {
        const shape = this.layout.comps.get(comp)!;
        const leaf = shape.leaves.get(path)!;
        return load(this, this.baseOf(comp, entity)! + leaf.byteOffset, leaf.bits);
    }

    /** Drop an entity, as the host's flush would. */
    despawn(entity: number): void {
        const at = this.entities.indexOf(entity);
        if (at >= 0) this.entities.splice(at, 1);
        for (const rows of this.compBase.values()) rows.delete(entity);
    }
}

/** One load / one store, chosen by the width the contract declares. */
function load(mem: AbiMemory, at: number, bits: 32 | 64): number {
    return bits === 64 ? mem.f64[at >> 3]! : mem.f32[at >> 2]!;
}
function store(mem: AbiMemory, at: number, bits: 32 | 64, v: number | boolean): void {
    const n = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    if (bits === 64) mem.f64[at >> 3] = n; else mem.f32[at >> 2] = n;
}

/**
 * Which slot of `SysCtx` each of a system's parameters is. The order is the
 * declaration order of `_params`, and §2.1 says it is burned into the handshake
 * hash — so this function, not a convention, is what both the host and the code
 * generator ask. Two readers of one answer; not two answers.
 */
export interface SysPlan {
    readonly system: string;
    /** One entry per declared `Query`, in declaration order. */
    readonly queries: readonly (readonly QueryArg[])[];
    /** One entry per declared `Res`, in declaration order. */
    readonly resources: readonly string[];
    /** One entry per declared channel (`Commands`, later an event reader). */
    readonly channels: readonly string[];
    /** A parameter's local id -> which of the three tables, and which slot. */
    readonly slots: ReadonlyMap<number, { readonly table: 'query' | 'res' | 'channel'; readonly slot: number }>;
}

export function planFor(sys: EirSystem): SysPlan {
    const queries: (readonly QueryArg[])[] = [];
    const resources: string[] = [];
    const channels: string[] = [];
    const slots = new Map<number, { table: 'query' | 'res' | 'channel'; slot: number }>();
    for (const p of sys.params) {
        switch (p.type.k) {
            case 'query':
                slots.set(p.id, { table: 'query', slot: queries.length });
                queries.push(p.type.args);
                break;
            case 'res':
                slots.set(p.id, { table: 'res', slot: resources.length });
                resources.push(p.type.name);
                break;
            case 'channel':
                slots.set(p.id, { table: 'channel', slot: channels.length });
                channels.push(p.type.name);
                break;
            default:
                throw new Error(`ABI: '${p.name}' is a ${p.type.k}, which SysCtx has no table for`);
        }
    }
    return { system: sys.name, queries, resources, channels, slots };
}

/** A materialised call: where the ctx is, and where its count word lives. */
export interface AbiCall {
    readonly ctx: number;
    readonly cmdCount: number;
}

/**
 * The host's half of §2.1: pack the rows, resolve the resource addresses, zero
 * the count, write the SysCtx. When it returns, linear memory holds everything
 * the compiled code reads and nothing else it may reach. Rows are materialised
 * the way `View.hpp` already does — existing strategy, not a second one.
 */
export function materialize(mem: AbiMemory, plan: SysPlan): AbiCall {
    mem.beginCall();
    const queryTable = mem.scratch(Math.max(1, plan.queries.length) * QUERYROWS_WORDS * 4);
    plan.queries.forEach((args, k) => {
        const stride = 1 + args.length;
        const matched: number[] = [];
        for (const e of mem.entities) {
            const binds = args.map((a) => mem.baseOf(a.comp, e));
            if (binds.some((b) => b === undefined)) continue;
            matched.push(e, ...(binds as number[]));
        }
        const rows = mem.scratch(Math.max(4, matched.length * 4));
        for (let i = 0; i < matched.length; i++) mem.u32[(rows >> 2) + i] = matched[i]!;
        mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS] = rows;
        mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS + 1] = matched.length / stride;
    });

    const resTable = mem.scratch(Math.max(4, plan.resources.length * 4));
    plan.resources.forEach((name, k) => { mem.u32[(resTable >> 2) + k] = mem.resourceBase(name); });

    const cmdCount = mem.scratch(4);
    mem.u32[cmdCount >> 2] = 0;

    const ctx = mem.scratch(SYSCTX_WORDS * 4);
    const w = ctx >> 2;
    mem.u32[w] = queryTable;
    mem.u32[w + 1] = resTable;
    mem.u32[w + 2] = mem.cmdBuf;
    mem.u32[w + 3] = mem.cmdCap;
    mem.u32[w + 4] = cmdCount;
    mem.u32[w + 5] = 0;  // events: no channel in v1 carries one yet
    return { ctx, cmdCount };
}

/**
 * The host a compiled system sees, reaching the world through NOTHING but the
 * ctx `materialize` wrote. It reads the packed row array rather than re-deriving
 * the rows, so the interpreter and the generated C consume the same bytes: a
 * host that walked `mem.entities` again would agree only by coincidence.
 */
export function abiHost(mem: AbiMemory, layout: AbiLayout, plan: SysPlan, call: AbiCall): EirHost {
    const leafAt = (owner: string, path: readonly string[]): Leaf => {
        const shape = layout.comps.get(owner) ?? layout.resources.get(owner);
        const leaf = shape?.leaves.get(path.join('.'));
        if (!leaf) throw new Error(`ABI: '${owner}' has no field '${path.join('.')}'`);
        return leaf;
    };
    const w = call.ctx >> 2;
    const queryTable = mem.u32[w]!;
    const resTable = mem.u32[w + 1]!;
    const cmdBuf = mem.u32[w + 2]!;
    const cmdCap = mem.u32[w + 3]!;
    return {
        *rows(args: readonly QueryArg[]) {
            const k = plan.queries.indexOf(args);
            if (k < 0) throw new Error(`ABI: '${plan.system}' walks a query it did not declare`);
            const rows = mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS]!;
            const count = mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS + 1]!;
            const stride = 1 + args.length;
            for (let i = 0; i < count; i++) {
                const at = (rows >> 2) + i * stride;
                yield { entity: mem.u32[at]!, binds: args.map((_, j) => mem.u32[at + 1 + j]!) };
            }
        },
        readField(base, owner, path) {
            const leaf = leafAt(owner, path);
            return load(mem, (base as number) + leaf.byteOffset, leaf.bits);
        },
        writeField(base, owner, path, v) {
            const leaf = leafAt(owner, path);
            store(mem, (base as number) + leaf.byteOffset, leaf.bits, v);
        },
        resource(name) {
            const k = plan.resources.indexOf(name);
            if (k < 0) throw new Error(`ABI: '${plan.system}' reads a resource it did not declare`);
            return mem.u32[(resTable >> 2) + k]!;
        },
        emit(record, args) {
            const n = mem.u32[call.cmdCount >> 2]!;
            if (n >= cmdCap) throw new Error('ABI: command buffer overflow');
            const at = (cmdBuf >> 2) + n * CMD_WORDS;
            mem.u32[at] = record === 'despawn' ? CMD_DESPAWN : CMD_REMOVE;
            mem.u32[at + 1] = args[0] as number;
            mem.u32[at + 2] = 0;
            mem.u32[at + 3] = 0;
            mem.u32[call.cmdCount >> 2] = n + 1;
        },
        flush() {
            flushCommands(mem, call);
        },
    };
}

/**
 * The host's other half: apply what the call wrote. Shared by the interpreter
 * and by whatever ran the compiled code, because the records are the same
 * records — which is the whole reason they are records and not calls.
 */
export function flushCommands(mem: AbiMemory, call: AbiCall): void {
    const n = mem.u32[call.cmdCount >> 2]!;
    const at = mem.cmdBuf >> 2;
    for (let i = 0; i < n; i++) {
        const kind = mem.u32[at + i * CMD_WORDS]!;
        if (kind === CMD_DESPAWN) mem.despawn(mem.u32[at + i * CMD_WORDS + 1]!);
    }
    mem.u32[call.cmdCount >> 2] = 0;
}

/**
 * One system, one call, through the contract: materialise, run, flush. The
 * generated code's runner does exactly these three steps with the middle one
 * replaced — which is what makes the difference between them measurable.
 */
export function runOnAbi(sys: EirSystem, mem: AbiMemory, layout: AbiLayout, fns: Fns = new Map()): void {
    const plan = planFor(sys);
    const call = materialize(mem, plan);
    runSystemOn(sys, abiHost(mem, layout, plan, call), fns);
}

/**
 * The §2.5 handshake: EHT's offsets, the shape of the three structs, and every
 * system's parameter order, in one number the loader compares before it maps
 * anything. A mismatch is a read of a DIFFERENT FIELD, not a wrong answer, so it
 * is refused. FNV-1a, as `mkbc` and the asset hashes use; not a new mechanism.
 */
export function abiHash(layout: AbiLayout, plans: readonly SysPlan[]): string {
    const parts: string[] = [
        `eht=${ehtStamp()}`,
        `sysctx=${SYSCTX_WORDS} queryrows=${QUERYROWS_WORDS} cmd=${CMD_WORDS}`,
    ];
    const table = (kind: string, m: ReadonlyMap<string, FieldOffsets>): void => {
        for (const [name, f] of m) {
            const leaves = [...f.leaves].map(([p, l]) => `${p}@${l.byteOffset}:${l.bits}`).join(',');
            parts.push(`${kind} ${name} stride=${f.stride} ${leaves}`);
        }
    };
    table('comp', layout.comps);
    table('res', layout.resources);
    for (const p of plans) {
        const qs = p.queries.map((q) => q.map((a) => (a.mut ? `mut ${a.comp}` : a.comp)).join('+')).join('|');
        // The ORDER parameters were declared in, not just what they were: two
        // systems taking a Query and a Res differ only here, and a loader that
        // could not tell them apart would read the row array as the resource.
        const order = [...p.slots.values()].map((s) => `${s.table}${s.slot}`).join(',');
        parts.push(`sys ${p.system} order=${order} q=${qs} r=${p.resources.join('|')} c=${p.channels.join('|')}`);
    }
    return fnv1a64(parts.join('\n'));
}

/**
 * The constant the artifact actually exports, for a host that has to compare.
 * `addrBytes` is `sizeof(es_addr_t)` on the side doing the comparing — 4 where
 * an address is an offset into one block, 8 where it is a real pointer.
 */
export function abiHashFor(contract: string, addrBytes: 4 | 8): string {
    const MASK = (1n << 64n) - 1n;
    const mixed = (BigInt(contract.padStart(16, '0').replace(/^/, '0x'))
        ^ ((0x9e3779b97f4a7c15n * BigInt(addrBytes)) & MASK)) & MASK;
    return mixed.toString(16).padStart(16, '0');
}

function fnv1a64(text: string): string {
    const MASK = (1n << 64n) - 1n;
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < text.length; i++) {
        h = (h ^ BigInt(text.charCodeAt(i) & 0xff)) & MASK;
        h = (h * 0x100000001b3n) & MASK;
    }
    return h.toString(16).padStart(16, '0');
}

/**
 * Byte offsets for every shape: leaves in declaration order, at the width the
 * SHAPE declares. Nothing here asks what a name means — `engine` shapes are the
 * C++ pools and `host` shapes are JS-side records, and both say so themselves.
 */
export function packLayout(shapes: ReadonlyMap<string, CompShape>): AbiLayout {
    const comps = new Map<string, FieldOffsets>();
    const resources = new Map<string, FieldOffsets>();
    for (const [name, shape] of shapes) {
        const leaves = new Map<string, Leaf>();
        let at = 0;
        for (const [path, spec] of shape.fields) {
            const width = spec.bits >> 3;
            at = (at + width - 1) & ~(width - 1);
            leaves.set(path, { byteOffset: at, bits: spec.bits, type: spec.type });
            at += width;
        }
        const packed: FieldOffsets = { leaves, stride: Math.max(8, at) };
        // A resource is addressed by field exactly as a component is, so the two
        // tables differ only in which one a `Res(...)` parameter looks in.
        (shape.storage === 'host' && RESOURCES.has(name) ? resources : comps).set(name, packed);
    }
    return { comps, resources };
}

/**
 * Which host-stored shapes are RESOURCES rather than components. This is the one
 * thing the shape cannot yet say, because resources have no generator — see the
 * note in builtins.ts. It goes away when they get one.
 */
const RESOURCES = new Set(['Time', 'Input']);
