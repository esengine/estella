// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Side-module identity, now that a project can name its own.
 *
 * The id used to be a closed union, so "unknown id" was unreachable and the host
 * returned null for it in silence. Opening the type makes that reachable — a
 * typo, a module the export did not stage — and silence is how either becomes
 * "this runtime just doesn't work on my phone" with nothing in the log.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    registerSideModule, sideModuleDescriptor, projectSideModuleIds, clearProjectSideModules,
    createSideModuleHost, SIDE_MODULES,
} from '../src/sideModules';
import { registerPackagedSideModules } from '../src/runtime/packagedRuntime';

afterEach(() => {
    clearProjectSideModules();
    vi.restoreAllMocks();
});

describe('identity', () => {
    it('resolves a project module by id, like a built-in', () => {
        registerSideModule('rive', { file: 'rive', globalName: 'RiveModule' });
        expect(sideModuleDescriptor('rive')).toEqual({ file: 'rive', globalName: 'RiveModule' });
        expect(sideModuleDescriptor('physics')).toEqual(SIDE_MODULES.physics);
        expect(projectSideModuleIds()).toEqual(['rive']);
    });

    it('refuses to let a project redefine an engine module', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSideModule('physics', { file: 'not-physics' });
        expect(sideModuleDescriptor('physics')).toEqual(SIDE_MODULES.physics);
        expect(warn).toHaveBeenCalled();
        // `physics` meaning two different binaries depending on load order is not
        // a capability, so this is refused rather than last-wins.
        expect(projectSideModuleIds()).toEqual([]);
    });

    it('forgets project modules on teardown, so a reloaded realm starts clean', () => {
        registerSideModule('rive', { file: 'rive' });
        clearProjectSideModules();
        expect(sideModuleDescriptor('rive')).toBeUndefined();
        expect(sideModuleDescriptor('basis')).toBeDefined();
    });
});

describe('acquisition', () => {
    it('hands the registered descriptor to the transport', async () => {
        registerSideModule('rive', { file: 'rive_runtime', globalName: 'RiveModule' });
        const seen: Array<{ file: string; id: string }> = [];
        const host = createSideModuleHost(async (descriptor, id) => {
            seen.push({ file: descriptor.file, id });
            return {} as never;
        });
        await host.acquire('rive');
        expect(seen).toEqual([{ file: 'rive_runtime', id: 'rive' }]);
    });

    it('says something about an id nobody registered', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const host = createSideModuleHost(async () => ({} as never));
        expect(await host.acquire('rvie')).toBeNull();
        expect(warn.mock.calls.flat().join(' ')).toContain('rvie');
    });

    it('caches per id, including the null — a missing artifact is not refetched every frame', async () => {
        let calls = 0;
        registerSideModule('rive', { file: 'rive' });
        const host = createSideModuleHost(async () => { calls++; throw new Error('404'); });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await host.acquire('rive')).toBeNull();
        expect(await host.acquire('rive')).toBeNull();
        expect(calls).toBe(1);
        expect(error).toHaveBeenCalled();
    });

    it('points a failed project module at the project, not at a build command that does not exist', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        registerSideModule('rive', { file: 'rive' });
        const host = createSideModuleHost(async () => { throw new Error('404'); });
        await host.acquire('rive');
        const said = error.mock.calls.flat().join(' ');
        expect(said).toContain('.esengine/modules/rive/');
        expect(said).not.toContain('build -t');
    });

    it('still tells an engine module how to be built', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const host = createSideModuleHost(async () => { throw new Error('404'); });
        await host.acquire('spine:4.2');
        expect(error.mock.calls.flat().join(' ')).toContain('build -t spine');
    });
});

describe('the packaged declaration', () => {
    it('registers what the export staged', () => {
        registerPackagedSideModules({
            sideModules: [{ id: 'rive', file: 'rive', globalName: 'RiveModule' }, { id: 'lottie', file: 'lottie' }],
        });
        expect(sideModuleDescriptor('rive')).toEqual({ file: 'rive', globalName: 'RiveModule' });
        expect(sideModuleDescriptor('lottie')).toEqual({ file: 'lottie' });
    });

    it('is a no-op for a build that declared none', () => {
        registerPackagedSideModules({});
        expect(projectSideModuleIds()).toEqual([]);
    });

    it('skips a malformed entry rather than registering a module with no artifact', () => {
        registerPackagedSideModules({
            sideModules: [{ id: '', file: 'x' }, { id: 'y', file: '' }] as never,
        });
        expect(projectSideModuleIds()).toEqual([]);
    });
});
