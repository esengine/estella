// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TokenBook.ts
 * @brief   Sign-in by a token handed to each player: the simplest accounts a game server can have, for
 *          a test with people the game's maker knows. The book is a JSON value the server reads from a
 *          file it keeps beside its save, never from the game's code, so a deployed server has its own
 *          players and a token in the repository opens nothing. A game with real accounts (a platform's
 *          sign-in, its own register) writes its own `authenticate` and does not use this.
 */

export interface TokenAccount {
    /** The player's id, as the game keys what it saves: letters, digits, `.`, `_` and `-`, at most 64. */
    id: string;
    /** What other players see. Default: the id. */
    name: string;
    token: string;
}

/** Tokens shorter than this are refused: one a person can guess is not a sign-in. */
export const MIN_TOKEN_LENGTH = 16;
const ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Every character of both is read, whatever they hold, so how long a check takes says nothing of how near a guess came. */
function same(a: string, b: string): boolean {
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
    return diff === 0;
}

export class TokenBook {
    private readonly byId_ = new Map<string, TokenAccount>();

    /**
     * A book from `{ "accounts": [{ "id", "name"?, "token" }] }` (or the bare list). Anything wrong in it
     * throws, naming the entry: a server is not started with players silently missing from its book.
     */
    static parse(raw: unknown): TokenBook {
        const list = Array.isArray(raw) ? raw : (raw as { accounts?: unknown } | null)?.accounts;
        if (!Array.isArray(list)) throw new Error('token book: expected { "accounts": [ { "id", "token" } ] }');
        const book = new TokenBook();
        list.forEach((entry, i) => {
            const e = entry as Partial<TokenAccount> | null;
            const where = `token book: account ${i + 1}`;
            if (!e || typeof e.id !== 'string' || !ID.test(e.id)) throw new Error(`${where} needs an id of letters, digits, ".", "_" or "-" (at most 64)`);
            if (book.byId_.has(e.id)) throw new Error(`${where}: "${e.id}" is named twice`);
            if (typeof e.token !== 'string' || e.token.length < MIN_TOKEN_LENGTH) throw new Error(`${where} ("${e.id}") needs a token of at least ${MIN_TOKEN_LENGTH} characters`);
            const name = typeof e.name === 'string' && e.name.trim() !== '' ? e.name : e.id;
            book.byId_.set(e.id, { id: e.id, name, token: e.token });
        });
        if (book.byId_.size === 0) throw new Error('token book: no accounts');
        return book;
    }

    /** The account these credentials sign in as, or `null`. Wrong id and wrong token are not told apart. */
    check(id: unknown, token: unknown): TokenAccount | null {
        if (typeof id !== 'string' || typeof token !== 'string') return null;
        const account = this.byId_.get(id);
        const matches = same(token, account?.token ?? '\u0000'.repeat(MIN_TOKEN_LENGTH));
        return account && matches ? account : null;
    }

    get accounts(): readonly TokenAccount[] {
        return [...this.byId_.values()];
    }
}

/** A token to hand a player: 24 random bytes, base64url, 32 characters. */
export function newToken(): string {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
