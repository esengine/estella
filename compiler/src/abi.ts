// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    abi.ts
 * @brief   The Estella ABI, as an EirHost.
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
import {
    CMD_WORDS as CMD_WORDS_, CMD_DESPAWN as CMD_DESPAWN_, CMD_REMOVE as CMD_REMOVE_,
    QUERYROWS_WORDS as QUERYROWS_WORDS_, SYSCTX_WORDS as SYSCTX_WORDS_,
    engineAbiDigest, projectShapeDigest, type ShapeDigestInput,
} from '../../sdk/src/ecs/aot/abiDigest';
import { resourceNames } from './builtins';
import { resourceBlockBytes, resourceMethodBit } from '../../sdk/src/ecs/resourceShapes';
import { encBytes, type CompShape, type EirSystem, type EirType, type LeafEnc, type QueryArg } from './eir';
import { runSystemOn, type EirHost, type Fns } from './interp';

/**
 * The struct sizes and command kinds, from the SDK's `abiDigest.ts` — the one
 * author both sides read, so a field count cannot have two answers. Re-exported
 * because the code generator and this host both name them.
 */
export {
    CMD_WORDS, CMD_DESPAWN, CMD_REMOVE, SYSCTX_WORDS, QUERYROWS_WORDS,
} from '../../sdk/src/ecs/aot/abiDigest';

/**
 * Where a field lives and HOW it is encoded, both from the shape, which got them
 * from EHT. Encoding is contract, not detail: `Time.delta` packed as f32 makes
 * one side multiply by a rounded 1/30, and a bool byte read as a float takes
 * three bytes of its neighbour with it.
 */
export interface Leaf {
    readonly byteOffset: number;
    readonly enc: LeafEnc;
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
    readonly u8: Uint8Array;
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
        this.u8 = new Uint8Array(this.buffer);
        this.scratchNext = bytes;
        this.cmdBuf = this.alloc(this.cmdCap * CMD_WORDS_ * 4);
    }

    private alloc(size: number): number {
        const at = this.next;
        this.next += (size + 15) & ~15;
        if (this.next > this.scratchNext) throw new Error('ABI image out of memory');
        return at;
    }

    /**
     * Reset the arena the host refills each call. A row array and a SysCtx have
     * a one-call lifetime, and a region thrown away each time ENFORCES that
     * rather than restating it. It grows down from the end of the image
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

    /**
     * Set one bit of a service's mirror, as a host would after asking it. The
     * bit is chosen the same way the compiled code chooses it, which is the
     * point: a test placing it by hand would be a third answer.
     */
    setResourceBit(name: string, method: string, key: string | number, on: boolean): void {
        const at = resourceMethodBit(name, method, key);
        if (!at) throw new Error(`ABI: '${name}.${method}' is not a declared service question`);
        const byte = this.resourceBase(name) + at.offset;
        if (on) this.u8[byte] = (this.u8[byte]! | (1 << at.bit));
        else this.u8[byte] = (this.u8[byte]! & ~(1 << at.bit));
    }

    private writeLeaf(shape: FieldOffsets, base: number, path: string, v: number | boolean): void {
        const leaf = shape.leaves.get(path);
        if (!leaf) throw new Error(`ABI: no field '${path}'`);
        store(this, base + leaf.byteOffset, leaf.enc, v);
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
    read(comp: string, entity: number, path: string): number | boolean {
        const shape = this.layout.comps.get(comp)!;
        const leaf = shape.leaves.get(path)!;
        return load(this, this.baseOf(comp, entity)! + leaf.byteOffset, leaf.enc);
    }

    /** Drop an entity, as the host's flush would. */
    despawn(entity: number): void {
        const at = this.entities.indexOf(entity);
        if (at >= 0) this.entities.splice(at, 1);
        for (const rows of this.compBase.values()) rows.delete(entity);
    }
}

