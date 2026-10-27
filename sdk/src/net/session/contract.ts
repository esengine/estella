// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    contract.ts
 * @brief   One definition of every request and event a game's client and server
 *          exchange. The server's handlers and the client's calls are typed from
 *          it, requests are checked on arrival, and replies are checked on
 *          receipt — so a client built before a change cannot half-understand a
 *          server built after it.
 */
import type { MessageHandler, PayloadCodec, RequestCodec } from '../NetChannel';
import { hashSeed } from '../../math/random';
import type { ClientSession, SessionRequestOptions } from './ClientSession';
import type { ServerSession, SessionContext, SessionHost } from './SessionHost';
import { SchemaError, type Infer, type Schema } from './schema';
import { codecOf, jsonCodec } from './proto';

export interface RequestDef<Req = unknown, Res = unknown> {
    req: Schema<Req>;
    res: Schema<Res>;
}

// `any` here, not `unknown`: a schema's type is read out of it by inference, and
// `Schema<{ ... }>` is not assignable to `Schema<unknown>` through its `parse`.
type RequestDefs = Record<string, RequestDef<any, any>>;
type EventDefs = Record<string, Schema<any>>;

type ReqOf<D> = D extends RequestDef<infer Q, unknown> ? Q : never;
type ResOf<D> = D extends RequestDef<unknown, infer R> ? R : never;

/** What the server writes for each request: the parsed payload in, the reply out. */
export type ContractImpl<R extends RequestDefs, Ctx extends SessionContext> = {
    [K in keyof R]: (payload: ReqOf<R[K]>, ctx: Ctx, session: ServerSession<Ctx>) => ResOf<R[K]> | Promise<ResOf<R[K]>>;
};

/** What the client calls for each request. */
export type ContractClient<R extends RequestDefs> = {
    [K in keyof R]: (payload: ReqOf<R[K]>, options?: SessionRequestOptions) => Promise<ResOf<R[K]>>;
};

export interface Contract<R extends RequestDefs, E extends EventDefs> {
    /**
     * A short stable text for the whole definition. Send it in the hello's
     * credentials and compare on the server to turn away a client built against
     * a different contract, instead of failing on its first odd request.
     */
    readonly fingerprint: string;
    /** Register every request on the host, each checked against its schema. */
    serve<Ctx extends SessionContext>(host: SessionHost<Ctx>, impl: ContractImpl<R, Ctx>): () => void;
    /** Typed calls over a session; replies are checked before they are returned. */
    client(session: ClientSession): ContractClient<R>;
    /** Send a typed event to one player. */
    push<K extends keyof E & string>(host: SessionHost<never>, playerId: string, type: K, payload: Infer<E[K]>): boolean;
    /** Send a typed event to every player on the host. */
    broadcast<K extends keyof E & string, Ctx extends SessionContext>(
        host: SessionHost<Ctx>, type: K, payload: Infer<E[K]>, filter?: (ctx: Ctx) => boolean,
    ): number;
    /** Subscribe to a typed event on the client; payloads are checked before the handler sees them. */
    on<K extends keyof E & string>(session: ClientSession, type: K, handler: MessageHandler<Infer<E[K]>>): () => void;
}

/** How a request travels on the protobuf wire: the codecs its schemas bring, JSON for a side that has none, nothing when neither has. */
function requestCodec(entry: RequestDef<any, any>): RequestCodec<any, any> | undefined {
    const req = codecOf(entry.req);
    const res = codecOf(entry.res);
    if (!req && !res) return undefined;
    return { req: req ?? jsonCodec, res: res ?? jsonCodec };
}

export function defineContract<R extends RequestDefs, E extends EventDefs = Record<never, never>>(
    def: { requests: R; events?: E },
): Contract<R, E> {
    const events = (def.events ?? {}) as E;
    const requestNames = Object.keys(def.requests);
    const eventNames = Object.keys(events);
    const description = [
        ...requestNames.map((n) => `${n}(${def.requests[n]!.req.describe()})=>${def.requests[n]!.res.describe()}`),
        ...eventNames.map((n) => `event ${n}(${events[n]!.describe()})`),
    ].join(';');
    const fingerprint = hashSeed(description).toString(16).padStart(8, '0');

    return {
        fingerprint,

        serve(host, impl) {
            const offs = requestNames.map((name) => {
                const entry = def.requests[name]!;
                const run = impl[name];
                if (!run) throw new Error(`[contract] no implementation for request "${name}"`);
                return host.handle(name, async (raw, ctx, session) => {
                    let payload: unknown;
                    try {
                        payload = entry.req.parse(raw);
                    } catch (err) {
                        if (err instanceof SchemaError) throw new Error(`invalid ${name} request: ${err.message}`);
                        throw err;
                    }
                    const result = await (run as (p: unknown, c: typeof ctx, s: typeof session) => unknown)(payload, ctx, session);
                    // A reply that breaks the contract is the server's bug; say so loudly
                    // here rather than let a client discover it.
                    try {
                        return entry.res.parse(result);
                    } catch (err) {
                        if (err instanceof SchemaError) throw new Error(`server bug: ${name} replied with ${err.message}`);
                        throw err;
                    }
                }, requestCodec(entry));
            });
            const unknown = Object.keys(impl).filter((k) => !requestNames.includes(k));
            if (unknown.length > 0) {
                for (const off of offs) off();
                throw new Error(`[contract] implementation has requests the contract does not: ${unknown.join(', ')}`);
            }
            return () => { for (const off of offs) off(); };
        },

        client(session) {
            const out: Record<string, unknown> = {};
            for (const name of requestNames) {
                const entry = def.requests[name]!;
                out[name] = async (payload: unknown, options?: SessionRequestOptions) => {
                    const checked = (entry.req as Schema<unknown>).parse(payload);
                    const reply = await session.request(name, checked, { ...options, codec: requestCodec(entry) });
                    return entry.res.parse(reply);
                };
            }
            return out as ContractClient<R>;
        },

        push(host, playerId, type, payload) {
            return host.push(playerId, type, events[type]!.parse(payload), codecOf(events[type]!) as PayloadCodec<never> | undefined);
        },

        broadcast(host, type, payload, filter) {
            return host.broadcast(type, events[type]!.parse(payload), filter, codecOf(events[type]!) as PayloadCodec<never> | undefined);
        },

        on(session, type, handler) {
            const schema = events[type];
            if (!schema) throw new Error(`[contract] no event "${type}"`);
            return session.on(type, (raw) => {
                let payload: Infer<E[typeof type]>;
                try { payload = schema.parse(raw) as Infer<E[typeof type]>; } catch { return; }
                handler(payload);
            }, codecOf(schema));
        },
    };
}
