// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { defaultMiniGameEntry } from '../src/export/miniGameExportProfile';

interface Task {
    progress?: (p: Record<string, number>) => void;
}

function runEntry(opts: { requireThrows?: boolean; bootRejects?: boolean } = {}) {
    const titles: string[] = [];
    const events: string[] = [];
    const errors: string[] = [];
    const task: Task = {};
    let succeed: (() => void) | undefined;
    let fail: ((e: unknown) => void) | undefined;
    const wx = {
        showLoading(o: { title: string }) { titles.push(o.title); events.push('show'); },
        hideLoading() { events.push('hide'); },
        loadSubpackage(o: { success(): void; fail(e: unknown): void }) {
            succeed = () => o.success();
            fail = (e) => o.fail(e);
            return { onProgressUpdate(cb: Task['progress']) { task.progress = cb; } };
        },
    };
    const bundle = {
        boot: () => {
            events.push('boot');
            return opts.bootRejects ? Promise.reject(new Error('ABI layout hash mismatch')) : new Promise(() => {});
        },
    };
    const require = (p: string) => {
        if (opts.requireThrows && p.includes('esengine')) throw new Error(`module '${p}' is not defined`);
        return p.endsWith('game-bundle.js') ? bundle : () => {};
    };
    const src = defaultMiniGameEntry({
        sideModules: [], engineGlueFile: 'esengine.wxgame.js', runtimeDir: 'wasm',
        hostGlobal: 'wx', engineSubpackage: 'engine',
    });
    vm.runInNewContext(src, { wx, require, console: { error: (m: string) => errors.push(m) }, Promise });
    return { titles, events, errors, task, succeed: () => succeed!(), fail: (e: unknown) => fail!(e) };
}

describe('mini-game entry with the engine in a subpackage, executed', () => {
    it('never shows a percentage outside 0–100, whatever the host reports', () => {
        const r = runEntry();
        r.task.progress!({ progress: -20608, totalBytesWritten: 206, totalBytesExpectedToWrite: -1 });
        r.task.progress!({ progress: 40, totalBytesWritten: 400, totalBytesExpectedToWrite: 1000 });
        r.task.progress!({ progress: NaN, totalBytesWritten: 500, totalBytesExpectedToWrite: 1000 });
        r.task.progress!({ progress: 250, totalBytesWritten: 0, totalBytesExpectedToWrite: 0 });
        for (const t of r.titles) {
            const m = /(-?\d+)%/.exec(t);
            if (m) expect(Number(m[1]), t).toBeGreaterThanOrEqual(0);
            if (m) expect(Number(m[1]), t).toBeLessThanOrEqual(100);
        }
        expect(r.titles).toContain('Fetching the engine 40%');
        expect(r.titles).toContain('Fetching the engine 50%');
    });

    it('a progress event after the subpackage loaded does not put the notice back over the game', () => {
        const r = runEntry();
        r.succeed();
        expect(r.events).toContain('boot');
        const shown = r.titles.length;
        r.task.progress!({ progress: 100, totalBytesWritten: 1000, totalBytesExpectedToWrite: 1000 });
        expect(r.titles.length).toBe(shown);
    });

    it('a boot that throws while the subpackage callback runs takes the notice down and says why', () => {
        const r = runEntry({ requireThrows: true });
        expect(() => r.succeed()).not.toThrow();
        expect(r.events.at(-1)).toBe('hide');
        expect(r.errors.join('\n')).toContain('is not defined');
    });

    it('a boot that rejects takes the notice down and says why', async () => {
        const r = runEntry({ bootRejects: true });
        r.succeed();
        await new Promise((res) => setTimeout(res, 0));
        expect(r.events.at(-1)).toBe('hide');
        expect(r.errors.join('\n')).toContain('ABI layout hash mismatch');
    });

    it('a failed fetch takes the notice down and later progress does not bring it back', () => {
        const r = runEntry();
        r.fail({ errMsg: 'loadSubpackage:fail' });
        r.task.progress!({ progress: 10, totalBytesWritten: 1, totalBytesExpectedToWrite: 10 });
        expect(r.events.at(-1)).toBe('hide');
        expect(r.errors.join('\n')).toContain('loadSubpackage:fail');
    });
});
