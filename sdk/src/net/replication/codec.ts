// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    codec.ts
 * @brief   Reflection-driven binary codec for replication state frames. No
 *          hand-written per-component serializers: the field list comes from
 *          the `replicated` declaration (getReplicatedFields) and each field's
 *          wire shape derives from the component's default value — both ends
 *          derive from the same declaration, verified at handshake, so the
 *          layouts cannot drift independently.
 *
 *          Frame layout (little-endian):
 *            u32 magic 'ESRP' | u8 version | u32 tick | u16 entryCount
 *            entry: u32 netId | u16 componentId | u32 fieldMask
 *                   | field values for set mask bits, in declaration order
 *
 *          Value shapes: number → f32 (engine truth is f32), boolean → u8,
 *          string → u16 len + utf8, plain object → keys recursively in
 *          declaration order, entity-ref field → u32 netId (remapped at both
 *          ends), anything else → JSON string fallback.
 *
 * @beta   Pre-1.0 networking: client prediction will reshape this surface.
 */
import { getComponentRegistry, type AnyComponentDef } from '../../component';
import { REPLICATION_PROTOCOL_VERSION, type ReplComponentSchema } from './protocol';

const FRAME_MAGIC = 0x45535250; // 'ESRP'

// =============================================================================
// Field shapes
// =============================================================================

export type FieldShape =
    | { kind: 'f32' }
    | { kind: 'bool' }
    | { kind: 'string' }
    | { kind: 'entity' }
    | { kind: 'object'; keys: string[]; shapes: FieldShape[] }
    | { kind: 'json' };

function buildShape(defaultValue: unknown): FieldShape {
    switch (typeof defaultValue) {
        case 'number': return { kind: 'f32' };
        case 'boolean': return { kind: 'bool' };
        case 'string': return { kind: 'string' };
        case 'object': {
            if (defaultValue === null || Array.isArray(defaultValue)) return { kind: 'json' };
            const keys = Object.keys(defaultValue as Record<string, unknown>);
            return {
                kind: 'object',
                keys,
                shapes: keys.map((k) => buildShape((defaultValue as Record<string, unknown>)[k])),
            };
        }
        default: return { kind: 'json' };
    }
}

// =============================================================================
// Replication table
// =============================================================================

export interface ReplicationTableEntry {
    /** Wire component id — the index in the name-sorted table. */
    id: number;
    name: string;
    def: AnyComponentDef;
    fields: string[];
    shapes: FieldShape[];
}

export interface ReplicationTable {
    entries: ReplicationTableEntry[];
    byName: Map<string, ReplicationTableEntry>;
}

/**
 * Build the wire table from every registered component with a non-empty
 * `replicated` declaration, name-sorted so both ends derive identical ids.
 * The handshake compares the two tables field-by-field before any frame flows.
 */
export function buildReplicationTable(): ReplicationTable {
    const entries: ReplicationTableEntry[] = [];
    const names = [...getComponentRegistry().entries()]
        .filter(([, def]) => def.replicatedFields.length > 0)
        .map(([name]) => name)
        .sort();
    for (const name of names) {
        const def = getComponentRegistry().get(name)!;
        const fields = [...def.replicatedFields];
        if (fields.length > 32) {
            throw new Error(`[repl] component "${name}" declares ${fields.length} replicated fields; the field mask caps at 32`);
        }
        const defaults = def._default as Record<string, unknown>;
        const entityFields = new Set(def.entityFields);
        entries.push({
            id: entries.length,
            name,
            def,
            fields,
            shapes: fields.map((f) => (entityFields.has(f) ? { kind: 'entity' } : buildShape(defaults[f]))),
        });
    }
    return { entries, byName: new Map(entries.map((e) => [e.name, e])) };
}

export function tableSchemas(table: ReplicationTable): ReplComponentSchema[] {
    return table.entries.map((e) => ({ name: e.name, fields: [...e.fields] }));
}

