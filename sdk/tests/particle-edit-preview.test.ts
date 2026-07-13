// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Edit-mode particle preview: the simulation stays frozen in editor edit mode
 * by default (the playModeOnly contract), and the editor-only preview flag is
 * the one authoring exception — flipping it advances the sim live while
 * emitters are being tuned. Outside an editor the flag is irrelevant.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { App } from '../src/app';
import { setEditorMode, setPlayMode } from '../src/env';
import {
    particlePlugin, Particle,
    setParticleEditPreview, isParticleEditPreview,
} from '../src/particle';

const STEP = 1 / 60;

afterEach(() => {
    setEditorMode(false);
    setPlayMode(false);
    setParticleEditPreview(false);
});

function makeApp(): { app: App; updates: () => number } {
    const app = App.new();
    app.addPlugin(particlePlugin);
    let count = 0;
    const api = app.getResource(Particle);
    api.update = () => { count++; };
    return { app, updates: () => count };
}

describe('particle edit preview', () => {
    it('edit mode: frozen by default, live while the preview flag is on', async () => {
        setEditorMode(true);
        const { app, updates } = makeApp();

        await app.tick(STEP);
        expect(updates()).toBe(0); // edit mode → gameplay frozen (unchanged)

        setParticleEditPreview(true);
        expect(isParticleEditPreview()).toBe(true);
        await app.tick(STEP);
        expect(updates()).toBe(1); // preview unfreezes the sim only

        setParticleEditPreview(false);
        await app.tick(STEP);
        expect(updates()).toBe(1); // re-freezes
    });

    it('play mode and standalone runtime are untouched by the flag', async () => {
        const { app, updates } = makeApp();
        await app.tick(STEP);
        expect(updates()).toBe(1); // standalone: playModeOnly already passes

        setEditorMode(true);
        setPlayMode(true);
        await app.tick(STEP);
        expect(updates()).toBe(2); // editor play mode: runs regardless of the flag
    });
});
