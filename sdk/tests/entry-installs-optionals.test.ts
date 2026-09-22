// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

// Removing Spine support left all 560 test files green, and the failure is
// silent: the scene loads and Spine entities simply never animate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spineSupport, dragonBonesSupport } from '../src/runtime/sceneOptionals';
import '../src/index';

describe('an SDK entry installs the optional subsystems', () => {
    it('gives the scene loader a way to load and apply Spine', () => {
        const spine = spineSupport();
        expect(spine, 'importing the entry must install Spine support').not.toBeNull();
        expect(typeof spine!.manager).toBe('function');
        expect(typeof spine!.load).toBe('function');
        expect(typeof spine!.apply).toBe('function');
    });

    it('gives the scene loader a way to acquire and apply DragonBones', () => {
        const db = dragonBonesSupport();
        expect(db, 'importing the entry must install DragonBones support').not.toBeNull();
        expect(typeof db!.acquire).toBe('function');
        expect(typeof db!.load).toBe('function');
        expect(typeof db!.apply).toBe('function');
    });

    it('installs the plugins createWebApp used to name itself', async () => {
        const { entryPlugins } = await import('../src/runtime/entryPlugins');
        const names = entryPlugins().map((p) => p.constructor.name);
        expect(names).toContain('SpinePlugin');
        expect(names).toContain('DragonBonesPlugin');
    });

    // Every one, not the first one: asking only entryPlugins()[0] proved the
    // property for whichever subsystem registers earliest, and four later ones
    // registered module-level singletons under it without turning this red.
    it('builds a fresh plugin instance per app, since a plugin carries app state', async () => {
        const { entryPlugins } = await import('../src/runtime/entryPlugins');
        const a = entryPlugins();
        const b = entryPlugins();
        const shared = a.filter((p, i) => p === b[i]).map((p) => p.constructor.name);
        expect(shared).toEqual([]);
    });
});

/**
 * …and every App an entry builds gets them, not just the web one. A factory that
 * reads no registry ships a device without whatever is only in it — and these
 * tests would not notice, because they only ask what was REGISTERED.
 */
describe('the App factories consume that registry', () => {
    const factory = (file: string): string =>
        readFileSync(path.resolve(__dirname, '..', 'src', file), 'utf8');

    it('is read by the native factory as well as the web one', () => {
        for (const f of ['runtime/webAppFactory.ts', 'ecs/bridge/nativeRuntime.ts']) {
            expect(factory(f), `${f} builds an App without entryPlugins()`).toContain('entryPlugins()');
        }
    });

    // Naming one by hand is how the registry stopped being the only answer.
    it('leaves no optional subsystem named by hand in the native factory', () => {
        const src = factory('ecs/bridge/nativeRuntime.ts');
        const named = ['SpinePlugin', 'DragonBonesPlugin', 'NavPlugin', 'TilemapPlugin', 'NetPlugin']
            .filter((n) => new RegExp(`new ${n}\\(`).test(src));
        expect(named, 'these reach an App through entryPlugins now').toEqual([]);
    });
});
