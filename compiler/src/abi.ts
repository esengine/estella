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
import type { CompShape, EirType, QueryArg } from './eir';
import type { EirHost } from './interp';

/** One command record: 16 bytes, four u32 (docs/REARCH_AOT_ABI.md §2.3). */
export const CMD_WORDS = 4;
export const CMD_DESPAWN = 1;
export const CMD_REMOVE = 2;

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
    cmdCount = 0;

    constructor(private readonly layout: AbiLayout, bytes = 1 << 20) {
        this.buffer = new ArrayBuffer(bytes);
        this.f32 = new Float32Array(this.buffer);
        this.f64 = new Float64Array(this.buffer);
        this.u32 = new Uint32Array(this.buffer);
        this.cmdBuf = this.alloc(this.cmdCap * CMD_WORDS * 4);
    }

    private alloc(size: number): number {
        const at = this.next;
        this.next += (size + 15) & ~15;
        if (this.next > this.buffer.byteLength) throw new Error('ABI image out of memory');
        return at;
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
 * The host a compiled system would see. `rows` is the packed array SysCtx
 * carries; every field access below is a load or store at a declared offset,
 * and nothing here calls the engine.
 */
export function abiHost(mem: AbiMemory, layout: AbiLayout): EirHost {
    const leafAt = (owner: string, path: readonly string[]): Leaf => {
        const shape = layout.comps.get(owner) ?? layout.resources.get(owner);
        const leaf = shape?.leaves.get(path.join('.'));
        if (!leaf) throw new Error(`ABI: '${owner}' has no field '${path.join('.')}'`);
        return leaf;
    };
    return {
        *rows(args: readonly QueryArg[]) {
            // What the host materialises: [entity, base0, base1, …] per row.
            for (const e of mem.entities) {
                const binds = args.map((a) => mem.baseOf(a.comp, e));
                if (binds.some((b) => b === undefined)) continue;
                yield { entity: e, binds: binds as number[] };
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
            return mem.resourceBase(name);
        },
        emit(record, args) {
            if (mem.cmdCount >= mem.cmdCap) throw new Error('ABI: command buffer overflow');
            const at = (mem.cmdBuf >> 2) + mem.cmdCount * CMD_WORDS;
            mem.u32[at] = record === 'despawn' ? CMD_DESPAWN : CMD_REMOVE;
            mem.u32[at + 1] = args[0] as number;
            mem.cmdCount++;
        },
        flush() {
            const at = mem.cmdBuf >> 2;
            for (let i = 0; i < mem.cmdCount; i++) {
                const kind = mem.u32[at + i * CMD_WORDS]!;
                if (kind === CMD_DESPAWN) mem.despawn(mem.u32[at + i * CMD_WORDS + 1]!);
            }
            mem.cmdCount = 0;
        },
    };
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
