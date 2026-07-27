// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Protocol-buffer encoding, write side only.
//
// An Android App Bundle is protobuf where an APK is binary XML: the same manifest
// in a different encoding, plus a couple of small config messages. Writing them
// needs the wire format — varints and length-delimited fields — and nothing else:
// no schema compiler, no runtime, no descriptors. Reading is not needed, and a
// dependency that could do both would be far more surface than this.

/** A varint: seven bits per byte, high bit continues. */
export function varint(value) {
    const out = [];
    let n = BigInt(value);
    if (n < 0n) n += 1n << 64n;   // negative int32/int64 are sign-extended to 64 bits
    do {
        const byte = Number(n & 0x7fn);
        n >>= 7n;
        out.push(n > 0n ? byte | 0x80 : byte);
    } while (n > 0n);
    return Buffer.from(out);
}

const tag = (field, wireType) => varint((field << 3) | wireType);

/** A length-delimited field: a string, a byte string, or a nested message. */
export function bytesField(field, value) {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    return Buffer.concat([tag(field, 2), varint(body.length), body]);
}

/** A varint field. Omitted when the value is the proto3 default: an encoder that
 *  writes zeros produces bytes a decoder cannot tell from "unset", and for a
 *  `oneof` that difference is the whole point. */
export function varintField(field, value) {
    return Buffer.concat([tag(field, 0), varint(value)]);
}

export function boolField(field, value) {
    return varintField(field, value ? 1 : 0);
}

/** A message: its fields concatenated, in field order. */
export function message(...fields) {
    return Buffer.concat(fields.flat().filter((f) => f && f.length > 0));
}
