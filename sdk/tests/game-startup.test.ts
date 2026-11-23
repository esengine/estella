// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { runGameStartup, type GameStartup } from '../src/runtime/gameStartup';

it('preserves the boot error and releases every acquired resource in reverse order', async () => {
    const failure = new Error('could not unwind scene data');
    const order: string[] = [];
    const app = App.new();
    const life = app.signal;
    app.addPlugin({ build() {}, cleanup() { order.push('app'); } });
    await expect(runGameStartup(async startup => {
        startup.onFailure(() => { order.push('resize'); });
        startup.createApp(() => app);
        startup.onFailure(() => { order.push('progress'); throw Error('cleanup failed'); });
        throw failure;
    })).rejects.toBe(failure);
    expect(order).toEqual(['progress', 'app', 'resize']);
    expect(life.aborted).toBe(true);
});

it('releases an owned renderer on a factory failure and leaves a successful game live', async () => {
    const shutdownRenderer = vi.fn();
    const failure = new Error('failed plugin');
    await expect(runGameStartup(async startup => {
        startup.onFailure(shutdownRenderer);
        return startup.createApp(() => { throw failure; });
    })).rejects.toBe(failure);
    expect(shutdownRenderer).toHaveBeenCalledOnce();
    const app = App.new();
    const life = app.signal;
    expect(await runGameStartup(async startup => startup.createApp(() => app))).toBe(app);
    expect(life.aborted).toBe(false);
    app.quit();
});

it('hands renderer ownership to the App exactly once when a scene fails later', async () => {
    const release = vi.fn();
    await expect(runGameStartup(async startup => {
        const adopted = startup.onFailure(release);
        startup.createApp(() => App.new().addPlugin({ build() {}, cleanup: release }));
        adopted();
        throw 'unwind';
    })).rejects.toBe('unwind');
    expect(release).toHaveBeenCalledOnce();
});

it('leaves a reused App live when its retired startup later rejects', async () => {
    const app = App.new();
    let reject!: (error: Error) => void;
    const failed = runGameStartup(async startup => {
        startup.createApp(() => app);
        await new Promise<void>((_, fail) => { reject = fail; });
    });
    app.quit();
    const next = app.signal;
    const cleanup = vi.fn();
    app.addPlugin({ build() {}, cleanup });
    reject(new Error('retired load'));
    await expect(failed).rejects.toThrow('retired load');
    expect(next.aborted).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    app.quit();
    expect(cleanup).toHaveBeenCalledOnce();
});

it('cleans up a late sibling without creating another game after startup failed', async () => {
    let scope!: GameStartup;
    const failure = new Error('bad project');
    await expect(runGameStartup(async startup => { scope = startup; throw failure; })).rejects.toBe(failure);
    const unsubscribe = vi.fn(), build = vi.fn(() => App.new());
    scope.onFailure(unsubscribe);
    expect(() => scope.createApp(build)).toThrow(failure);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(build).not.toHaveBeenCalled();
});
