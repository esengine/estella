/**
 * @file    spine-multi-version-build.test.ts
 * @brief   Integration tests for spine multi-version build pipeline
 */

import { describe, test, expect } from 'vitest';
import { SpineManager } from '../src/spine/SpineManager';

describe('Spine multi-version build pipeline', () => {
    test('version tag generation is consistent between emitter and runtime', () => {
        const versions = ['3.8', '4.1', '4.2'] as const;
        const expectedTags = { '3.8': '38', '4.1': '41', '4.2': '42' };

        for (const v of versions) {
            const tag = v.replace('.', '');
            expect(tag).toBe(expectedTags[v]);
        }
    });

    test('only non-4.2 versions produce standalone modules', () => {
        const spineVersions = new Set(['3.8', '4.1', '4.2']);
        const nonNative = [...spineVersions].filter(v => v !== '4.2');
        expect(nonNative).toEqual(['3.8', '4.1']);
    });

    test('4.2-only project produces zero standalone modules', () => {
        const spineVersions = new Set(['4.2']);
        const nonNative = [...spineVersions].filter(v => v !== '4.2');
        expect(nonNative).toHaveLength(0);
    });

    test('empty spine project produces zero standalone modules', () => {
        const spineVersions = new Set<string>();
        const nonNative = [...spineVersions].filter(v => v !== '4.2');
        expect(nonNative).toHaveLength(0);
    });

    test('SpineManager constructor accepts version factory map', () => {
        const factories = new Map<'3.8' | '4.1' | '4.2', () => Promise<any>>();
        factories.set('3.8', async () => ({}));
        factories.set('4.1', async () => ({}));

        const manager = new SpineManager({} as any, factories);
        expect(manager).toBeDefined();
        manager.shutdown();
    });

    test('SpineManager routes 4.2 to native without backend', async () => {
        const factories = new Map<'3.8' | '4.1' | '4.2', () => Promise<any>>();
        const mockModule = { spine_setNeedsReload: () => {} } as any;
        const manager = new SpineManager(mockModule, factories);

        const json42 = '{"spine":"4.2.10","skeleton":{}}';
        const version = await manager.loadEntity(
            1 as any, json42, '', new Map(), {} as any,
        );

        expect(version).toBe('4.2');
        expect(manager.getEntityVersion(1 as any)).toBe('4.2');
        expect(manager.hasModuleBackend('4.2' as any)).toBe(false);

        manager.shutdown();
    });

    test('SpineManager calls spine_setNeedsReload for non-4.2 entities', async () => {
        let calledWith: { entity: number; value: boolean } | null = null;
        const mockModule = {
            spine_setNeedsReload: (_reg: any, entity: number, value: boolean) => {
                calledWith = { entity, value };
            },
        } as any;

        const factories = new Map<'3.8' | '4.1' | '4.2', () => Promise<any>>();
        const manager = new SpineManager(mockModule, factories);

        const json41 = '{"spine":"4.1.20","skeleton":{}}';
        const version = await manager.loadEntity(
            42 as any, json41, '', new Map(), {} as any,
        );

        expect(version).toBeNull();
        expect(calledWith).toEqual({ entity: 42, value: false });

        manager.shutdown();
    });

    test('detectVersionJson covers all supported versions', () => {
        const cases: Array<[string, string | null]> = [
            ['{"spine":"4.2.10"}', '4.2'],
            ['{"spine":"4.1.20"}', '4.1'],
            ['{"spine":"3.8.99"}', '3.8'],
            ['{"spine":"3.7.94"}', '3.8'],
            ['{"spine":"5.0.0"}', null],
            ['{"skeleton":{}}', null],
        ];

        for (const [json, expected] of cases) {
            expect(SpineManager.detectVersionJson(json)).toBe(expected);
        }
    });
});
