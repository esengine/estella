// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem } from '../src/ecs/system';
import { ProfileRecorder, ProfileRecorderPlugin } from '../src/app/profileRecorder';
import { parseProfileCapture, summarizeCapture } from '../src/app/profileCapture';

function appWithSystem(name = 'Worker'): App {
    const app = App.new();
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name }));
    return app;
}

describe('App.onFrameEnd', () => {
    it('fires once a frame, after the systems ran', async () => {
        const app = App.new();
        const order: string[] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => order.push('system'), { name: 'S' }));
        app.onFrameEnd(() => order.push('frameEnd'));

        await app.tick(1 / 60);

        expect(order).toEqual(['system', 'frameEnd']);
    });

    it('is a broadcast, so one watcher never takes the hook from another', async () => {
        const app = App.new();
        const seen: string[] = [];
        app.onFrameEnd(() => seen.push('a'));
        app.onFrameEnd(() => seen.push('b'));

        await app.tick(1 / 60);

        expect(seen).toEqual(['a', 'b']);
    });

    it('stops calling a disposed observer', async () => {
        const app = App.new();
        let calls = 0;
        const off = app.onFrameEnd(() => { calls++; });
        await app.tick(1 / 60);
        off();
        await app.tick(1 / 60);

        expect(calls).toBe(1);
    });

    it('reports the frame delta in milliseconds', async () => {
        const app = App.new();
        let dt = 0;
        app.onFrameEnd((ms) => { dt = ms; });
        await app.tick(1 / 60);

        expect(dt).toBeCloseTo(1000 / 60, 3);
    });

    it('does not let one throwing observer stop the next', async () => {
        const app = App.new();
        let reached = false;
        app.onFrameEnd(() => { throw new Error('boom'); });
        app.onFrameEnd(() => { reached = true; });

        await expect(app.tick(1 / 60)).resolves.toBeUndefined();
        expect(reached).toBe(true);
    });
});

describe('ProfileRecorder', () => {
    it('records nothing until it is started', async () => {
        const app = appWithSystem();
        const rec = new ProfileRecorder(app);
        await app.tick(1 / 60);

        expect(rec.recording).toBe(false);
        expect(rec.frameCount).toBe(0);
    });

    it('turns on the stats it reads, so a capture is not empty of engine cost', async () => {
        const app = appWithSystem();
        new ProfileRecorder(app).start();
        await app.tick(1 / 60);

        expect(app.getFrameCosts()).not.toBeNull();
    });

    it('records a frame per frame, with the systems attributed', async () => {
        const app = appWithSystem('Worker');
        const rec = new ProfileRecorder(app);
        rec.start();
        await app.tick(1 / 60);
        await app.tick(1 / 60);

        expect(rec.frameCount).toBe(2);
        const capture = rec.take();
        expect(capture.frames[0].systems.some((s) => s.name === 'Worker')).toBe(true);
    });

    it('stops recording when told, and keeps what it has', async () => {
        const app = appWithSystem();
        const rec = new ProfileRecorder(app);
        rec.start();
        await app.tick(1 / 60);
        rec.stop();
        await app.tick(1 / 60);

        expect(rec.recording).toBe(false);
        expect(rec.frameCount).toBe(1);
    });

    it('drops the oldest frame rather than growing without bound', async () => {
        const app = appWithSystem();
        const rec = new ProfileRecorder(app, { maxFrames: 3 });
        rec.start();
        for (let i = 0; i < 6; i++) await app.tick(1 / 60);

        expect(rec.frameCount).toBe(3);
        // The ring kept the LAST three, which is what a hitch is at the end of.
        expect(rec.take().frames.map((f) => f.id)).toEqual([3, 4, 5]);
    });

    it('hands back a document that does not change under its reader', async () => {
        const app = appWithSystem();
        const rec = new ProfileRecorder(app);
        rec.start();
        await app.tick(1 / 60);
        const capture = rec.take();
        await app.tick(1 / 60);

        expect(capture.frames).toHaveLength(1);
        expect(rec.frameCount).toBe(2);
    });

    it('carries the source it was told, so a capture says where it is from', async () => {
        const app = appWithSystem();
        const rec = new ProfileRecorder(app, { source: { platform: 'wechat', label: 'Redmi Note 12' } });
        rec.start();
        await app.tick(1 / 60);

        expect(rec.take().source).toEqual({ platform: 'wechat', label: 'Redmi Note 12' });
    });

    it('writes a capture the editor reads back', async () => {
        const app = appWithSystem('Worker');
        const rec = new ProfileRecorder(app, { budgetMs: 1000 / 30 });
        rec.start();
        for (let i = 0; i < 4; i++) await app.tick(1 / 60);

        const parsed = parseProfileCapture(JSON.stringify(rec.take()));
        expect('capture' in parsed).toBe(true);
        if ('capture' in parsed) {
            const s = summarizeCapture(parsed.capture);
            expect(s.frames).toBe(4);
            expect(s.budgetMs).toBeCloseTo(1000 / 30, 4);
            expect(s.mean.cpuMs + s.mean.waitMs + s.mean.idleMs).toBeCloseTo(s.mean.frameMs, 4);
        }
    });

    it('clears on demand without stopping', async () => {
        const app = appWithSystem();
        const rec = new ProfileRecorder(app);
        rec.start();
        await app.tick(1 / 60);
        rec.clear();
        await app.tick(1 / 60);

        expect(rec.recording).toBe(true);
        expect(rec.frameCount).toBe(1);
    });
});

describe('ProfileRecorderPlugin', () => {
    it('hands the game its recorder and starts nothing', async () => {
        let handed: ProfileRecorder | null = null;
        const app = App.new();
        app.addPlugin(new ProfileRecorderPlugin({}, (r) => { handed = r; }));
        await app.tick(1 / 60);

        expect(handed).toBeInstanceOf(ProfileRecorder);
        expect(handed!.recording).toBe(false);
    });

    it('files its own cost under diagnostics rather than a domain of its own', () => {
        expect(new ProfileRecorderPlugin().profileDomain).toBe('diagnostics');
    });
});
