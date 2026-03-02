import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Storage } from '../src/storage';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';

function createMockPlatform(): PlatformAdapter & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
        store,
        name: 'web',
        getStorageItem: (key: string) => store.get(key) ?? null,
        setStorageItem: (key: string, value: string) => { store.set(key, value); },
        removeStorageItem: (key: string) => { store.delete(key); },
        clearStorage: (prefix: string) => {
            for (const k of [...store.keys()]) {
                if (k.startsWith(prefix)) store.delete(k);
            }
        },
        fetch: vi.fn() as any,
        readFile: vi.fn() as any,
        readTextFile: vi.fn() as any,
        fileExists: vi.fn() as any,
        loadImagePixels: vi.fn() as any,
        instantiateWasm: vi.fn() as any,
        createCanvas: vi.fn() as any,
        now: vi.fn(() => 0),
        createImage: vi.fn() as any,
        bindInputEvents: vi.fn(),
        createAudioBackend: vi.fn() as any,
    };
}

describe('Storage', () => {
    let mock: ReturnType<typeof createMockPlatform>;

    beforeEach(() => {
        mock = createMockPlatform();
        setPlatform(mock);
    });

    describe('getString / setString', () => {
        it('should return undefined for missing key', () => {
            expect(Storage.getString('missing')).toBeUndefined();
        });

        it('should return defaultValue for missing key', () => {
            expect(Storage.getString('missing', 'fallback')).toBe('fallback');
        });

        it('should store and retrieve a string', () => {
            Storage.setString('name', 'Alice');
            expect(Storage.getString('name')).toBe('Alice');
        });

        it('should store empty string', () => {
            Storage.setString('empty', '');
            expect(Storage.getString('empty')).toBe('');
        });
    });

    describe('getNumber / setNumber', () => {
        it('should return undefined for missing key', () => {
            expect(Storage.getNumber('missing')).toBeUndefined();
        });

        it('should return defaultValue for missing key', () => {
            expect(Storage.getNumber('missing', 42)).toBe(42);
        });

        it('should store and retrieve a number', () => {
            Storage.setNumber('score', 100);
            expect(Storage.getNumber('score')).toBe(100);
        });

        it('should handle float numbers', () => {
            Storage.setNumber('pi', 3.14);
            expect(Storage.getNumber('pi')).toBeCloseTo(3.14);
        });

        it('should handle negative numbers', () => {
            Storage.setNumber('neg', -5);
            expect(Storage.getNumber('neg')).toBe(-5);
        });

        it('should return defaultValue for corrupted number', () => {
            mock.store.set('esengine:bad', 'not_a_number');
            expect(Storage.getNumber('bad', 0)).toBe(0);
        });
    });

    describe('getBoolean / setBoolean', () => {
        it('should return undefined for missing key', () => {
            expect(Storage.getBoolean('missing')).toBeUndefined();
        });

        it('should return defaultValue for missing key', () => {
            expect(Storage.getBoolean('missing', true)).toBe(true);
        });

        it('should store and retrieve true', () => {
            Storage.setBoolean('flag', true);
            expect(Storage.getBoolean('flag')).toBe(true);
        });

        it('should store and retrieve false', () => {
            Storage.setBoolean('flag', false);
            expect(Storage.getBoolean('flag')).toBe(false);
        });
    });

    describe('getJSON / setJSON', () => {
        it('should return undefined for missing key', () => {
            expect(Storage.getJSON('missing')).toBeUndefined();
        });

        it('should return defaultValue for missing key', () => {
            expect(Storage.getJSON('missing', { x: 1 })).toEqual({ x: 1 });
        });

        it('should store and retrieve an object', () => {
            const data = { health: 100, position: { x: 10, y: 20 } };
            Storage.setJSON('player', data);
            expect(Storage.getJSON('player')).toEqual(data);
        });

        it('should store and retrieve an array', () => {
            Storage.setJSON('items', [1, 2, 3]);
            expect(Storage.getJSON('items')).toEqual([1, 2, 3]);
        });

        it('should return defaultValue for corrupted JSON', () => {
            mock.store.set('esengine:bad', '{invalid json}');
            expect(Storage.getJSON('bad', [])).toEqual([]);
        });
    });

    describe('remove', () => {
        it('should remove a stored key', () => {
            Storage.setString('key', 'value');
            Storage.remove('key');
            expect(Storage.getString('key')).toBeUndefined();
        });

        it('should not throw when removing non-existent key', () => {
            expect(() => Storage.remove('nope')).not.toThrow();
        });
    });

    describe('has', () => {
        it('should return false for missing key', () => {
            expect(Storage.has('missing')).toBe(false);
        });

        it('should return true for existing key', () => {
            Storage.setString('key', 'val');
            expect(Storage.has('key')).toBe(true);
        });
    });

    describe('clear', () => {
        it('should remove all esengine keys', () => {
            Storage.setString('a', '1');
            Storage.setNumber('b', 2);
            Storage.clear();
            expect(Storage.has('a')).toBe(false);
            expect(Storage.has('b')).toBe(false);
        });
    });

    describe('key prefix isolation', () => {
        it('should prefix keys with esengine:', () => {
            Storage.setString('mykey', 'val');
            expect(mock.store.has('esengine:mykey')).toBe(true);
            expect(mock.store.has('mykey')).toBe(false);
        });
    });
});