/** One load / one store, chosen by the encoding the shape declares. */
function load(mem: AbiMemory, at: number, enc: LeafEnc): number | boolean {
    switch (enc) {
        case 'f64': return mem.f64[at >> 3]!;
        case 'f32': return mem.f32[at >> 2]!;
        case 'bool8': return mem.u8[at] !== 0;
        default: throw new Error(`ABI: nothing reads a ${enc} leaf yet`);
    }
}

function store(mem: AbiMemory, at: number, enc: LeafEnc, v: number | boolean): void {
    switch (enc) {
        case 'f64': mem.f64[at >> 3] = typeof v === 'boolean' ? (v ? 1 : 0) : v; break;
        case 'f32': mem.f32[at >> 2] = typeof v === 'boolean' ? (v ? 1 : 0) : v; break;
        case 'bool8': mem.u8[at] = v ? 1 : 0; break;
        default: throw new Error(`ABI: nothing writes a ${enc} leaf yet`);
    }
}

/**
 * Which slot of `SysCtx` each of a system's parameters is. The order is the
 * declaration order of `_params`, and the manifest is what drives it at run
 * time — so this function, not a convention, is what both the host and the code
 * generator ask. Two readers of one answer; not two answers.
 */
/** A resource a system declared, and whether it declared it writable. */
export interface ResourceArg {
    readonly name: string;
    readonly mut: boolean;
}

export interface SysPlan {
    readonly system: string;
    /** One entry per declared `Query`, in declaration order. */
    readonly queries: readonly (readonly QueryArg[])[];
    /** One entry per declared `Res`/`ResMut`, in declaration order. `mut` is
     *  what tells a mirroring host to write the block back after the call. */
    readonly resources: readonly ResourceArg[];
    /** One entry per declared channel (`Commands`, later an event reader). */
    readonly channels: readonly string[];
    /** A parameter's local id -> which of the three tables, and which slot. */
    readonly slots: ReadonlyMap<number, { readonly table: 'query' | 'res' | 'channel'; readonly slot: number }>;
}

