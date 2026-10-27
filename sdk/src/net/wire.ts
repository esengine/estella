// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wire.ts
 * @brief   The two ways a NetChannel's control messages travel — the JSON text
 *          envelope and the protobuf binary envelope — and the codec a payload
 *          brings so it can travel either way.
 *
 * The binary envelope is one fixed message, so the channel never needs to know a
 * game's types: it moves `payload` bytes the contract's codec made.
 *
 *     message Envelope {
 *       uint32 kind = 1;     // 1 event, 2 request, 3 response, 4 ping, 5 pong
 *       string type = 2;     // the event or request name
 *       uint32 id = 3;       // request id, or the ping number
 *       string key = 4;      // idempotency key
 *       string error = 5;    // a failed response's message
 *       bytes payload = 6;   // present when there is a value
 *     }
 *
 * A binary frame is one byte of channel number, then its body. Channel 255 is this
 * envelope; the other numbers stay with the game and with replication.
 */

/** The channel number of binary frames that carry a control message. */
export const CONTROL_CHANNEL = 255;

/** Which encoding a channel writes. It reads both. */
export type WireFormat = 'json' | 'pb';

/**
 * How one message type's payload becomes bytes (protobuf wire) or JSON (the debugging wire).
 * A generated protobuf message is one, as it stands.
 */
export interface PayloadCodec<T = unknown> {
    encode(value: T): Uint8Array;
    decode(bytes: Uint8Array): T;
    /** The value as JSON-safe data; the debugging wire carries this. */
    toJSON(value: T): unknown;
    /** Check JSON-safe data and rebuild the value; throws on anything that is not the message. */
    fromJSON(json: unknown): T;
}

export type EnvelopeKind = 'event' | 'req' | 'res' | 'ping' | 'pong';

/** One control message, whichever way it travelled. `payload` is a protobuf-wire value as bytes. */
export interface Envelope {
    kind: EnvelopeKind;
    type?: string;
    id?: number;
    key?: string;
    error?: string;
    payload?: Uint8Array;
}

const KINDS: EnvelopeKind[] = ['event', 'req', 'res', 'ping', 'pong'];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function varint(out: number[], value: number): void {
    let v = value >>> 0;
    while (v >= 128) { out.push((v & 127) | 128); v >>>= 7; }
    out.push(v);
}

function field(out: number[], number: number, wireType: number): void {
    varint(out, (number << 3) | wireType);
}

function text(out: number[], number: number, value: string): void {
    const bytes = encoder.encode(value);
    field(out, number, 2);
    varint(out, bytes.length);
    for (const b of bytes) out.push(b);
}

/** A binary frame: the control channel byte, then the envelope. */
export function encodeEnvelope(e: Envelope): ArrayBuffer {
    const head: number[] = [CONTROL_CHANNEL];
    field(head, 1, 0); varint(head, KINDS.indexOf(e.kind) + 1);
    if (e.type !== undefined) text(head, 2, e.type);
    if (e.id !== undefined) { field(head, 3, 0); varint(head, e.id); }
    if (e.key !== undefined) text(head, 4, e.key);
    if (e.error !== undefined) text(head, 5, e.error);
    const payload = e.payload;
    if (payload !== undefined) { field(head, 6, 2); varint(head, payload.length); }
    const frame = new Uint8Array(head.length + (payload?.length ?? 0));
    frame.set(head);
    if (payload) frame.set(payload, head.length);
    return frame.buffer;
}

/**
 * Read a control frame's body (the bytes after the channel byte). Returns null for anything
 * that is not a well-formed envelope: a peer's mistake is never an exception here.
 */
export function decodeEnvelope(body: Uint8Array): Envelope | null {
    let pos = 0;
    const read = (): number => {
        let result = 0;
        let mul = 1;
        for (let i = 0; i < 5; i++) {
            const b = body[pos++];
            if (b === undefined) throw new RangeError('truncated');
            result += (b & 127) * mul;
            if (!(b & 128)) return result;
            mul *= 128;
        }
        throw new RangeError('varint too long');
    };
    const take = (): Uint8Array => {
        const n = read();
        if (pos + n > body.length) throw new RangeError('truncated');
        const out = body.subarray(pos, pos + n);
        pos += n;
        return out;
    };
    try {
        const e: Envelope = { kind: 'event' };
        let kind = 0;
        while (pos < body.length) {
            const tag = read();
            const number = Math.floor(tag / 8);
            const wire = tag & 7;
            if (number === 1 && wire === 0) kind = read();
            else if (number === 2 && wire === 2) e.type = decoder.decode(take());
            else if (number === 3 && wire === 0) e.id = read();
            else if (number === 4 && wire === 2) e.key = decoder.decode(take());
            else if (number === 5 && wire === 2) e.error = decoder.decode(take());
            else if (number === 6 && wire === 2) e.payload = take();
            else if (wire === 0) read();
            else if (wire === 2) take();
            else if (wire === 1) pos += 8;
            else if (wire === 5) pos += 4;
            else return null;
        }
        if (kind < 1 || kind > KINDS.length || pos > body.length) return null;
        e.kind = KINDS[kind - 1]!;
        return e;
    } catch {
        return null;
    }
}
