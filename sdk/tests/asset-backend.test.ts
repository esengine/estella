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
});