export function planFor(sys: EirSystem): SysPlan {
    const queries: (readonly QueryArg[])[] = [];
    const resources: ResourceArg[] = [];
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
                resources.push({ name: p.type.name, mut: p.type.mut });
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
 * The host's half of the contract: pack the rows, resolve the resources, zero
 * the count, write the SysCtx. When it returns, linear memory holds everything
 * the compiled code reads and nothing else it may reach. Rows are materialised
 * the way `View.hpp` already does — existing strategy, not a second one.
 */
export function materialize(mem: AbiMemory, plan: SysPlan): AbiCall {
    mem.beginCall();
    const queryTable = mem.scratch(Math.max(1, plan.queries.length) * QUERYROWS_WORDS_ * 4);
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
        mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS_] = rows;
        mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS_ + 1] = matched.length / stride;
    });

    const resTable = mem.scratch(Math.max(4, plan.resources.length * 4));
    plan.resources.forEach((r, k) => { mem.u32[(resTable >> 2) + k] = mem.resourceBase(r.name); });

    const cmdCount = mem.scratch(4);
    mem.u32[cmdCount >> 2] = 0;

    const ctx = mem.scratch(SYSCTX_WORDS_ * 4);
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
            const rows = mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS_]!;
            const count = mem.u32[(queryTable >> 2) + k * QUERYROWS_WORDS_ + 1]!;
            const stride = 1 + args.length;
            for (let i = 0; i < count; i++) {
                const at = (rows >> 2) + i * stride;
                yield { entity: mem.u32[at]!, binds: args.map((_, j) => mem.u32[at + 1 + j]!) };
            }
        },
        readField(base, owner, path) {
            const leaf = leafAt(owner, path);
            return load(mem, (base as number) + leaf.byteOffset, leaf.enc);
        },
        writeField(base, owner, path, v) {
            const leaf = leafAt(owner, path);
            store(mem, (base as number) + leaf.byteOffset, leaf.enc, v);
        },
        service(name, method, key) {
            // The mirrored answer, read as one bit — which is exactly what the
            // compiled code does, and the reason the interpreter over live
            // objects has to agree with it.
            const at = resourceMethodBit(name, method, key);
            if (!at) throw new Error(`ABI: '${name}.${method}' is not a declared service question`);
            const k = plan.resources.findIndex((r) => r.name === name);
            if (k < 0) throw new Error(`ABI: '${plan.system}' asks a resource it did not declare`);
            const base = mem.u32[(resTable >> 2) + k]!;
            return ((mem.u8[base + at.offset]! >> at.bit) & 1) !== 0;
        },
        resource(name) {
            const k = plan.resources.findIndex((r) => r.name === name);
            if (k < 0) throw new Error(`ABI: '${plan.system}' reads a resource it did not declare`);
            return mem.u32[(resTable >> 2) + k]!;
        },
        emit(record, args) {
            const n = mem.u32[call.cmdCount >> 2]!;
            if (n >= cmdCap) throw new Error('ABI: command buffer overflow');
            const at = (cmdBuf >> 2) + n * CMD_WORDS_;
            mem.u32[at] = record === 'despawn' ? CMD_DESPAWN_ : CMD_REMOVE_;
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
        const kind = mem.u32[at + i * CMD_WORDS_]!;
        if (kind === CMD_DESPAWN_) mem.despawn(mem.u32[at + i * CMD_WORDS_ + 1]!);
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
 * The handshake, as TWO numbers because the fixes differ: `engineAbi` means
 * rebuild the module against this engine, `projectShapes` means rebuild the
 * project. Parameter order is in neither — the manifest DRIVES the layout at run
 * time, so it is followed rather than compared.
 */
export interface AbiHandshake {
    readonly engineAbi: string;
    readonly projectShapes: string;
}

export function abiHandshake(
    comps: ReadonlyMap<string, CompShape>,
    plans: readonly SysPlan[],
    addressBytes: 4 | 8 = 4,
): AbiHandshake {
    // Scoped to the components the compiled systems NAME: adding an unrelated
    // component to a project must not invalidate a module that never reads it.
    const named = new Set<string>();
    for (const p of plans) for (const q of p.queries) for (const a of q) named.add(a.comp);

    const shapes: ShapeDigestInput[] = [];
    for (const name of named) {
        const shape = comps.get(name);
        // Engine components are covered by `engineAbi`, from EHT's own table.
        if (!shape || shape.storage !== 'host') continue;
        shapes.push({ name, fields: [...shape.fields.keys()] });
    }
    return {
        engineAbi: engineAbiDigest(addressBytes),
        projectShapes: projectShapeDigest(shapes),
    };
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
        let end = 0;
        let packed_at = 0;
        for (const [path, spec] of shape.fields) {
            const width = encBytes(spec.enc);
            // Where an engine field lives has ONE authority, and it is not this
            // function. Only a host record, which has no C++ struct, is laid
            // out here.
            let at = spec.offset;
            if (at === null) {
                packed_at = (packed_at + width - 1) & ~(width - 1);
                at = packed_at;
                packed_at += width;
            }
            leaves.set(path, { byteOffset: at, enc: spec.enc, type: spec.type });
            end = Math.max(end, at + width);
        }
        // A resource is addressed by field exactly as a component is, so the two
        // tables differ only in which one a `Res(...)` parameter looks in. Its
        // SIZE is not derived here though: a service's bit sets are members no
        // field walk sees, and a block sized to the last scalar is too small.
        const isResource = shape.storage === 'host' && RESOURCES.has(name);
        const packed: FieldOffsets = {
            leaves,
            stride: isResource ? resourceBlockBytes(name) : Math.max(8, (end + 7) & ~7),
        };
        (isResource ? resources : comps).set(name, packed);
    }
    return { comps, resources };
}

/**
 * Which host-stored shapes are RESOURCES rather than components — the SDK's own
 * declarations, so this list has no second author to drift from.
 */
const RESOURCES = new Set(resourceNames());
