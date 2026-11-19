// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tickets.ts
 * @brief   One-use passes from one zone to another. The zone a player leaves
 *          writes a ticket naming the player, the zone they may enter and
 *          whatever the arrival needs (a spawn point, a portal id); the client
 *          shows it to that zone, which redeems it — once, before it expires.
 *          The ticket id is random and long, so knowing the scheme does not
 *          let a client make one up.
 */
import { PersistConflict, type PersistStore } from '../persist/store';

export interface TransferTicket<A = unknown> {
    playerId: string;
    /** The zone it admits to; any other refuses it. */
    toZone: string;
    fromZone: string;
    /** What the arriving zone needs to place the player: the game's. */
    arrival: A;
    /** Epoch ms after which it is refused. */
    expires: number;
}

export interface TransferTicketsOptions {
    store: PersistStore;
    /** How long a ticket is good for. Default 30 s. */
    ttlMs?: number;
    /** Key prefix in the store. Default `ticket:`. */
    prefix?: string;
    now?: () => number;
}

/** Why a ticket was refused. */
export class TicketRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TicketRefused';
    }
}

function randomId(): string {
    const bytes = new Uint8Array(18);
    const crypto = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
    if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

export class TransferTickets {
    private readonly store_: PersistStore;
    private readonly ttlMs_: number;
    private readonly prefix_: string;
    private readonly now_: () => number;

    constructor(options: TransferTicketsOptions) {
        this.store_ = options.store;
        this.ttlMs_ = options.ttlMs ?? 30_000;
        this.prefix_ = options.prefix ?? 'ticket:';
        this.now_ = options.now ?? Date.now;
    }

    /** Write a ticket and return its id, which is what the client carries. */
    async issue<A>(ticket: Omit<TransferTicket<A>, 'expires'>): Promise<string> {
        const id = randomId();
        await this.store_.put<TransferTicket<A>>(this.prefix_ + id, { ...ticket, expires: this.now_() + this.ttlMs_ }, { expectVersion: 0 });
        return id;
    }

    /**
     * Use a ticket at `zoneId`: it is removed, so a second use fails. Throws
     * {@link TicketRefused} for an unknown, used, expired or wrong-zone ticket.
     */
    async redeem<A = unknown>(id: string, zoneId: string): Promise<TransferTicket<A>> {
        if (typeof id !== 'string' || !/^[0-9a-f]{36}$/.test(id)) throw new TicketRefused('not a ticket');
        const key = this.prefix_ + id;
        const doc = await this.store_.get<TransferTicket<A>>(key);
        if (!doc) throw new TicketRefused('unknown or used ticket');
        try {
            await this.store_.delete(key, { expectVersion: doc.version });
        } catch (err) {
            if (err instanceof PersistConflict) throw new TicketRefused('ticket already used');
            throw err;
        }
        if (doc.value.expires <= this.now_()) throw new TicketRefused('ticket expired');
        if (doc.value.toZone !== zoneId) throw new TicketRefused(`ticket is for zone "${doc.value.toZone}"`);
        return doc.value;
    }
}
