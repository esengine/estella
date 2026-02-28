import { describe, it, expect, beforeEach } from 'vitest';
import { defineResource, Res, ResMut, ResourceStorage, ResMutInstance } from '../src/resource';

describe('Resource System', () => {
    describe('defineResource', () => {
        it('should create a resource with initial data', () => {
            const Counter = defineResource({ count: 0 }, 'Counter');

            expect(Counter._name).toBe('Counter');
            expect(Counter._default).toEqual({ count: 0 });
        });

        it('should create a resource with complex data', () => {
            const GameState = defineResource({
                score: 0,
                level: 1,
                paused: false,
                playerName: 'Player',
            }, 'GameState');

            expect(GameState._default).toEqual({
                score: 0,
                level: 1,
                paused: false,
                playerName: 'Player',
            });
        });

        it('should create a resource with empty data', () => {
            const EmptyResource = defineResource({}, 'EmptyResource');

            expect(EmptyResource._default).toEqual({});
        });
    });

    describe('Res descriptor', () => {
        it('should create immutable resource descriptor', () => {
            const Counter = defineResource({ count: 0 }, 'Counter');
            const descriptor = Res(Counter);

            expect(descriptor).toBeDefined();
            expect(descriptor._resource).toBe(Counter);
        });
    });

    describe('ResMut descriptor', () => {
        it('should create mutable resource descriptor', () => {
            const Counter = defineResource({ count: 0 }, 'Counter');
            const descriptor = ResMut(Counter);

            expect(descriptor).toBeDefined();
            expect(descriptor._resource).toBe(Counter);
        });
    });

    describe('resource data types', () => {
        it('should support numeric resources', () => {
            const DeltaTime = defineResource({ value: 0.016 }, 'DeltaTime');

            expect(DeltaTime._default.value).toBe(0.016);
        });

        it('should support string resources', () => {
            const Config = defineResource({ apiKey: 'test-key' }, 'Config');

            expect(Config._default.apiKey).toBe('test-key');
        });

        it('should support boolean resources', () => {
            const DebugMode = defineResource({ enabled: false }, 'DebugMode');

            expect(DebugMode._default.enabled).toBe(false);
        });

        it('should support array resources', () => {
            const History = defineResource({ events: [] as string[] }, 'History');

            expect(Array.isArray(History._default.events)).toBe(true);
        });

        it('should support nested object resources', () => {
            const Settings = defineResource({
                audio: {
                    volume: 1.0,
                    muted: false,
                },
                graphics: {
                    quality: 'high',
                    vsync: true,
                },
            }, 'Settings');

            expect(Settings._default.audio.volume).toBe(1.0);
            expect(Settings._default.graphics.quality).toBe('high');
        });
    });

    describe('resource naming', () => {
        it('should support different naming conventions', () => {
            const CamelCase = defineResource({ value: 1 }, 'camelCase');
            const PascalCase = defineResource({ value: 2 }, 'PascalCase');
            const snake_case = defineResource({ value: 3 }, 'snake_case');

            expect(CamelCase._name).toBe('camelCase');
            expect(PascalCase._name).toBe('PascalCase');
            expect(snake_case._name).toBe('snake_case');
        });
    });

    describe('complex scenarios', () => {
        it('should handle multiple resources', () => {
            const Time = defineResource({ delta: 0, elapsed: 0 }, 'Time');
            const Input = defineResource({ mouseX: 0, mouseY: 0 }, 'Input');
            const Score = defineResource({ value: 0 }, 'Score');

            expect(Time._name).toBe('Time');
            expect(Input._name).toBe('Input');
            expect(Score._name).toBe('Score');
        });

        it('should support resource composition', () => {
            const Physics = defineResource({
                gravity: { x: 0, y: -9.8 },
                timeScale: 1.0,
                substeps: 4,
            }, 'Physics');

            expect(Physics._default.gravity.y).toBe(-9.8);
            expect(Physics._default.substeps).toBe(4);
        });
    });

    describe('defineResource auto-naming', () => {
        it('should generate a name when none provided', () => {
            const res = defineResource({ v: 0 });
            expect(res._name).toMatch(/^Resource_\d+$/);
        });
    });
});

