// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    protocol.ts
 * @brief   The one handshake a session runs before any game request: the client
 *          names itself, the server decides who it is and tells it the time.
 */

/** Bumped when the hello changes shape; a mismatch refuses the connection. */
export const SESSION_PROTOCOL_VERSION = 1;

/** The request type of the handshake. Nothing else is served before it succeeds. */
export const SESSION_HELLO = 'session:hello';

/** Close codes the server uses, so a client can tell why it was let go. */
export const SessionCloseCode = {
    /** Another connection for the same player took this one's place. */
    replaced: 4001,
    /** No valid hello arrived in time. */
    helloTimeout: 4002,
    /** The server is full or shutting down; try later. */
    unavailable: 4003,
    /** The peer kept breaking the frame or rate limits. */
    abuse: 4004,
} as const;

export interface SessionHelloRequest {
    version: number;
    /** The encoding the client wants to speak after the hello. Absent means JSON. */
    wire?: 'json' | 'pb';
    /** Whatever the game's `authenticate` understands: a token, a device id. */
    credentials: unknown;
}

export type SessionHelloResponse =
    | {
        ok: true;
        playerId: string;
        /** The server's clock at the moment it answered, in epoch milliseconds. */
        serverTimeMs: number;
        /** The encoding both ends write from now on. Absent means JSON. */
        wire?: 'json' | 'pb';
        /** Anything the game wants the client to have at once (a renewed token). */
        data?: unknown;
    }
    | { ok: false; error: string; /** Retrying cannot help; the client stops. */ fatal: boolean };
