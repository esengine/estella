import { describe, it, expect } from 'vitest';
import { SpineManager } from '../src/spine/SpineManager';

function writeVarint(value: number): number[] {
    const bytes: number[] = [];
    do {
        let b = value & 0x7F;
        value >>>= 7;
        if (value) b |= 0x80;
        bytes.push(b);
    } while (value);
    return bytes;
}

function makeString(str: string): number[] {
    const encoded = new TextEncoder().encode(str);
    const len = encoded.length + 1;
    return [...writeVarint(len), ...encoded];
}

function make4xSkel(version: string): Uint8Array {
    const hash = [0, 0, 0, 0, 0, 0, 0, 0];
    const verBytes = makeString(version);
    return new Uint8Array([...hash, ...verBytes]);
}

function make3xSkel(hash: string, version: string): Uint8Array {
    const hashBytes = makeString(hash);
    const verBytes = makeString(version);
    return new Uint8Array([...hashBytes, ...verBytes]);
}

describe('SpineManager.detectVersion', () => {
    it('detects 4.2 binary', () => {
        const data = make4xSkel('4.2.18');
        expect(SpineManager.detectVersion(data)).toBe('4.2');
    });

    it('detects 4.1 binary', () => {
        const data = make4xSkel('4.1.24');
        expect(SpineManager.detectVersion(data)).toBe('4.1');
    });

    it('detects 3.8 binary', () => {
        const data = make3xSkel('abc123', '3.8.99');
        expect(SpineManager.detectVersion(data)).toBe('3.8');
    });

    it('returns null for unknown version', () => {
        const data = make4xSkel('5.0.0');
        expect(SpineManager.detectVersion(data)).toBeNull();
    });

    it('returns null for empty data', () => {
        expect(SpineManager.detectVersion(new Uint8Array(0))).toBeNull();
    });
});

describe('SpineManager.detectVersionJson', () => {
    it('detects 4.2 json', () => {
        expect(SpineManager.detectVersionJson('{"spine": "4.2.18"}')).toBe('4.2');
    });

    it('detects 4.1 json', () => {
        expect(SpineManager.detectVersionJson('{"spine": "4.1.24"}')).toBe('4.1');
    });

    it('detects 3.8 json', () => {
        expect(SpineManager.detectVersionJson('{"spine": "3.8.99"}')).toBe('3.8');
    });

    it('returns null for missing spine field', () => {
        expect(SpineManager.detectVersionJson('{"version": "1.0"}')).toBeNull();
    });
});