// =============================================================================
// ResourceStorage
// =============================================================================

describe('ResourceStorage', () => {
    let storage: ResourceStorage;
    const Counter = defineResource({ count: 0 }, 'StorageCounter');
    const Config = defineResource({ debug: false }, 'StorageConfig');

    beforeEach(() => {
        storage = new ResourceStorage();
    });

    describe('insert and get', () => {
        it('should store and retrieve a resource', () => {
            storage.insert(Counter, { count: 42 });
            expect(storage.get(Counter)).toEqual({ count: 42 });
        });

        it('should return default when not inserted', () => {
            expect(storage.get(Counter)).toEqual({ count: 0 });
        });

        it('should overwrite on re-insert', () => {
            storage.insert(Counter, { count: 1 });
            storage.insert(Counter, { count: 2 });
            expect(storage.get(Counter)).toEqual({ count: 2 });
        });
    });

    describe('set', () => {
        it('should set a resource value', () => {
            storage.set(Counter, { count: 99 });
            expect(storage.get(Counter)).toEqual({ count: 99 });
        });
    });

    describe('has', () => {
        it('should return false for missing resource', () => {
            expect(storage.has(Counter)).toBe(false);
        });

        it('should return true after insert', () => {
            storage.insert(Counter, { count: 0 });
            expect(storage.has(Counter)).toBe(true);
        });
    });

    describe('remove', () => {
        it('should remove an inserted resource', () => {
            storage.insert(Counter, { count: 10 });
            storage.remove(Counter);
            expect(storage.has(Counter)).toBe(false);
        });

        it('should return default after removal', () => {
            storage.insert(Counter, { count: 10 });
            storage.remove(Counter);
            expect(storage.get(Counter)).toEqual({ count: 0 });
        });
    });

    describe('getResMut', () => {
        it('should return a ResMutInstance', () => {
            storage.insert(Counter, { count: 5 });
            const mut = storage.getResMut(Counter);
            expect(mut).toBeInstanceOf(ResMutInstance);
            expect(mut.get()).toEqual({ count: 5 });
        });

        it('should set value back to storage', () => {
            storage.insert(Counter, { count: 0 });
            const mut = storage.getResMut(Counter);
            mut.set({ count: 42 });
            expect(storage.get(Counter)).toEqual({ count: 42 });
        });

        it('should modify value in-place', () => {
            storage.insert(Counter, { count: 10 });
            const mut = storage.getResMut(Counter);
            mut.modify((v) => { v.count += 5; });
            expect(storage.get(Counter)).toEqual({ count: 15 });
        });

        it('should reuse the same ResMutInstance on subsequent calls', () => {
            storage.insert(Counter, { count: 0 });
            const mut1 = storage.getResMut(Counter);
            const mut2 = storage.getResMut(Counter);
            expect(mut1).toBe(mut2);
        });

        it('should update cached instance value on subsequent call', () => {
            storage.insert(Counter, { count: 1 });
            const mut = storage.getResMut(Counter);
            storage.set(Counter, { count: 99 });
            const mut2 = storage.getResMut(Counter);
            expect(mut2.get()).toEqual({ count: 99 });
        });

        it('should use default when resource not inserted', () => {
            const mut = storage.getResMut(Counter);
            expect(mut.get()).toEqual({ count: 0 });
        });

        it('should cleanup pool on remove', () => {
            storage.insert(Counter, { count: 1 });
            const mut1 = storage.getResMut(Counter);
            storage.remove(Counter);
            const mut2 = storage.getResMut(Counter);
            expect(mut1).not.toBe(mut2);
        });
    });

    describe('multiple resources', () => {
        it('should store different resources independently', () => {
            storage.insert(Counter, { count: 10 });
            storage.insert(Config, { debug: true });
            expect(storage.get(Counter)).toEqual({ count: 10 });
            expect(storage.get(Config)).toEqual({ debug: true });
        });
    });
});
