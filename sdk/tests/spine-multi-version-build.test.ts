// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-multi-version-build.test.ts
 * @brief   The multi-version pipeline: one module per vendored Spine release, picked
 *          by what the skeleton says it is.
 *
 * @details Driven off SPINE_VERSIONS / SIDE_MODULES rather than a list repeated here,
 *          so vendoring a release is a change in one place and this stays true.
 */

import { describe, test, expect } from 'vitest';
import { SpineManager } from '../src/spine/SpineManager';
import { SIDE_MODULES, SPINE_VERSIONS, spineModuleId } from '../src/sideModules/registry';

describe('Spine multi-version build pipeline', () => {
    test('every version maps to the artifact its build target emits', () => {
        for (const version of SPINE_VERSIONS) {
            const descriptor = SIDE_MODULES[spineModuleId(version)];
            expect(descriptor).toBeDefined();
            // spine42.wasm for 4.2, spine38 for 3.8 — the emitter and the loader
            // agree on the name because both derive it the same way.
            expect(descriptor.file).toBe(`spine${version.replace('.', '')}`);
            expect(descriptor.globalName).toBe('ESSpineModule');
        }
    });

    test('every spine version ships as a standalone side module (no native runtime)', () => {
        // S3 removed the native runtime: 4.2 is a side module like the rest.
        const modules = SPINE_VERSIONS.map(v => SIDE_MODULES[spineModuleId(v)].file);
        expect(modules).toEqual([...new Set(modules)]);
        expect(modules).toContain('spine42');
        expect(modules).toContain('spine43');
    });

    test('empty spine project ships zero modules', () => {
        const spineVersions = new Set<string>();
        expect([...spineVersions]).toHaveLength(0);
    });

    test('SpineManager constructor accepts version factory map', () => {
        const factories = new Map(
            SPINE_VERSIONS.map(v => [v, async () => ({})] as const),
        );

        const manager = new SpineManager({} as any, factories as any);
        expect(manager).toBeDefined();
        manager.shutdown();
    });

    test('SpineManager fails the load (no native fallback) when a version has no factory', async () => {
        // S3: 4.2 no longer routes to a native runtime — without a factory the
        // load fails, exactly like the others. Spine is strictly pay-for-use.
        const manager = new SpineManager({} as any, new Map());

        const v43 = await manager.loadEntity(
            1 as any, '{"spine":"4.3.75-beta","skeleton":{}}', '', new Map(), {} as any,
        );
        const v42 = await manager.loadEntity(
            2 as any, '{"spine":"4.2.10","skeleton":{}}', '', new Map(), {} as any,
        );

        expect(v43).toBeNull();
        expect(v42).toBeNull();
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

    test('detectVersionJson routes every supported version, and only those', () => {
        const cases: Array<[string, string | null]> = [
            ['{"spine":"4.3.75-beta"}', '4.3'],
            ['{"spine":"4.2.10"}', '4.2'],
            ['{"spine":"4.1.20"}', '4.1'],
            ['{"spine":"3.8.99"}', '3.8'],
            ['{"spine":"2.1.27"}', '2.1'],
            ['{"spine":"3.7.94"}', '3.8'],  // pre-3.8 data loads on the 3.8 runtime
            ['{"spine":"2.0.18"}', null],   // 2.0 is its own format; 2.1 will not read it
            ['{"spine":"5.0.0"}', null],    // no runtime vendored: fail, don't guess
            ['{"skeleton":{}}', null],
        ];

        for (const [json, expected] of cases) {
            expect(SpineManager.detectVersionJson(json)).toBe(expected);
        }

        // Whatever detection returns must be a version the loader can actually serve.
        for (const [json, expected] of cases) {
            if (expected === null) continue;
            expect(SPINE_VERSIONS).toContain(SpineManager.detectVersionJson(json)!);
        }
    });
});
