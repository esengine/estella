// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

// Removing Spine support left all 560 test files green, and the failure is
// silent: the scene loads and Spine entities simply never animate.
import { describe, it, expect } from 'vitest';
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

    it('builds a fresh plugin instance per app, since a plugin carries app state', async () => {
        const { entryPlugins } = await import('../src/runtime/entryPlugins');
        expect(entryPlugins()[0]).not.toBe(entryPlugins()[0]);
    });
});
