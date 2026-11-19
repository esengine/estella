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
 *            entry: varint netId | varint componentId | varint fieldMask
 *                   | field values for set mask bits, in declaration order
 *
 *          A varint is LEB128: seven bits a byte, low first, high bit set on
 *          every byte but the last.
 *
 *          Value shapes: number → f32 (engine truth is f32), or, when the field
 *          is quantized (quantizeReplicatedFields), a zigzag varint of whole
 *          steps; boolean → u8,
 *          string → u16 len + utf8, plain object → keys recursively in
 *          declaration order, entity-ref field → u32 netId (remapped at both
 *          ends), anything else → JSON string fallback.
 */
import { getComponentRegistry, type AnyComponentDef } from '../../ecs/component';
import { REPLICATION_PROTOCOL_VERSION, type ReplComponentSchema } from './protocol';

const FRAME_MAGIC = 0x45535250; // 'ESRP'

// =============================================================================
// Field shapes
// =============================================================================

export type FieldShape =
    /** A number. With `step`, quantized: sent as a whole number of steps. */
    | { kind: 'f32'; step?: number }
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
// Quantization
// =============================================================================

const quantization_ = new Map<string, Readonly<Record<string, number>>>();

/**
 * Send some of a component's replicated number fields as whole numbers of a
 * step instead of 32-bit floats. A position in world units with step `1` (a
 * centimetre at 100 units a metre) costs one to three bytes an axis instead of
 * four, and the value that arrives is the nearest multiple of the step. A field
 * holding an object (a position's `x, y, z`) quantizes every number in it.
 *
 * Declare it at startup, on both ends, before any connection: each end builds
 * its table the first time it is used and keeps it, and the handshake refuses a
 * client whose steps differ from the server's. An empty `steps` removes the
 * component's quantization (for tables built after that).
 *
 * Applies to state frames, the per-tick deltas. A spawn still carries the exact
 * value. A value whose whole number of steps is beyond 2^53, or not finite, is
 * sent as 0.
 *
 * @example
 * ```ts
 * // Positions to the centimetre and angles to a hundredth of a degree, at 100 units a metre.
 * quantizeReplicatedFields('Transform', { position: 1, rotation: 0.01 });
 * ```
 */
export function quantizeReplicatedFields(component: string, steps: Record<string, number>): void {
    for (const [field, step] of Object.entries(steps)) {
        if (!(typeof step === 'number' && Number.isFinite(step) && step > 0)) {
            throw new RangeError(`[repl] quantizeReplicatedFields: "${component}.${field}" needs a positive finite step, got ${step}`);
        }
    }
    if (Object.keys(steps).length === 0) quantization_.delete(component);
    else quantization_.set(component, { ...steps });
}

/** Every f32 inside a shape, given a step; null when it holds no number. */
function quantized(shape: FieldShape, step: number): FieldShape | null {
    if (shape.kind === 'f32') return { kind: 'f32', step };
    if (shape.kind === 'object') {
        let any = false;
        const shapes = shape.shapes.map((s) => {
            const q = quantized(s, step);
            if (q) { any = true; return q; }
            return s;
        });
        return any ? { kind: 'object', keys: shape.keys, shapes } : null;
    }
    return null;
}

/**
 * Deep-clone a replicated field value (plain JSON-shaped data). Shared by the
 * server's shadow snapshots and the client's prediction authority copies —
 * both must never alias live component objects.
 */
export function cloneValue<T>(v: T): T {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(cloneValue) as T;
    const out: Record<string, unknown> = {};
    for (const k in v) out[k] = cloneValue((v as Record<string, unknown>)[k]);
    return out as T;
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
        const shapes = fields.map((f): FieldShape => (entityFields.has(f) ? { kind: 'entity' } : buildShape(defaults[f])));
        for (const [field, step] of Object.entries(quantization_.get(name) ?? {})) {
            const i = fields.indexOf(field);
            if (i < 0) throw new Error(`[repl] "${name}.${field}" is quantized but is not one of its replicated fields`);
            const q = quantized(shapes[i]!, step);
            if (!q) throw new Error(`[repl] "${name}.${field}" is quantized but holds no number`);
            shapes[i] = q;
        }
        entries.push({ id: entries.length, name, def, fields, shapes });
    }
    return { entries, byName: new Map(entries.map((e) => [e.name, e])) };
}