/** Exact-schema comparison for the handshake: same components, same fields,
 *  same order. Returns a human-readable mismatch, or null when compatible. */
export function diffSchemas(mine: ReplComponentSchema[], theirs: ReplComponentSchema[]): string | null {
    if (mine.length !== theirs.length) {
        return `replication table size mismatch (${mine.length} vs ${theirs.length})`;
    }
    for (let i = 0; i < mine.length; i++) {
        if (mine[i].name !== theirs[i].name) {
            return `component #${i} differs ("${mine[i].name}" vs "${theirs[i].name}")`;
        }
        if (mine[i].fields.join(',') !== theirs[i].fields.join(',')) {
            return `component "${mine[i].name}" field list differs ([${mine[i].fields}] vs [${theirs[i].fields}])`;
        }
    }
    return null;
}

// =============================================================================
// Byte streams
// =============================================================================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ByteWriter {
    private buf_: Uint8Array;
    private view_: DataView;
    private len_ = 0;

    constructor(initialCapacity = 256) {
        this.buf_ = new Uint8Array(initialCapacity);
        this.view_ = new DataView(this.buf_.buffer);
    }

    get length(): number { return this.len_; }

    private ensure_(bytes: number): void {
        if (this.len_ + bytes <= this.buf_.byteLength) return;
        let cap = this.buf_.byteLength * 2;
        while (cap < this.len_ + bytes) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.buf_.subarray(0, this.len_));
        this.buf_ = next;
        this.view_ = new DataView(next.buffer);
    }

    u8(v: number): void { this.ensure_(1); this.view_.setUint8(this.len_, v); this.len_ += 1; }
    u16(v: number): void { this.ensure_(2); this.view_.setUint16(this.len_, v, true); this.len_ += 2; }
    u32(v: number): void { this.ensure_(4); this.view_.setUint32(this.len_, v >>> 0, true); this.len_ += 4; }
    f32(v: number): void { this.ensure_(4); this.view_.setFloat32(this.len_, v, true); this.len_ += 4; }

    string(s: string): void {
        const bytes = textEncoder.encode(s);
        if (bytes.byteLength > 0xffff) throw new Error('[repl] string field exceeds 65535 utf-8 bytes');
        this.u16(bytes.byteLength);
        this.ensure_(bytes.byteLength);
        this.buf_.set(bytes, this.len_);
        this.len_ += bytes.byteLength;
    }

    /** Patch a previously written u16 (e.g. a count written before the loop). */
    patchU16(offset: number, v: number): void { this.view_.setUint16(offset, v, true); }

    finish(): Uint8Array {
        return this.buf_.slice(0, this.len_);
    }
}

export class ByteReader {
    private readonly view_: DataView;
    private readonly bytes_: Uint8Array;
    private pos_ = 0;

