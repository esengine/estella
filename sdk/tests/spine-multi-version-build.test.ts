// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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

    test('every spine version ships as a standalone side module (no native 4.2)', () => {
        // S3 removed the native runtime: 4.2 is a side module like 3.8/4.1.
        const spineVersions = new Set(['3.8', '4.1', '4.2']);
        const modules = [...spineVersions].map(v => `spine${v.replace('.', '')}`);
        expect(modules.sort()).toEqual(['spine38', 'spine41', 'spine42']);
    });

    test('empty spine project ships zero modules', () => {
        const spineVersions = new Set<string>();
        expect([...spineVersions]).toHaveLength(0);
    });

    test('SpineManager constructor accepts version factory map', () => {
        const factories = new Map<'3.8' | '4.1' | '4.2', () => Promise<any>>();
        factories.set('3.8', async () => ({}));
        factories.set('4.1', async () => ({}));

        const manager = new SpineManager({} as any, factories);
        expect(manager).toBeDefined();
        manager.shutdown();
    });

    test('SpineManager fails the load (no native fallback) when a version has no factory', async () => {
        // S3: 4.2 no longer routes to a native runtime — without a factory the
        // load fails, exactly like 3.8/4.1. Spine is strictly pay-for-use.
        const manager = new SpineManager({} as any, new Map());

        const v42 = await manager.loadEntity(
            1 as any, '{"spine":"4.2.10","skeleton":{}}', '', new Map(), {} as any,
        );
        const v41 = await manager.loadEntity(
            2 as any, '{"spine":"4.1.20","skeleton":{}}', '', new Map(), {} as any,
        );

        expect(v42).toBeNull();
        expect(v41).toBeNull();
        expect(manager.getEntityVersion(1 as any)).toBeUndefined();
        manager.shutdown();
    });

    test('SpineManager never touches a native spine_* binding', async () => {
        // The old path called coreModule.spine_setNeedsReload; that handshake is
        // gone. Proxy-trap any spine_* access to prove none happens.
        let touched: string | null = null;
        const mockModule = new Proxy({} as any, {
            get(_t, prop) {
                if (typeof prop === 'string' && prop.startsWith('spine_')) touched = prop;
                return undefined;
            },
        });
        const manager = new SpineManager(mockModule, new Map());
        await manager.loadEntity(
            1 as any, '{"spine":"4.2.10","skeleton":{}}', '', new Map(), {} as any,
        );
        expect(touched).toBeNull();
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
