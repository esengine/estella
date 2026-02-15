import { describe, it, expect, beforeEach } from 'vitest';
import { defineResource, Res, ResMut } from '../src/resource';

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
});