    constructor(data: Uint8Array) {
        this.bytes_ = data;
        this.view_ = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    get remaining(): number { return this.bytes_.byteLength - this.pos_; }

    u8(): number { const v = this.view_.getUint8(this.pos_); this.pos_ += 1; return v; }
    u16(): number { const v = this.view_.getUint16(this.pos_, true); this.pos_ += 2; return v; }
    u32(): number { const v = this.view_.getUint32(this.pos_, true); this.pos_ += 4; return v; }
    f32(): number { const v = this.view_.getFloat32(this.pos_, true); this.pos_ += 4; return v; }

    string(): string {
        const len = this.u16();
        const s = textDecoder.decode(this.bytes_.subarray(this.pos_, this.pos_ + len));
        this.pos_ += len;
        return s;
    }
}

// =============================================================================
// Value codec
// =============================================================================

/** Entity-ref translation at the wire boundary: the encoder maps a live Entity
 *  to its netId, the decoder maps a netId back to the local Entity (0 when the
 *  target is unknown/not replicated). */
export interface EntityRefMap {
    toWire(entity: number): number;
    fromWire(netId: number): number;
}

const IDENTITY_REFS: EntityRefMap = { toWire: (e) => e, fromWire: (n) => n };

export function encodeValue(w: ByteWriter, shape: FieldShape, value: unknown, refs: EntityRefMap = IDENTITY_REFS): void {
    switch (shape.kind) {
        case 'f32': w.f32(typeof value === 'number' ? value : 0); break;
        case 'bool': w.u8(value ? 1 : 0); break;
        case 'string': w.string(typeof value === 'string' ? value : ''); break;
        case 'entity': w.u32(refs.toWire(typeof value === 'number' ? value : 0)); break;
        case 'object': {
            const rec = (value ?? {}) as Record<string, unknown>;
            for (let i = 0; i < shape.keys.length; i++) {
                encodeValue(w, shape.shapes[i], rec[shape.keys[i]], refs);
            }
            break;
        }
        case 'json': w.string(JSON.stringify(value ?? null)); break;
    }
}

export function decodeValue(r: ByteReader, shape: FieldShape, refs: EntityRefMap = IDENTITY_REFS): unknown {
    switch (shape.kind) {
        case 'f32': return r.f32();
        case 'bool': return r.u8() !== 0;
        case 'string': return r.string();
        case 'entity': return refs.fromWire(r.u32());
        case 'object': {
            const out: Record<string, unknown> = {};
            for (let i = 0; i < shape.keys.length; i++) {
                out[shape.keys[i]] = decodeValue(r, shape.shapes[i], refs);
            }
            return out;
        }
        case 'json': return JSON.parse(r.string());
    }
}

// =============================================================================
// State frames
// =============================================================================

export interface StateEntry {
    netId: number;
    componentId: number;
    fieldMask: number;
    /** Decoded values for set mask bits, in field-declaration order. */
    values: unknown[];
}

export interface StateFrame {
    tick: number;
    entries: StateEntry[];
}

export class FrameWriter {
    private readonly w_ = new ByteWriter();
    private readonly countOffset_: number;
    private count_ = 0;

    constructor(tick: number) {
        this.w_.u32(FRAME_MAGIC);
        this.w_.u8(REPLICATION_PROTOCOL_VERSION);
        this.w_.u32(tick);
        this.countOffset_ = this.w_.length;
        this.w_.u16(0);
    }

    get entryCount(): number { return this.count_; }

    entry(netId: number, table: ReplicationTableEntry, fieldMask: number, data: Record<string, unknown>, refs?: EntityRefMap): void {
        this.w_.u32(netId);
        this.w_.u16(table.id);
        this.w_.u32(fieldMask);
        for (let i = 0; i < table.fields.length; i++) {
            if (fieldMask & (1 << i)) {
                encodeValue(this.w_, table.shapes[i], data[table.fields[i]], refs);
            }
        }
        this.count_++;
    }

    finish(): Uint8Array {
        this.w_.patchU16(this.countOffset_, this.count_);
        return this.w_.finish();
    }
}

export function decodeStateFrame(payload: Uint8Array, table: ReplicationTable, refs?: EntityRefMap): StateFrame {
    const r = new ByteReader(payload);
    if (r.u32() !== FRAME_MAGIC) throw new Error('[repl] bad state frame magic');
    const version = r.u8();
    if (version !== REPLICATION_PROTOCOL_VERSION) {
        throw new Error(`[repl] state frame protocol v${version}, expected v${REPLICATION_PROTOCOL_VERSION}`);
    }
    const tick = r.u32();
    const count = r.u16();
    const entries: StateEntry[] = [];
    for (let n = 0; n < count; n++) {
        const netId = r.u32();
        const componentId = r.u16();
        const fieldMask = r.u32();
        const te = table.entries[componentId];
        if (!te) throw new Error(`[repl] state frame names unknown component id ${componentId}`);
        const values: unknown[] = [];
        for (let i = 0; i < te.fields.length; i++) {
            if (fieldMask & (1 << i)) values.push(decodeValue(r, te.shapes[i], refs));
        }
        entries.push({ netId, componentId, fieldMask, values });
    }
    return { tick, entries };
}
