// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { App } from '../src/app/app';
import { setAppHostPaused } from '../src/app/hostPause';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Time } from '../src/ecs/resource';
import { AudioAPI, setAudioHostSuspended } from '../src/audio/Audio';
import type { PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';

describe('playable host pause ownership', () => {
    it('freezes simulation time and preserves user pause across independent hosts', async () => {
        const app = App.new();
        let updates = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { updates++; }));
        await app.tick(0.1);
        const before = updates, elapsed = app.getResource(Time).elapsed;
        const first = {}, second = {};
        setAppHostPaused(app, first, true); setAppHostPaused(app, second, true);
        app.setPaused(false);
        await app.tick(0.3);
        expect(updates).toBe(before);
        expect(app.getResource(Time).elapsed).toBe(elapsed);
        expect(app.getResource(Time).unscaledDelta).toBe(0.3);
        setAppHostPaused(app, first, false);
        expect(app.isPaused()).toBe(true);
        app.setPaused(true); setAppHostPaused(app, second, false);
        expect(app.isPaused()).toBe(true);
        app.setPaused(false); await app.tick(0.1);
        expect(updates).toBeGreaterThan(before);
        app.quit();
    });

    it('allows an explicit debug step without releasing the host pause', async () => {
        const app = App.new(); let updates = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { updates++; }));
        const owner = {}; setAppHostPaused(app, owner, true);
        await app.stepFrames(2);
        expect(updates).toBe(2); expect(app.isPaused()).toBe(true);
        setAppHostPaused(app, owner, false); app.quit();
    });

    it('does not resume manually suspended audio or bypass another host', () => {
        const backend = { delivery: 'bytes', suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn() } as unknown as PlatformAudioBackend;
        const audio = new AudioAPI(backend); const first = {}, second = {};
        setAudioHostSuspended(audio, first, true); setAudioHostSuspended(audio, second, true);
        expect(backend.suspend).toHaveBeenCalledTimes(1);
        audio.resume(); expect(backend.resume).not.toHaveBeenCalled();
        setAudioHostSuspended(audio, first, false); expect(backend.resume).not.toHaveBeenCalled();
        audio.suspend(); setAudioHostSuspended(audio, second, false);
        expect(backend.resume).not.toHaveBeenCalled();
        audio.resume(); expect(backend.resume).toHaveBeenCalledTimes(1);
        audio.dispose(); setAudioHostSuspended(audio, first, true);
        expect(backend.suspend).toHaveBeenCalledTimes(2);
    });
});
