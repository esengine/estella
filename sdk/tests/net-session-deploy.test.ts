// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { MIN_TOKEN_LENGTH, TokenBook, newToken, serverAddress } from '../src/net/session';

describe('serverAddress', () => {
    const page = (protocol: string, host = 'play.example.com') => ({ protocol, host });

    it('is the page\'s own host at the server\'s path, secure when the page is', () => {
        expect(serverAddress({ path: '/sector', location: page('https:'), search: '' })).toBe('wss://play.example.com/sector');
        expect(serverAddress({ path: '/sector', location: page('http:', '127.0.0.1:8080'), search: '?account=a' })).toBe('ws://127.0.0.1:8080/sector');
    });

    it('takes ?server= over the page, and only a WebSocket address', () => {
        expect(serverAddress({ path: '/sector', location: page('https:'), search: '?server=ws%3A%2F%2F127.0.0.1%3A8090%2Fsector' })).toBe('ws://127.0.0.1:8090/sector');
        expect(serverAddress({ path: '/sector', location: page('https:'), search: '?server=javascript:alert(1)' })).toBe('wss://play.example.com/sector');
        expect(serverAddress({ path: '/s', location: page('https:'), search: '?relay=wss://r.example/s', param: 'relay' })).toBe('wss://r.example/s');
    });

    it('is null with no page to come from and no ?server=', () => {
        expect(serverAddress({ path: '/sector', location: null, search: '' })).toBeNull();
        expect(serverAddress({ path: '/sector', location: page('file:', ''), search: '' })).toBeNull();
        expect(serverAddress({ path: '/sector', location: null, search: '?server=wss://x.example/sector' })).toBe('wss://x.example/sector');
    });

    it('refuses a path that is not one', () => {
        for (const bad of ['sector', '/a b', '/a?b', '']) expect(() => serverAddress({ path: bad, location: null })).toThrow(/path/);
    });
});

describe('TokenBook', () => {
    const t = (c: string) => c.repeat(MIN_TOKEN_LENGTH);

    it('signs in the account whose token it is, and nobody on a wrong id or token', () => {
        const book = TokenBook.parse({ accounts: [{ id: 'ana', name: 'Ana', token: t('a') }, { id: 'bo', token: t('b') }] });
        expect(book.check('ana', t('a'))).toEqual({ id: 'ana', name: 'Ana', token: t('a') });
        expect(book.check('bo', t('b'))?.name).toBe('bo');
        expect(book.check('ana', t('b'))).toBeNull();
        expect(book.check('ana', `${t('a')}x`)).toBeNull();
        expect(book.check('cy', t('a'))).toBeNull();
        expect(book.check('ana', undefined)).toBeNull();
        expect(book.accounts.map((a) => a.id)).toEqual(['ana', 'bo']);
    });

    it('refuses a book with anything wrong in it, naming the entry', () => {
        expect(() => TokenBook.parse({})).toThrow(/accounts/);
        expect(() => TokenBook.parse({ accounts: [] })).toThrow(/no accounts/);
        expect(() => TokenBook.parse([{ id: 'a b', token: t('a') }])).toThrow(/account 1/);
        expect(() => TokenBook.parse([{ id: 'a', token: 'short' }])).toThrow(/"a".*16/);
        expect(() => TokenBook.parse([{ id: 'a', token: t('a') }, { id: 'a', token: t('b') }])).toThrow(/named twice/);
    });

    it('makes tokens a book accepts, each different', () => {
        const a = newToken(), b = newToken();
        expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(a).not.toBe(b);
        expect(TokenBook.parse([{ id: 'p', token: a }]).check('p', a)?.id).toBe('p');
    });
});
