// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { EmbeddedBackend, HttpBackend } from '../src/asset/Backend';

describe('HttpBackend', () => {
    it('resolves relative paths with baseUrl', () => {
        const backend = new HttpBackend({ baseUrl: 'http://localhost:3456/assets' });
        expect(backend.resolveUrl('sprites/hero.png')).toBe('http://localhost:3456/assets/sprites/hero.png');
    });

    it('passes through absolute URLs', () => {
        const backend = new HttpBackend({ baseUrl: 'http://localhost:3456' });
        expect(backend.resolveUrl('https://cdn.example.com/image.png')).toBe('https://cdn.example.com/image.png');
        expect(backend.resolveUrl('http://other.com/file.json')).toBe('http://other.com/file.json');
        expect(backend.resolveUrl('/absolute/path.png')).toBe('/absolute/path.png');
    });

    it('strips trailing slashes from baseUrl', () => {
        const backend = new HttpBackend({ baseUrl: 'http://localhost:3456/' });
        expect(backend.resolveUrl('sprites/hero.png')).toBe('http://localhost:3456/sprites/hero.png');
    });

    it('encodes an indexed filename without encoding actual URL suffixes', () => {
        const backend = new HttpBackend({ baseUrl: '' });
        backend.setBaseUrl('estella://project', file => file === 'assets/frame%20.png#night.png');
        const literal = 'estella://project/assets/frame%2520.png%23night.png';
        expect(backend.resolveUrl('assets/frame%20.png#night.png')).toBe(literal);
        expect(backend.resolveUrl(literal)).toBe(literal);
        expect(backend.resolveUrl('assets/frame.png?v=2#night')).toBe('estella://project/assets/frame.png?v=2#night');
    });
});

describe('EmbeddedBackend', () => {
    const textDataUrl = 'data:text/plain;base64,' + btoa('hello world');
    const binaryDataUrl = 'data:application/octet-stream;base64,' + btoa('\x01\x02\x03');
    const backend = new EmbeddedBackend({
        'config.txt': textDataUrl,
        'data.bin': binaryDataUrl,
    });

    it('fetchText decodes base64 data URL', async () => {
        const text = await backend.fetchText('config.txt');
        expect(text).toBe('hello world');
    });

    it('fetchBinary decodes base64 data URL', async () => {
        const buffer = await backend.fetchBinary('data.bin');
        const bytes = new Uint8Array(buffer);
        expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('throws on missing asset', async () => {
        await expect(backend.fetchText('missing.txt')).rejects.toThrow('asset not found');
    });

    it('has returns true for existing assets', () => {
        expect(backend.has('config.txt')).toBe(true);
        expect(backend.has('missing.txt')).toBe(false);
    });

    it('resolveUrl returns data URL for existing assets', () => {
        expect(backend.resolveUrl('config.txt')).toBe(textDataUrl);
    });

    it('resolveUrl returns path as-is for missing assets', () => {
        expect(backend.resolveUrl('missing.txt')).toBe('missing.txt');
    });

    // Regression: typed text/binary assets load via `fetchText(resolveUrl(ref))`
    // (idempotent for HttpBackend). resolveUrl already returns the data URL here, so
    // fetch must accept it instead of re-looking it up as a key — otherwise embedded
    // tilemaps/materials fail in playable builds with "asset not found: data:...".
    it('fetch is idempotent under resolveUrl (resolve-then-fetch)', async () => {
        expect(await backend.fetchText(backend.resolveUrl('config.txt'))).toBe('hello world');
        const bytes = new Uint8Array(await backend.fetchBinary(backend.resolveUrl('data.bin')));
        expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    });

    it.each(['星图', ''])('reads embedded text %j by path and by URL', async content => {
        const embedded = new EmbeddedBackend({ 'atlas.json': content });
        const url = embedded.resolveUrl('atlas.json');
        expect(await embedded.fetchText('atlas.json')).toBe(content);
        expect(await embedded.fetchText(url)).toBe(content);
        expect(new Uint8Array(await embedded.fetchBinary(url))).toEqual(new TextEncoder().encode(content));
    });
});
