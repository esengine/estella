// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    proto.ts
 * @brief   A protobuf message as a contract schema. The `.proto` file is the definition: the
 *          generated message (estella proto gen) brings its codec and its shape, and the
 *          contract takes both from it instead of repeating the fields in a second place.
 */
import type { PayloadCodec } from '../wire';
import type { Schema } from './schema';

/** What the generator writes for each message: a codec, plus a text naming its fields. */
export interface ProtoMessage<T> extends PayloadCodec<T> {
    /** The message's fields written as text, so two builds can tell whether they agree. */
    readonly shape: string;
}

export interface ProtoSchema<T> extends Schema<T> {
    readonly codec: PayloadCodec<T>;
}

/**
 * Use a generated message as a request, reply or event type. A value that reaches the contract has
 * already been read and checked by the message's own codec, so `check` is for what a `.proto` cannot say:
 * ranges, lengths, relations between fields. Throw from it to refuse.
 */
export function proto<T>(message: ProtoMessage<T>, check?: (value: T) => void): ProtoSchema<T> {
    return {
        codec: message,
        parse(value) {
            check?.(value as T);
            return value as T;
        },
        describe: () => `proto(${message.shape})`,
    };
}

/**
 * Use a generated message as the wire form of a type the game already has. `view.to` turns the game's value into
 * the message to send, `view.from` the message that arrived into the game's value, so game code keeps its own types
 * (string unions, records) and only the contract knows the message. `check` runs on the game's value.
 */
export function protoAs<T, W>(message: ProtoMessage<W>, view: { to(value: T): W; from(wire: W): T }, check?: (value: T) => void): ProtoSchema<T> {
    return {
        codec: {
            encode: (value) => message.encode(view.to(value)),
            decode: (bytes) => view.from(message.decode(bytes)),
            toJSON: (value) => message.toJSON(view.to(value)),
            fromJSON: (json) => view.from(message.fromJSON(json)),
        },
        parse(value) {
            check?.(value as T);
            return value as T;
        },
        describe: () => `proto(${message.shape})`,
    };
}

const utf8 = new TextEncoder();
const utf8Back = new TextDecoder();

/** Plain JSON in both directions: stands in for the side of a request that is not a `proto`. */
export const jsonCodec: PayloadCodec = {
    encode: (value) => utf8.encode(JSON.stringify(value)),
    decode: (bytes) => JSON.parse(utf8Back.decode(bytes)),
    toJSON: (value) => value,
    fromJSON: (json) => json,
};

/** The codec a schema brings, if it is a {@link proto}. */
export function codecOf<T>(schema: Schema<T>): PayloadCodec<T> | undefined {
    return (schema as Partial<ProtoSchema<T>>).codec;
}
