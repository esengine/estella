// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * FX edit preview: particle and trail simulations stay frozen in editor edit
 * mode by default (the playModeOnly contract), and the editor-only FX-preview
 * flag (env.ts) is the one authoring exception — flipping it advances BOTH
 * sims live while effects are being tuned. Outside an editor the flag is
 * irrelevant.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { App } from '../src/app/app';
import { setEditorMode, setPlayMode, setFxEditPreview, isFxEditPreview } from '../src/util/env';
import { particlePlugin, Particle } from '../src/particle';
import { trailPlugin, Trail } from '../src/trail';

const STEP = 1 / 60;

afterEach(() => {
    setEditorMode(false);
    setPlayMode(false);
    setFxEditPreview(false);
});

function makeApp(): { app: App; particleUpdates: () => number; trailUpdates: () => number } {
    const app = App.new();
    app.addPlugin(particlePlugin);
    app.addPlugin(trailPlugin);
    let particles = 0;
    let trails = 0;
    app.getResource(Particle).update = () => { particles++; };
    app.getResource(Trail).update = () => { trails++; };
    return { app, particleUpdates: () => particles, trailUpdates: () => trails };
}

describe('FX edit preview (particles + trails share the env flag)', () => {
    it('edit mode: frozen by default, both sims live while the preview flag is on', async () => {
        setEditorMode(true);
        const { app, particleUpdates, trailUpdates } = makeApp();

        await app.tick(STEP);
        expect(particleUpdates()).toBe(0); // edit mode → gameplay frozen (unchanged)
        expect(trailUpdates()).toBe(0);

        setFxEditPreview(true);
        expect(isFxEditPreview()).toBe(true);
        await app.tick(STEP);
        expect(particleUpdates()).toBe(1); // the preview unfreezes the FX sims only
        expect(trailUpdates()).toBe(1);

        setFxEditPreview(false);
        await app.tick(STEP);
        expect(particleUpdates()).toBe(1); // re-freezes
        expect(trailUpdates()).toBe(1);
    });

    it('play mode and standalone runtime are untouched by the flag', async () => {
        const { app, particleUpdates, trailUpdates } = makeApp();
        await app.tick(STEP);
        expect(particleUpdates()).toBe(1); // standalone: playModeOnly already passes
        expect(trailUpdates()).toBe(1);

        setEditorMode(true);
        setPlayMode(true);
        await app.tick(STEP);
        expect(particleUpdates()).toBe(2); // editor play mode: runs regardless of the flag
        expect(trailUpdates()).toBe(2);
    });
});
