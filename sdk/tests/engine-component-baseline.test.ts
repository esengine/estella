// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A project hot reload re-imports only the project bundle; the cached `esengine`
 * module does not re-run, so its module-level `defineComponent`s (AI, animation,
 * audio, joints, UI text, tilemap, timeline…) would be lost when the reload's
 * `clearUserComponents()` empties the registry. The SDK entry snapshots them as a
 * baseline that the app build and the hot-reload probe re-seed. Without this the
 * hot-swap probe fingerprint omits every engine component and never matches live,
 * so the destructive full reload always runs and comes back missing components.
 */
import { describe, it, expect } from 'vitest';
import {
    defineComponent, clearUserComponents, getComponent,
    getUserComponentFingerprint, markEngineComponentBaseline, seedEngineComponents,
} from '../src/ecs/component';
import { probeRegistrations } from '../src/hotReload';

describe('engine component baseline survives a hot reload', () => {
    it('re-seeds engine components after clearUserComponents wipes them', () => {
        defineComponent('EngineWidget', { n: 0 });
        markEngineComponentBaseline();
        expect(getComponent('EngineWidget')).toBeDefined();

        clearUserComponents(); // what the reload's full path does
        expect(getComponent('EngineWidget')).toBeUndefined();

        seedEngineComponents(); // what createWebApp does on the way back up
        expect(getComponent('EngineWidget')).toBeDefined();
    });

    it('re-seeds only the baseline, not project components registered later', () => {
        defineComponent('EngineWidget', { n: 0 });
        markEngineComponentBaseline();
        defineComponent('ProjectWidget', { m: 0 }); // after the baseline = project code

        clearUserComponents();
        seedEngineComponents();

        expect(getComponent('EngineWidget')).toBeDefined();   // engine restored
        expect(getComponent('ProjectWidget')).toBeUndefined(); // project comes back via the bundle
    });

    it('gives the hot-swap probe the engine baseline so its fingerprint can match live', async () => {
        defineComponent('EngineWidget', { n: 0 });
        markEngineComponentBaseline();

        // The probe re-imports the project bundle into a throwaway context; in reality
        // esengine is cached so only project components re-register there.
        const { fingerprint } = await probeRegistrations(async () => {
            defineComponent('ProjectWidget', { m: 0 });
        });

        // The seeded baseline means the probe no longer OMITS engine components.
        expect(fingerprint).toContain('EngineWidget');
        expect(fingerprint).toContain('ProjectWidget');
        // The live context (no project bundle re-run here) still carries the baseline.
        expect(getUserComponentFingerprint()).toContain('EngineWidget');
    });
});