/**
 * A field shape as one canonical string, so the handshake can compare byte
 * layouts and not just names. `entity` is its own signature rather than the
 * `f32` its default `0` would derive: the two are both four bytes and mean
 * completely different things on the wire.
 */
export function shapeSignature(shape: FieldShape): string {
    switch (shape.kind) {
        case 'object':
            return `{${shape.keys.map((k, i) => `${k}:${shapeSignature(shape.shapes[i])}`).join(',')}}`;
        case 'f32':
            // A different step is a different number arriving: the handshake has to see it.
            return shape.step === undefined ? 'f32' : `f32/${shape.step}`;
        default:
            return shape.kind;
    }
}

export function tableSchemas(table: ReplicationTable): ReplComponentSchema[] {
    return table.entries.map((e) => ({
        name: e.name,
        fields: [...e.fields],
        shapes: e.shapes.map(shapeSignature),
    }));
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
        // The layout, not just the vocabulary. Matching names over different
        // shapes is the mismatch that reads as a working connection and then
        // decodes garbage from the second entry of every frame onward.
        for (let f = 0; f < mine[i].fields.length; f++) {
            const a = mine[i].shapes?.[f];
            const b = theirs[i].shapes?.[f];
            if (a !== b) {
                return `component "${mine[i].name}" field "${mine[i].fields[f]}" has wire shape ${a} here and ${b} there`;
            }
        }
    }
    return null;
}

// =============================================================================
// Byte streams
// =============================================================================

// Lazy: WeChat installs its TextEncoder/TextDecoder polyfill during platform
// init, after this module is evaluated — a module-level `new` would
// ReferenceError on a real device (the devtools has them natively).
let textEncoder_: TextEncoder | undefined;
let textDecoder_: TextDecoder | undefined;
const textEncoder = (): TextEncoder => textEncoder_ ?? (textEncoder_ = new TextEncoder());
const textDecoder = (): TextDecoder => textDecoder_ ?? (textDecoder_ = new TextDecoder());

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

    /** A non-negative whole number up to 2^53, seven bits a byte (LEB128). */
    varint(v: number): void {
        this.ensure_(8);
        const buf = this.buf_;
        let len = this.len_;
        if (v < 0x80000000) {
            // The common case, in int32 arithmetic.
            while (v >= 0x80) { buf[len++] = (v & 0x7f) | 0x80; v >>>= 7; }
        } else {
            while (v >= 0x80) { buf[len++] = (v % 0x80) | 0x80; v = Math.floor(v / 0x80); }
        }
        buf[len++] = v;
        this.len_ = len;
    }

    string(s: string): void {
        const bytes = textEncoder().encode(s);
        if (bytes.byteLength > 0xffff) throw new Error('[repl] string field exceeds 65535 utf-8 bytes');
        this.u16(bytes.byteLength);
        this.ensure_(bytes.byteLength);
        this.buf_.set(bytes, this.len_);
        this.len_ += bytes.byteLength;
    }

    /** @internal What has been written so far, without a copy. Valid until the next write. */
    get bytes(): Uint8Array { return this.buf_; }

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

    varint(): number {
        let v = 0;
        let scale = 1;
        for (;;) {
            if (this.pos_ >= this.bytes_.byteLength) throw new RangeError('[repl] varint runs past the end of the frame');
            const b = this.bytes_[this.pos_++]!;
            v += (b & 0x7f) * scale;
            if (b < 0x80) return v;
            scale *= 0x80;
            if (scale > 2 ** 56) throw new RangeError('[repl] varint longer than 2^53');
        }
    }

    string(): string {
        const len = this.u16();
        const s = textDecoder().decode(this.bytes_.subarray(this.pos_, this.pos_ + len));
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
        case 'f32': {
            const n = typeof value === 'number' ? value : 0;
            if (shape.step === undefined) { w.f32(n); break; }
            const q = Math.round(n / shape.step);
            // Zigzag: small magnitudes of either sign are small numbers.
            w.varint(Number.isSafeInteger(q) && Math.abs(q) < 2 ** 52 ? (q >= 0 ? q * 2 : -q * 2 - 1) : 0);
            break;
        }
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
        case 'f32': {
            if (shape.step === undefined) return r.f32();
            const z = r.varint();
            // Zigzag back, then through f32: what the engine would hold.
            return Math.fround((z % 2 === 0 ? z / 2 : -(z + 1) / 2) * shape.step);
        }
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

    /** Bytes written so far, header included. */
    get byteLength(): number { return this.w_.length; }

    entry(netId: number, table: ReplicationTableEntry, fieldMask: number, data: Record<string, unknown>, refs?: EntityRefMap): void {
        writeEntry(this.w_, netId, table, fieldMask, data, refs);
        this.count_++;
    }

    finish(): Uint8Array {
        this.w_.patchU16(this.countOffset_, this.count_);
        return this.w_.finish();
    }
}

function writeEntry(
    w: ByteWriter, netId: number, table: ReplicationTableEntry, fieldMask: number,
    data: Record<string, unknown>, refs?: EntityRefMap,
): void {
    w.varint(netId >>> 0);
    w.varint(table.id);
    w.varint(fieldMask >>> 0);
    for (let i = 0; i < table.fields.length; i++) {
        if (fieldMask & (1 << i)) encodeValue(w, table.shapes[i], data[table.fields[i]], refs);
    }
}

/** magic, version, tick, entry count. */
const FRAME_HEADER_BYTES = 11;

/**
 * One sample's rows, each encoded once however many frames carry it. A row's
 * bytes do not depend on who receives them, so a server whose connections see
 * overlapping crowds encodes a row once and copies it into each frame, where
 * encoding per frame repeated the same work once per viewer.
 *
 * Rows are named by an index the caller chooses (its own row order) and
 * encoded on first use, so a row nobody is owed costs nothing.
 */
export class EncodedRows {
    private readonly w_ = new ByteWriter(4096);
    private readonly start_: Int32Array;
    private readonly end_: Int32Array;

    constructor(count: number) {
        this.start_ = new Int32Array(count).fill(-1);
        this.end_ = new Int32Array(count);
    }

    has(row: number): boolean { return this.start_[row] >= 0; }

    encode(row: number, netId: number, table: ReplicationTableEntry, fieldMask: number,
        data: Record<string, unknown>, refs?: EntityRefMap): void {
        this.start_[row] = this.w_.length;
        writeEntry(this.w_, netId, table, fieldMask, data, refs);
        this.end_[row] = this.w_.length;
    }

    /**
     * A state frame of these rows, in this order: the bytes a {@link FrameWriter}
     * given the same entries would produce. Every row must be encoded.
     *
     * `lead` spare bytes go in front of the frame, for a transport header to be
     * written into rather than copied in front of it.
     */
    frame(tick: number, rows: readonly number[], lead = 0): Uint8Array {
        const start = this.start_;
        const end = this.end_;
        let total = lead + FRAME_HEADER_BYTES;
        for (let i = 0; i < rows.length; i++) total += end[rows[i]] - start[rows[i]];
        const out = new Uint8Array(total);
        const view = new DataView(out.buffer);
        view.setUint32(lead, FRAME_MAGIC, true);
        view.setUint8(lead + 4, REPLICATION_PROTOCOL_VERSION);
        view.setUint32(lead + 5, tick >>> 0, true);
        view.setUint16(lead + 9, rows.length, true);
        const src = this.w_.bytes;
        let o = lead + FRAME_HEADER_BYTES;
        for (let i = 0; i < rows.length; i++) {
            for (let k = start[rows[i]], e = end[rows[i]]; k < e; k++) out[o++] = src[k];
        }
        return out;
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
        const netId = r.varint();
        const componentId = r.varint();
        const fieldMask = r.varint();
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
